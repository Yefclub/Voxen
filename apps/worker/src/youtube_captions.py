"""Caminho de legendas do YouTube: API pública, sem baixar mídia.

Separado de `ytdl.py` porque não é o mesmo trabalho — aqui não há yt-dlp, só a
API pública de transcripts e o oEmbed. O pipeline tenta este caminho antes de
baixar áudio, e ele é best-effort de propósito: qualquer falha cai no yt-dlp.
"""

from __future__ import annotations

import asyncio
import xml.etree.ElementTree
from typing import Any
from urllib.parse import urlencode

import requests
import structlog
from youtube_transcript_api._api import YouTubeTranscriptApi
from youtube_transcript_api._errors import NoTranscriptFound, YouTubeTranscriptApiException
from youtube_transcript_api.proxies import GenericProxyConfig

from .safe_diagnostics import error_diagnostic
from .transcript_md import Segment
from .ytdl import (
    TranscriptFetch,
    VideoProbe,
    _clean_cue_line,
    _is_supported_proxy,
    _runtime_options,
    _youtube_video_id,
)

logger = structlog.get_logger(__name__)

PREFERRED_TRANSCRIPT_LANGS = ("pt", "pt-BR", "pt-PT", "en", "en-US", "en-GB")


async def fetch_youtube_transcript(url: str) -> TranscriptFetch | None:
    """Tenta buscar transcript/legenda do YouTube sem baixar midia.

    Best-effort por design: qualquer falha cai no pipeline normal do yt-dlp.
    Isso evita transformar bloqueio/rate-limit do endpoint de transcripts em
    falha definitiva antes de tentar os fallbacks existentes.
    """
    video_id = _youtube_video_id(url)
    if video_id is None:
        return None

    base_opts = await _runtime_options()
    proxy_url = base_opts.get("proxy")

    return await asyncio.to_thread(_fetch_youtube_transcript_sync, video_id, proxy_url)


def _fetch_youtube_transcript_sync(video_id: str, proxy_url: str | None) -> TranscriptFetch | None:
    try:
        api = YouTubeTranscriptApi(proxy_config=_transcript_proxy_config(proxy_url))
        try:
            fetched: Any = api.fetch(video_id, languages=PREFERRED_TRANSCRIPT_LANGS)
        except NoTranscriptFound:
            fetched = _fetch_any_transcript(api, video_id)
            if fetched is None:
                logger.info("youtube-transcript-api-empty", video_id=video_id, reason="no-track")
                return None

        segments = tuple(
            Segment(start_sec=float(snippet.start), text=_clean_cue_line(snippet.text))
            for snippet in fetched
            if snippet.text.strip()
        )
        if not segments:
            logger.info("youtube-transcript-api-empty", video_id=video_id, reason="blank-cues")
            return None

        metadata = _fetch_youtube_oembed(video_id, proxy_url)
        duration_sec = _fetched_transcript_duration_sec(fetched)
        language = getattr(fetched, "language_code", None) or "auto"
        probe = VideoProbe(
            video_id=video_id,
            title=metadata.get("title") or "(sem título)",
            channel=metadata.get("author_name"),
            duration_sec=duration_sec,
            published_at=None,
            thumbnail_url=metadata.get("thumbnail_url")
            or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
            language_hint=language,
            available_subtitles={},
            automatic_captions={},
            author=metadata.get("author_name"),
            canonical_url=f"https://www.youtube.com/watch?v={video_id}",
            channel_url=metadata.get("author_url"),
        )
        return TranscriptFetch(probe=probe, segments=segments, language=language.split("-")[0])
    except (
        OSError,
        requests.RequestException,
        YouTubeTranscriptApiException,
        xml.etree.ElementTree.ParseError,
    ) as exc:
        # Best-effort continua sendo o comportamento: o pipeline cai no yt-dlp.
        # Mas engolir sem registrar tornava "vídeo sem legenda" e "endpoint de
        # legendas bloqueado" indistinguíveis no log, e a ação do operador é
        # diferente em cada um — o segundo caso quer proxy/POT, o primeiro não
        # tem o que fazer. Sem esta linha, só sobra a falha do yt-dlp depois.
        logger.info(
            "youtube-transcript-api-unavailable",
            video_id=video_id,
            # Efetivo, não configurado: `_transcript_proxy_config` descarta
            # esquema não suportado, então um `socks4://` em `yt_dlp_proxy_urls`
            # sai direto pelo IP do servidor. Registrar a intenção aqui afirmaria
            # `proxied=True` justamente no caso que explica o bloqueio.
            proxied=_is_supported_proxy(proxy_url),
            **error_diagnostic(exc, "YOUTUBE_TRANSCRIPT_API_UNAVAILABLE"),
        )
        return None


def _fetch_any_transcript(api: YouTubeTranscriptApi, video_id: str) -> Any | None:
    transcript_list = api.list(video_id)
    for transcript in transcript_list:
        return transcript.fetch()
    return None


def _fetched_transcript_duration_sec(fetched: Any) -> int:
    max_end = 0.0
    for snippet in fetched:
        max_end = max(max_end, float(snippet.start) + float(snippet.duration))
    return max(1, int(max_end + 0.999))


def _fetch_youtube_oembed(video_id: str, proxy_url: str | None) -> dict[str, str]:
    url = f"https://www.youtube.com/watch?v={video_id}"
    query = urlencode({"url": url, "format": "json"})
    try:
        resp = requests.get(
            f"https://www.youtube.com/oembed?{query}",
            timeout=10,
            proxies=_requests_proxy_dict(proxy_url),
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException:
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): str(v) for k, v in data.items() if isinstance(v, str)}


def _transcript_proxy_config(proxy_url: str | None) -> GenericProxyConfig | None:
    if not _is_supported_proxy(proxy_url):
        return None
    return GenericProxyConfig(http_url=proxy_url, https_url=proxy_url)


def _requests_proxy_dict(proxy_url: str | None) -> dict[str, str] | None:
    if not _is_supported_proxy(proxy_url):
        return None
    assert proxy_url is not None  # garantido por _is_supported_proxy
    return {"http": proxy_url, "https": proxy_url}
