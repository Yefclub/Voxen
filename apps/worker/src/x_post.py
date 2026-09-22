"""Captura determinística de posts públicos do X via endpoint de syndication.

O endpoint é público, não documentado e pode mudar sem aviso; por isso a captura
é sempre best-effort e o pipeline cai de volta para a busca nativa do modelo
quando ela falha. O token enviado não é validado pelo endpoint (verificado em
2026-09), então geramos um valor base36 estável em vez de replicar o algoritmo
do widget oficial.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

import httpx

SYNDICATION_URL = "https://cdn.syndication.twimg.com/tweet-result"
_MAX_METADATA_BYTES = 512 * 1024
_TIMEOUT_SECONDS = 10.0
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
)
_STATUS_ID_RE = re.compile(r"[0-9]{6,32}")
_ALLOWED_MEDIA_HOST_SUFFIXES = ("twimg.com",)
_BASE36_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"


class XCaptureError(RuntimeError):
    """Falha sanitizada de captura determinística, segura para logs."""


@dataclass(frozen=True)
class XPostMedia:
    kind: str  # photo | video | gif
    url: str
    alt_text: str | None = None


@dataclass(frozen=True)
class XPost:
    status_id: str
    text: str
    author_name: str | None = None
    author_handle: str | None = None
    created_at: datetime | None = None
    lang: str | None = None
    like_count: int | None = None
    reply_count: int | None = None
    possibly_sensitive: bool = False
    media: tuple[XPostMedia, ...] = ()

    @property
    def permalink(self) -> str:
        return f"https://x.com/i/status/{self.status_id}"

    @property
    def channel(self) -> str | None:
        return f"@{self.author_handle}" if self.author_handle else None

    @property
    def preview_url(self) -> str | None:
        for item in self.media:
            if item.kind == "photo":
                return item.url
        return self.media[0].url if self.media else None

    @property
    def suggested_title(self) -> str | None:
        for raw_line in self.text.splitlines():
            line = re.sub(r"\s+", " ", raw_line).strip()
            if len(line) < 8:
                continue
            return line if len(line) <= 97 else f"{line[:97]}…"
        return None


@dataclass(frozen=True)
class XContentSelection:
    content: str
    source: str  # analysis | capture | none
    unavailable: bool


def syndication_token(status_id: str) -> str:
    """Token base36 estável; o endpoint aceita qualquer valor não vazio."""
    value = int(status_id)
    token = ""
    while value > 0 and len(token) < 12:
        value, remainder = divmod(value, 36)
        token = _BASE36_DIGITS[remainder] + token
    return token or "0"


def _safe_media_url(raw: Any) -> str | None:
    if not isinstance(raw, str):
        return None
    url = raw.strip()
    try:
        parsed = urlparse(url)
        host = parsed.hostname.lower().rstrip(".") if parsed.hostname else ""
    except ValueError:
        return None
    if parsed.scheme != "https" or not host:
        return None
    if not any(
        host == suffix or host.endswith(f".{suffix}") for suffix in _ALLOWED_MEDIA_HOST_SUFFIXES
    ):
        return None
    return url


def _parse_count(raw: Any) -> int | None:
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    if not math.isfinite(raw):
        return None
    value = int(raw)
    return value if value >= 0 else None


def _parse_created_at(raw: Any) -> datetime | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        parsed = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _best_video_variant(raw: Any) -> str | None:
    if not isinstance(raw, dict):
        return None
    variants = raw.get("variants")
    if not isinstance(variants, list):
        return None
    best: tuple[int, str] | None = None
    for variant in variants:
        if not isinstance(variant, dict):
            continue
        if str(variant.get("content_type") or "") != "video/mp4":
            continue
        url = _safe_media_url(variant.get("url"))
        if url is None:
            continue
        try:
            bitrate = int(variant.get("bitrate") or 0)
        except (TypeError, ValueError):
            bitrate = 0
        if best is None or bitrate > best[0]:
            best = (bitrate, url)
    return best[1] if best else None


def _parse_media(raw: Any) -> tuple[XPostMedia, ...]:
    if not isinstance(raw, list):
        return ()
    items: list[XPostMedia] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        raw_alt = entry.get("ext_alt_text")
        alt_text = raw_alt.strip() if isinstance(raw_alt, str) and raw_alt.strip() else None
        kind = str(entry.get("type") or "photo").lower()
        if kind in ("video", "animated_gif"):
            url = _best_video_variant(entry.get("video_info")) or _safe_media_url(
                entry.get("media_url_https")
            )
            if url is None:
                continue
            items.append(
                XPostMedia(kind="video" if kind == "video" else "gif", url=url, alt_text=alt_text)
            )
            continue
        url = _safe_media_url(entry.get("media_url_https"))
        if url is None:
            continue
        items.append(XPostMedia(kind="photo", url=url, alt_text=alt_text))
    return tuple(items)


def parse_x_post_payload(status_id: str, payload: Any) -> XPost | None:
    if not isinstance(payload, dict) or payload.get("__typename") != "Tweet":
        return None
    if str(payload.get("id_str") or "") != status_id:
        return None

    text = ""
    note = payload.get("note_tweet")
    if isinstance(note, dict) and isinstance(note.get("text"), str):
        text = note["text"]
    if not text and isinstance(payload.get("text"), str):
        text = payload["text"]
    text = text.strip()

    media = _parse_media(payload.get("mediaDetails"))
    if not text and not media:
        return None

    raw_user = payload.get("user")
    user: dict[str, Any] = raw_user if isinstance(raw_user, dict) else {}
    raw_name = user.get("name")
    raw_handle = user.get("screen_name")
    raw_lang = payload.get("lang")
    normalized_lang = raw_lang.strip() if isinstance(raw_lang, str) else ""
    return XPost(
        status_id=status_id,
        text=text,
        author_name=raw_name.strip() if isinstance(raw_name, str) and raw_name.strip() else None,
        author_handle=raw_handle.strip()
        if isinstance(raw_handle, str) and raw_handle.strip()
        else None,
        created_at=_parse_created_at(payload.get("created_at")),
        lang=normalized_lang if normalized_lang and normalized_lang.lower() != "und" else None,
        like_count=_parse_count(payload.get("favorite_count")),
        reply_count=_parse_count(payload.get("conversation_count")),
        possibly_sensitive=payload.get("possibly_sensitive") is True,
        media=media,
    )


async def fetch_x_post(
    status_id: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> XPost | None:
    """Devolve o post público ou None quando ele não existe mais/está restrito."""
    if not _STATUS_ID_RE.fullmatch(status_id):
        return None

    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient(
            timeout=httpx.Timeout(_TIMEOUT_SECONDS, connect=min(_TIMEOUT_SECONDS, 5.0)),
            follow_redirects=True,
        )
    try:
        try:
            response = await client.get(
                SYNDICATION_URL,
                params={"id": status_id, "lang": "en", "token": syndication_token(status_id)},
                headers={"User-Agent": _USER_AGENT, "Accept": "application/json"},
            )
        except httpx.HTTPError as exc:
            raise XCaptureError("X syndication request failed") from exc
        if response.status_code != 200:
            raise XCaptureError(f"X syndication rejected the request (HTTP {response.status_code})")
        if len(response.content) > _MAX_METADATA_BYTES:
            raise XCaptureError("X syndication returned oversized metadata")
        try:
            payload = response.json()
        except ValueError as exc:
            raise XCaptureError("X syndication returned a non-JSON payload") from exc
        try:
            return parse_x_post_payload(status_id, payload)
        except (TypeError, ValueError, OverflowError) as exc:
            raise XCaptureError("X syndication payload could not be parsed") from exc
    finally:
        if owns_client:
            await client.aclose()


def render_x_post_context(post: XPost) -> str:
    """Fatos do post para grounding do modelo, sem prosa nossa."""
    lines: list[str] = []
    author = post.author_name or ""
    if post.author_handle:
        author = f"{author} (@{post.author_handle})".strip()
    if author:
        lines.append(f"Autor: {author}")
    if post.created_at is not None:
        lines.append(f"Publicado em: {post.created_at.isoformat()}")
    lines.append(f"Link: {post.permalink}")
    metrics: list[str] = []
    if post.like_count is not None:
        metrics.append(f"{post.like_count} curtidas")
    if post.reply_count is not None:
        metrics.append(f"{post.reply_count} respostas")
    if metrics:
        lines.append("Métricas: " + ", ".join(metrics))
    if post.media:
        labels = {"photo": "Foto", "video": "Vídeo", "gif": "GIF"}
        lines.append("Mídia:")
        for item in post.media:
            label = labels.get(item.kind, "Mídia")
            suffix = f" (descrição: {item.alt_text})" if item.alt_text else ""
            lines.append(f"- {label}: {item.url}{suffix}")
    lines.append("")
    lines.append("Texto do post:")
    lines.append(post.text)
    return "\n".join(lines).strip()


def render_x_post_markdown(post: XPost) -> str:
    """Conteúdo canônico de fallback quando o modelo não pôde analisar o post."""
    return (
        f"Conteúdo capturado diretamente do X.\n\n{render_x_post_context(post)}\n"
    ).strip() + "\n"


def select_x_content(
    *,
    capture_markdown: str | None,
    analysis_text: str | None,
    analysis_accessible: bool | None,
) -> XContentSelection:
    """Decide o conteúdo canônico a partir da captura e da análise do modelo."""
    clean_capture = (capture_markdown or "").strip()
    clean_analysis = (analysis_text or "").strip()

    if clean_capture:
        if clean_analysis and analysis_accessible is not False:
            return XContentSelection(content=clean_analysis, source="analysis", unavailable=False)
        return XContentSelection(content=clean_capture, source="capture", unavailable=False)

    if not clean_analysis or analysis_accessible is False:
        return XContentSelection(content="", source="none", unavailable=True)
    return XContentSelection(content=clean_analysis, source="analysis", unavailable=False)
