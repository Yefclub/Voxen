"""Safe fallback for public TikTok videos through TikTok's official player API."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import requests

PLAYER_ITEMS_URL = "https://www.tiktok.com/player/api/v1/items"
OEMBED_URL = "https://www.tiktok.com/oembed"
MAX_METADATA_BYTES = 2 * 1024 * 1024
MAX_MEDIA_BYTES = 1024 * 1024 * 1024
MAX_MEDIA_REDIRECTS = 3
_TIMEOUT = (10, 45)
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
)
_VIDEO_ID_RE = re.compile(r"/video/(\d{10,24})(?:[/?#]|$)")
_HANDLE_RE = re.compile(r"[A-Za-z0-9._-]{1,64}")
_REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})


class TikTokPlayerError(RuntimeError):
    """A sanitized official-player fallback failure safe for operational logs."""


@dataclass(frozen=True)
class PlayerItem:
    video_id: str
    title: str
    author: str | None
    author_handle: str | None
    duration_sec: int
    thumbnail_url: str | None
    canonical_url: str
    media_url: str


def _configure_proxy(session: requests.Session, proxy_url: str | None) -> None:
    if proxy_url:
        session.proxies.update({"http": proxy_url, "https": proxy_url})


def _content_length(headers: Any) -> int | None:
    raw = headers.get("content-length")
    if not raw:
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None
    return value if value >= 0 else None


def _json_object(response: requests.Response, *, operation: str) -> dict[str, Any]:
    if response.status_code != 200:
        response.close()
        raise TikTokPlayerError(
            f"TikTok player fallback rejected {operation} (HTTP {response.status_code})."
        )
    declared = _content_length(response.headers)
    if declared is not None and declared > MAX_METADATA_BYTES:
        response.close()
        raise TikTokPlayerError(f"TikTok player fallback returned oversized {operation} metadata.")
    try:
        chunks: list[bytes] = []
        total = 0
        for chunk in response.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            total += len(chunk)
            if total > MAX_METADATA_BYTES:
                raise TikTokPlayerError(
                    f"TikTok player fallback returned oversized {operation} metadata."
                )
            chunks.append(chunk)
        payload = json.loads(b"".join(chunks))
    except (TypeError, ValueError) as exc:
        raise TikTokPlayerError(
            f"TikTok player fallback returned invalid {operation} metadata."
        ) from exc
    finally:
        response.close()
    if not isinstance(payload, dict):
        raise TikTokPlayerError(f"TikTok player fallback returned invalid {operation} metadata.")
    return payload


def _official_asset_url(raw: object, *, kind: str) -> str:
    if not isinstance(raw, str) or len(raw) > 8192:
        raise TikTokPlayerError(f"TikTok player fallback returned an invalid {kind} URL.")
    try:
        parsed = urlparse(raw)
        host = (parsed.hostname or "").lower()
        port = parsed.port
    except ValueError as exc:
        raise TikTokPlayerError(f"TikTok player fallback returned an invalid {kind} URL.") from exc
    official_host = host == "tiktok.com" or host.endswith(
        (".tiktok.com", ".tiktokcdn.com", ".tiktokv.com")
    )
    if (
        parsed.scheme != "https"
        or not official_host
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
    ):
        raise TikTokPlayerError(f"TikTok player fallback rejected a non-official {kind} host.")
    return raw


def _video_id(source_url: str, session: requests.Session) -> str:
    match = _VIDEO_ID_RE.search(source_url)
    if match:
        return match.group(1)

    response = session.get(
        OEMBED_URL,
        params={"url": source_url},
        headers={"User-Agent": _USER_AGENT},
        timeout=_TIMEOUT,
        allow_redirects=False,
        stream=True,
    )
    payload = _json_object(response, operation="oEmbed")
    candidate = str(payload.get("embed_product_id") or "")
    if not re.fullmatch(r"\d{10,24}", candidate):
        raise TikTokPlayerError("TikTok player fallback could not resolve the public video ID.")
    return candidate


def _first_url(value: object, *, required: bool) -> str | None:
    if not isinstance(value, list):
        if required:
            raise TikTokPlayerError("TikTok player fallback returned no playable media URL.")
        return None
    for candidate in value:
        try:
            return _official_asset_url(candidate, kind="media" if required else "thumbnail")
        except TikTokPlayerError:
            continue
    if required:
        raise TikTokPlayerError("TikTok player fallback returned no official media host.")
    return None


def _parse_player_item(payload: dict[str, Any], video_id: str) -> PlayerItem:
    results = payload.get("results")
    items = payload.get("items")
    if payload.get("status_code") not in (0, None) or not isinstance(results, list):
        raise TikTokPlayerError("TikTok player fallback rejected the public video.")
    result_ok = any(
        isinstance(result, dict)
        and str(result.get("id_str") or result.get("id") or "") == video_id
        and result.get("code") == "ok"
        for result in results
    )
    if not result_ok or not isinstance(items, list):
        raise TikTokPlayerError("TikTok player fallback could not access the public video.")
    item = next(
        (
            candidate
            for candidate in items
            if isinstance(candidate, dict)
            and str(candidate.get("id_str") or candidate.get("id") or "") == video_id
        ),
        None,
    )
    if not isinstance(item, dict):
        raise TikTokPlayerError("TikTok player fallback returned no matching public video.")

    video_info = item.get("video_info")
    if not isinstance(video_info, dict):
        raise TikTokPlayerError("TikTok player fallback returned invalid video metadata.")
    media_url = _first_url(video_info.get("url_list"), required=True)
    assert media_url is not None

    meta = video_info.get("meta")
    duration_raw = meta.get("duration") if isinstance(meta, dict) else 0
    try:
        duration_sec = max(0, int(duration_raw or 0))
    except (TypeError, ValueError, OverflowError):
        duration_sec = 0

    author_info = item.get("author_info")
    author_info = author_info if isinstance(author_info, dict) else {}
    author = author_info.get("nickname")
    author = str(author)[:160] if isinstance(author, str) and author.strip() else None
    handle_raw = author_info.get("unique_id")
    handle = (
        str(handle_raw)
        if isinstance(handle_raw, str) and _HANDLE_RE.fullmatch(handle_raw)
        else None
    )
    title_raw = item.get("desc")
    title = str(title_raw).strip()[:500] if isinstance(title_raw, str) else ""
    if not title:
        title = "Vídeo do TikTok"

    cover = video_info.get("cover")
    cover_urls = cover.get("url_list") if isinstance(cover, dict) else None
    thumbnail_url = _first_url(cover_urls, required=False)
    canonical_url = (
        f"https://www.tiktok.com/@{handle}/video/{video_id}"
        if handle
        else f"https://www.tiktok.com/video/{video_id}"
    )
    return PlayerItem(
        video_id=video_id,
        title=title,
        author=author,
        author_handle=handle,
        duration_sec=duration_sec,
        thumbnail_url=thumbnail_url,
        canonical_url=canonical_url,
        media_url=media_url,
    )


def fetch_item_sync(source_url: str, *, proxy_url: str | None = None) -> PlayerItem:
    """Resolve one public TikTok item without following user-controlled URLs."""
    session = requests.Session()
    _configure_proxy(session, proxy_url)
    try:
        video_id = _video_id(source_url, session)
        response = session.get(
            PLAYER_ITEMS_URL,
            params={
                "item_ids": video_id,
                "language": "pt-BR",
                "aid": "1459",
                "data_source": "web_core",
            },
            headers={
                "User-Agent": _USER_AGENT,
                "Referer": f"https://www.tiktok.com/player/v1/{video_id}",
            },
            timeout=_TIMEOUT,
            allow_redirects=False,
            stream=True,
        )
        return _parse_player_item(_json_object(response, operation="item"), video_id)
    except requests.RequestException as exc:
        raise TikTokPlayerError("TikTok player fallback could not reach the official API.") from exc
    finally:
        session.close()


def download_media_sync(
    item: PlayerItem,
    destination: Path,
    *,
    proxy_url: str | None = None,
) -> None:
    """Stream a validated official TikTok media URL with a hard byte limit."""
    session = requests.Session()
    _configure_proxy(session, proxy_url)
    current_url = _official_asset_url(item.media_url, kind="media")
    response: requests.Response | None = None
    try:
        for redirect_count in range(MAX_MEDIA_REDIRECTS + 1):
            response = session.get(
                current_url,
                headers={
                    "User-Agent": _USER_AGENT,
                    "Referer": f"https://www.tiktok.com/player/v1/{item.video_id}",
                },
                timeout=_TIMEOUT,
                allow_redirects=False,
                stream=True,
            )
            if response.status_code not in _REDIRECT_STATUSES:
                break
            location = response.headers.get("location")
            response.close()
            response = None
            if not location or redirect_count == MAX_MEDIA_REDIRECTS:
                raise TikTokPlayerError("TikTok player fallback exceeded the media redirect limit.")
            current_url = _official_asset_url(urljoin(current_url, location), kind="media")

        if response is None or response.status_code not in (200, 206):
            status = response.status_code if response is not None else 0
            raise TikTokPlayerError(
                f"TikTok player fallback could not download media (HTTP {status})."
            )
        content_type = response.headers.get("content-type", "").lower().split(";", 1)[0]
        if not (
            content_type.startswith("video/")
            or content_type.startswith("audio/")
            or content_type == "application/octet-stream"
        ):
            raise TikTokPlayerError("TikTok player fallback returned an invalid media type.")
        declared = _content_length(response.headers)
        if declared is not None and declared > MAX_MEDIA_BYTES:
            raise TikTokPlayerError("Mídia do fallback oficial do TikTok é grande demais.")

        destination.parent.mkdir(parents=True, exist_ok=True)
        total = 0
        with destination.open("wb") as output:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if not chunk:
                    continue
                total += len(chunk)
                if total > MAX_MEDIA_BYTES:
                    raise TikTokPlayerError("Mídia do fallback oficial do TikTok é grande demais.")
                output.write(chunk)
        if total == 0:
            raise TikTokPlayerError("TikTok player fallback returned empty media.")
    except requests.RequestException as exc:
        raise TikTokPlayerError(
            "TikTok player fallback could not download official media."
        ) from exc
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    finally:
        if response is not None:
            response.close()
        session.close()
