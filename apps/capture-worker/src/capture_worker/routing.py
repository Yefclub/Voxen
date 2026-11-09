"""URL validation and platform routing (decided by host, never by content)."""

from __future__ import annotations

import functools
import re
from dataclasses import dataclass
from urllib.parse import urlsplit

from .errors import INVALID_URL, UNSUPPORTED, error

MAX_URL_LENGTH = 2048

_YOUTUBE_HOSTS = {"youtube.com", "youtu.be", "youtube-nocookie.com", "music.youtube.com"}
_TIKTOK_HOSTS = {"tiktok.com", "vm.tiktok.com", "vt.tiktok.com"}
_INSTAGRAM_HOSTS = {"instagram.com", "instagr.am"}
_X_HOSTS = {"x.com", "twitter.com", "mobile.twitter.com", "mobile.x.com"}

_X_STATUS_RE = re.compile(r"/(?:[^/]+/)?status(?:es)?/(\d{1,20})(?:[/?#]|$)")
# Extractors that match too broadly to count as a "real" site extractor.
_IGNORED_EXTRACTORS = {"Generic", "CommonMistakes", "CommonProtocols"}


@dataclass(frozen=True)
class Route:
    platform: str  # youtube | tiktok | instagram | x | web | other
    url: str
    use_ytdlp: bool
    x_status_id: str | None = None


def validate_url(raw: object) -> str:
    if not isinstance(raw, str):
        raise error(INVALID_URL)
    url = raw.strip()
    if not url or len(url) > MAX_URL_LENGTH or any(ch.isspace() for ch in url):
        raise error(INVALID_URL)
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError as exc:
        raise error(INVALID_URL) from exc
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise error(INVALID_URL)
    if parts.username is not None or parts.password is not None:
        raise error(INVALID_URL)
    if port is not None and not 0 < port < 65536:
        raise error(INVALID_URL)
    return url


def _base_host(host: str) -> str:
    host = host.lower().rstrip(".")
    for prefix in ("www.", "m."):
        if host.startswith(prefix):
            return host[len(prefix) :]
    return host


def _matches(host: str, hosts: set[str]) -> bool:
    return host in hosts or any(host.endswith("." + h) for h in hosts)


def x_status_id(url: str) -> str | None:
    match = _X_STATUS_RE.search(urlsplit(url).path + "/")
    return match.group(1) if match else None


@functools.lru_cache(maxsize=1)
def _site_extractors() -> tuple[type, ...]:
    from yt_dlp.extractor import gen_extractor_classes

    return tuple(ie for ie in gen_extractor_classes() if ie.ie_key() not in _IGNORED_EXTRACTORS)


def has_site_extractor(url: str) -> bool:
    """True when a non-generic yt-dlp extractor claims the URL."""
    for ie in _site_extractors():
        try:
            if ie.suitable(url) and ie.working():
                return True
        except Exception:  # noqa: S112 - a broken extractor regex must not break routing
            continue
    return False


def route(url: str) -> Route:
    host = _base_host(urlsplit(url).hostname or "")
    if _matches(host, _YOUTUBE_HOSTS):
        return Route("youtube", url, use_ytdlp=True)
    if _matches(host, _TIKTOK_HOSTS):
        return Route("tiktok", url, use_ytdlp=True)
    if _matches(host, _INSTAGRAM_HOSTS):
        return Route("instagram", url, use_ytdlp=True)
    if _matches(host, _X_HOSTS):
        status_id = x_status_id(url)
        if status_id is None:
            raise error(UNSUPPORTED)
        return Route("x", url, use_ytdlp=False, x_status_id=status_id)
    if has_site_extractor(url):
        return Route("other", url, use_ytdlp=True)
    return Route("web", url, use_ytdlp=False)
