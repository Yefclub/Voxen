"""Safe classification and bounded durable recovery for source ingestion."""

from __future__ import annotations

import asyncio
import math
import re
import socket
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

import httpx
import requests

from .pipeline_errors import DeferredJobError, PermanentError, TransientError

MAX_COOLDOWN_SECONDS = 3600
MAX_LOCAL_WAIT_SECONDS = 5


async def within_deadline[T](call: Callable[[], Awaitable[T]], *, seconds: float) -> T:
    """Cancel an asynchronous source attempt that exceeds its total deadline."""
    try:
        async with asyncio.timeout(seconds):
            return await call()
    except TimeoutError as exc:
        raise ExternalTransientError("External fetch exceeded its total deadline.") from exc


class ExternalTransientError(TransientError):
    """Temporary source failure with only safe operational metadata."""

    def __init__(
        self,
        detail: str = "External source is temporarily unavailable.",
        *,
        status_code: int | None = None,
        retry_after: float | None = None,
    ) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.retry_after = retry_after


def parse_retry_after(value: str | None, *, now: datetime | None = None) -> float | None:
    """Accept delta seconds and HTTP dates, with a finite one-hour ceiling."""
    if not isinstance(value, str) or len(value) > 128:
        return None
    value = value.strip()
    if value.isascii() and value.isdecimal():
        return float(min(int(value), MAX_COOLDOWN_SECONDS))
    try:
        target = parsedate_to_datetime(value)
        if target.tzinfo is None:
            target = target.replace(tzinfo=UTC)
        seconds = (target - (now or datetime.now(UTC))).total_seconds()
        return max(0.0, min(seconds, MAX_COOLDOWN_SECONDS))
    except (TypeError, ValueError, OverflowError):
        return None


def is_temporary_status(status: object) -> bool:
    return isinstance(status, int) and (status in (408, 429) or 500 <= status <= 599)


def as_transient(exc: BaseException) -> ExternalTransientError | None:
    """Inspect bounded cause chains without returning untrusted exception text."""
    current: BaseException | None = exc
    for _ in range(8):
        if current is None:
            break
        if isinstance(current, ExternalTransientError):
            return current
        response = getattr(current, "response", None)
        status = getattr(current, "status_code", None)
        if status is None:
            status = getattr(response, "status_code", None)
        if isinstance(status, int):
            if not is_temporary_status(status):
                return None
            hint = getattr(current, "retry_after", None)
            if hint is None and response is not None:
                hint = parse_retry_after(response.headers.get("Retry-After"))
            return ExternalTransientError(status_code=status, retry_after=hint)
        if isinstance(
            current,
            (
                httpx.TimeoutException,
                httpx.NetworkError,
                requests.Timeout,
                requests.ConnectionError,
                TimeoutError,
                ConnectionError,
            ),
        ) or (isinstance(current, socket.gaierror) and current.errno == socket.EAI_AGAIN):
            return ExternalTransientError()
        # yt-dlp normalizes transport errors into its own exception classes.
        text = str(current).lower()
        match = re.search(r"http (?:error |status )?(\d{3})\b", text)
        if match:
            status = int(match.group(1))
            if is_temporary_status(status):
                return ExternalTransientError(status_code=status)
            return None
        if any(
            marker in text
            for marker in (
                "timed out",
                "timeout",
                "connection refused",
                "connection reset",
                "temporary failure in name resolution",
                "too many requests",
                "rate-limit",
            )
        ):
            return ExternalTransientError()
        current = current.__cause__
    return None


@asynccontextmanager
async def recover(*, attempt: int, max_attempts: int) -> AsyncIterator[None]:
    """Convert only classified external failures into finite queue recovery."""
    try:
        yield
    except ExternalTransientError as exc:
        if attempt >= max_attempts:
            raise PermanentError.public(
                "EXTERNAL_TEMPORARILY_UNAVAILABLE",
                "A fonte externa está temporariamente indisponível ou limitando requisições. "
                "As tentativas automáticas terminaram. Tente novamente mais tarde; "
                "se necessário, envie o conteúdo por upload manual.",
            ) from exc
        cooldown = max(30 * 2 ** max(0, attempt - 1), exc.retry_after or 0)
        raise DeferredJobError(
            "External ingestion recovery scheduled.",
            retry_after_seconds=math.ceil(min(cooldown, MAX_COOLDOWN_SECONDS)),
        ) from exc
