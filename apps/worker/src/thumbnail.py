"""Espelha capas remotas (TikTok/IG/YouTube/OG) no S3.

URLs assinadas de CDN expiram e/ou bloqueiam hotlink no browser.
Persistimos bytes no storage próprio e a UI serve via /api/transcripts/:id/preview.
"""

from __future__ import annotations

import re
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import httpx
import structlog

from . import storage
from .safe_diagnostics import error_diagnostic

log = structlog.get_logger()

_MAX_BYTES = 8 * 1024 * 1024  # 8 MiB
_TIMEOUT = httpx.Timeout(20.0, connect=8.0)

_ALLOWED_HOST_SUFFIXES = (
    "ytimg.com",
    "ggpht.com",
    "googleusercontent.com",
    "tiktokcdn.com",
    "tiktokcdn-us.com",
    "tiktokv.com",
    "byteoversea.com",
    "ibyteimg.com",
    "cdninstagram.com",
    "fbcdn.net",
    "twimg.com",
    "pinimg.com",
)


def thumbnail_key(user_id: str, transcript_id: str, ext: str = "jpg") -> str:
    safe_ext = re.sub(r"[^a-z0-9]", "", ext.lower())[:8] or "jpg"
    return f"workspaces/{user_id}/transcripts/{transcript_id}/thumbnail.{safe_ext}"


def _host_allowed(host: str) -> bool:
    h = host.lower().rstrip(".")
    if not h or h in ("localhost", "127.0.0.1"):
        return False
    # Bloqueia IPs literais (SSRF básico)
    if re.fullmatch(r"\d{1,3}(\.\d{1,3}){3}", h):
        return False
    return any(h == s or h.endswith("." + s) for s in _ALLOWED_HOST_SUFFIXES)


def _ext_and_mime(content_type: str | None, url: str) -> tuple[str, str]:
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct in ("image/jpeg", "image/jpg"):
        return "jpg", "image/jpeg"
    if ct == "image/png":
        return "png", "image/png"
    if ct == "image/webp":
        return "webp", "image/webp"
    if ct == "image/gif":
        return "gif", "image/gif"
    path = urlparse(url).path.lower()
    if path.endswith(".png"):
        return "png", "image/png"
    if path.endswith(".webp"):
        return "webp", "image/webp"
    if path.endswith(".gif"):
        return "gif", "image/gif"
    return "jpg", "image/jpeg"


async def mirror_remote_thumbnail(
    *,
    remote_url: str | None,
    user_id: str,
    transcript_id: str,
    referer: str | None = None,
) -> tuple[str, str] | None:
    """Baixa a capa remota e grava no S3.

    Returns:
        (preview_object_key, preview_mime_type) ou None se não espelhou.
    """
    if not remote_url or not remote_url.startswith(("http://", "https://")):
        return None
    # Já é URL interna do app — não baixar.
    if remote_url.startswith("/api/"):
        return None

    try:
        parsed = urlparse(remote_url)
    except Exception:  # noqa: BLE001
        return None
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return None
    if not _host_allowed(parsed.hostname):
        log.info("thumbnail-host-skipped", reason="host_not_allowed")
        return None

    headers = {
        "User-Agent": ("Mozilla/5.0 (compatible; VoxenBot/1.0; +https://github.com/Yefclub/Voxen)"),
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    }
    if referer:
        headers["Referer"] = referer

    try:
        async with httpx.AsyncClient(
            timeout=_TIMEOUT,
            follow_redirects=True,
            max_redirects=5,
        ) as client:
            resp = await client.get(remote_url, headers=headers)
            if resp.status_code >= 400:
                log.warning(
                    "thumbnail-fetch-http",
                    status=resp.status_code,
                )
                return None
            body = resp.content
            if not body or len(body) > _MAX_BYTES:
                log.warning("thumbnail-fetch-size", size=len(body) if body else 0)
                return None
            # Magic bytes mínimos
            if not (
                body[:3] == b"\xff\xd8\xff"
                or body[:8] == b"\x89PNG\r\n\x1a\n"
                or body[:4] == b"RIFF"
                or body[:6] in (b"GIF87a", b"GIF89a")
            ):
                # aceita webp RIFF....WEBP
                if not (len(body) > 12 and body[8:12] == b"WEBP"):
                    log.warning("thumbnail-fetch-not-image")
                    return None
            ext, mime = _ext_and_mime(resp.headers.get("content-type"), remote_url)
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "thumbnail-fetch-failed",
            **error_diagnostic(exc, "THUMBNAIL_FETCH_FAILED"),
        )
        return None

    key = thumbnail_key(user_id, transcript_id, ext)
    tmp: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as fh:
            tmp = Path(fh.name)
            fh.write(body)
        await storage.put_file(key=key, path=tmp, content_type=mime)
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "thumbnail-upload-failed",
            **error_diagnostic(exc, "THUMBNAIL_UPLOAD_FAILED"),
        )
        return None
    finally:
        if tmp is not None:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass

    log.info("thumbnail-mirrored", key=key, mime=mime, bytes=len(body))
    return key, mime


def public_preview_path(transcript_id: str) -> str:
    return f"/api/transcripts/{transcript_id}/preview"


async def resolve_thumbnail_for_persist(
    *,
    remote_url: str | None,
    user_id: str,
    transcript_id: str,
    source_url: str | None = None,
) -> tuple[str, str | None, str | None]:
    """Espelha se possível; sempre devolve URL de preview estável do app.

    Returns:
        (thumbnail_url_for_db, preview_object_key|None, preview_mime|None)
    """
    mirrored = await mirror_remote_thumbnail(
        remote_url=remote_url,
        user_id=user_id,
        transcript_id=transcript_id,
        referer=source_url,
    )
    stable = public_preview_path(transcript_id)
    if mirrored:
        return stable, mirrored[0], mirrored[1]
    # Sem espelho: ainda assim apontamos pro endpoint interno (SVG fallback),
    # evitando hotlink quebrado de CDN no browser.
    return stable, None, None
