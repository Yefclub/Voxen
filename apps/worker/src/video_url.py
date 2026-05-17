"""Detector de plataforma pela URL (YouTube/Instagram/TikTok).

Espelha apps/web/src/lib/video-url.ts pra que worker e web concordem no
source enum baseado na URL canonical.
"""

from __future__ import annotations

from urllib.parse import urlparse


def detect_source(url: str) -> str | None:
    """Retorna 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK' | None pela URL canonical.

    Não valida formato de ID — só identifica a plataforma pelo host.
    """
    try:
        u = urlparse(url)
    except ValueError:
        return None
    if u.scheme not in ("http", "https") or not u.hostname:
        return None
    # Remove só prefixos (não global) — "m.youtube.com" → "youtube.com",
    # mas "instagram.com" NÃO vira "instagra.co" (str.replace é global).
    host = u.hostname.lower()
    for prefix in ("www.", "m.", "music."):
        if host.startswith(prefix):
            host = host[len(prefix):]
            break
    if host in ("youtu.be", "youtube.com"):
        return "YOUTUBE"
    if host == "instagram.com":
        return "INSTAGRAM"
    if host in ("tiktok.com", "vm.tiktok.com", "vt.tiktok.com"):
        return "TIKTOK"
    return None
