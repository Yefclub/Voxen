"""Outbound HTTP through the egress proxy (curl_cffi, browser impersonation).

Redirects are followed manually so every hop is re-validated and sent through
the proxy, which resolves DNS and refuses private destinations.
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urljoin

from curl_cffi import CurlOpt
from curl_cffi.requests import AsyncSession

from . import config
from .errors import (
    BLOCKED_ADDRESS,
    TIMEOUT,
    TOO_LARGE,
    UNKNOWN,
    UNSUPPORTED,
    classify_exception,
    classify_http_status,
    error,
)
from .routing import validate_url

IMPERSONATE = "chrome"
MAX_REDIRECTS = 5
SMOKESCREEN_ERROR_HEADER = "x-smokescreen-error"


@dataclass
class Fetched:
    url: str
    status: int
    content_type: str
    body: bytes


def _session() -> AsyncSession:
    proxy = config.proxy_url()
    return AsyncSession(
        impersonate=IMPERSONATE,
        proxies={"http": proxy, "https": proxy},
        trust_env=False,
        # Empty NOPROXY overrides any no_proxy env var: nothing bypasses the proxy.
        curl_options={CurlOpt.NOPROXY: ""},
        timeout=config.HTTP_TIMEOUT_SEC,
        allow_redirects=False,
    )


async def fetch(
    url: str,
    *,
    max_bytes: int,
    headers: dict[str, str] | None = None,
    accept_status_errors: bool = False,
) -> Fetched:
    """GET `url` through the proxy, following up to MAX_REDIRECTS hops."""
    current = validate_url(url)
    try:
        async with _session() as session:
            for _ in range(MAX_REDIRECTS + 1):
                response = await session.get(current, headers=headers, stream=True)
                try:
                    status = response.status_code
                    if status == 407:
                        raise error(BLOCKED_ADDRESS)
                    if SMOKESCREEN_ERROR_HEADER in response.headers:
                        # Proxy-side failure (DNS, connect) for a plain-HTTP hop.
                        raise error(TIMEOUT) if status == 504 else error(UNKNOWN, retryable=True)
                    if status in (301, 302, 303, 307, 308):
                        location = response.headers.get("location")
                        if not location:
                            raise error(UNSUPPORTED)
                        current = validate_url(urljoin(current, location))
                        continue
                    if status >= 400 and not accept_status_errors:
                        raise classify_http_status(status) or error(UNKNOWN)
                    declared = response.headers.get("content-length")
                    if declared and declared.isdigit() and int(declared) > max_bytes:
                        raise error(TOO_LARGE)
                    chunks: list[bytes] = []
                    size = 0
                    async for chunk in response.aiter_content():
                        size += len(chunk)
                        if size > max_bytes:
                            raise error(TOO_LARGE)
                        chunks.append(chunk)
                    return Fetched(
                        url=current,
                        status=status,
                        content_type=(response.headers.get("content-type") or "").lower(),
                        body=b"".join(chunks),
                    )
                finally:
                    await response.aclose()
            raise error(UNSUPPORTED)
    except Exception as exc:
        raise classify_exception(exc) from exc
