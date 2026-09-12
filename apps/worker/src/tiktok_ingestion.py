"""TikTok extraction recovery without growing the generic media pipeline."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yt_dlp.utils

from . import tiktok_player, uploaded_media, video_url, ytdl
from .pipeline_errors import PermanentError
from .safe_diagnostics import error_diagnostic

_EXTERNAL_ERRORS = (OSError, RuntimeError, yt_dlp.utils.YoutubeDLError)


@dataclass(frozen=True)
class TikTokProbeResult:
    probe: ytdl.VideoProbe
    player_item: tiktok_player.PlayerItem | None = None


def is_extraction_error(exc: BaseException) -> bool:
    text = str(exc).lower()
    return "tiktok" in text and (
        "unable to extract" in text
        or "rehydration" in text
        or "universal data" in text
        or "unexpected response from webpage request" in text
    )


async def _retry_official[T](call: Callable[[], Awaitable[T]], *, tries: int = 2) -> T:
    last_error: BaseException | None = None
    for attempt in range(tries):
        try:
            return await call()
        except _EXTERNAL_ERRORS as exc:
            last_error = exc
            if attempt < tries - 1:
                await asyncio.sleep(1.0)
    assert last_error is not None
    raise last_error


async def _retry_impersonated[T](call: Callable[[], Awaitable[T]], *, tries: int = 2) -> T:
    """Retry transient Chrome failures while handing extraction blocks to the player."""
    last_error: BaseException | None = None
    for attempt in range(tries):
        try:
            return await call()
        except _EXTERNAL_ERRORS as exc:
            if is_extraction_error(exc):
                raise
            last_error = exc
            if attempt < tries - 1:
                await asyncio.sleep(1.0)
    assert last_error is not None
    raise last_error


async def _proxy_url() -> str | None:
    options = await ytdl._runtime_options()
    proxy = options.get("proxy")
    return proxy if isinstance(proxy, str) else None


async def probe_player(source_url: str) -> tuple[ytdl.VideoProbe, tiktok_player.PlayerItem]:
    proxy_url = await _proxy_url()
    item = await asyncio.to_thread(
        tiktok_player.fetch_item_sync,
        source_url,
        proxy_url=proxy_url,
    )
    return (
        ytdl.VideoProbe(
            video_id=item.video_id,
            title=item.title,
            channel=item.author,
            duration_sec=item.duration_sec,
            published_at=None,
            thumbnail_url=item.thumbnail_url,
            language_hint=None,
            available_subtitles={},
            automatic_captions={},
            author=item.author,
            canonical_url=item.canonical_url,
            channel_url=(
                f"https://www.tiktok.com/@{item.author_handle}" if item.author_handle else None
            ),
        ),
        item,
    )


async def download_player_audio(item: tiktok_player.PlayerItem, out_dir: Path) -> Path:
    proxy_url = await _proxy_url()
    source_path = out_dir / f"{item.video_id}.player.mp4"
    audio_path = out_dir / f"{item.video_id}.opus"
    try:
        await asyncio.to_thread(
            tiktok_player.download_media_sync,
            item,
            source_path,
            proxy_url=proxy_url,
        )
        await uploaded_media.extract_audio_opus(source_path, audio_path)
    finally:
        source_path.unlink(missing_ok=True)
    if not audio_path.exists() or audio_path.stat().st_size <= 0:
        raise tiktok_player.TikTokPlayerError(
            "TikTok player fallback did not produce transcribable audio."
        )
    return audio_path


async def probe_after_extraction_error(
    source_url: str,
    *,
    user_id: str,
    initial_error: BaseException,
    log: Any,
) -> TikTokProbeResult:
    if video_url.detect_source(source_url) != "TIKTOK" or not is_extraction_error(initial_error):
        raise initial_error
    log.warning(
        "tiktok-probe-retry-impersonate-chrome",
        **error_diagnostic(initial_error, "TIKTOK_PROBE_RETRY"),
    )
    try:
        probe = await _retry_impersonated(
            lambda: ytdl.probe(
                source_url,
                user_id=user_id,
                force_impersonate="chrome",
            )
        )
        return TikTokProbeResult(probe=probe)
    except _EXTERNAL_ERRORS as impersonated_error:
        if not is_extraction_error(impersonated_error):
            raise
        log.warning(
            "tiktok-probe-fallback-official-player",
            **error_diagnostic(impersonated_error, "TIKTOK_PLAYER_FALLBACK"),
        )
        try:
            probe, item = await _retry_official(lambda: probe_player(source_url))
        except _EXTERNAL_ERRORS as player_error:
            raise PermanentError.public(
                "EXTERNAL_DOWNLOAD_BLOCKED",
                "O extrator e o player oficial do TikTok não conseguiram acessar "
                "este vídeo público. Confirme que o link continua disponível ou "
                "envie o arquivo por upload manual.",
            ) from player_error
        return TikTokProbeResult(probe=probe, player_item=item)


async def download_known_player_audio(
    item: tiktok_player.PlayerItem,
    out_dir: Path,
) -> Path:
    try:
        return await _retry_official(lambda: download_player_audio(item, out_dir))
    except _EXTERNAL_ERRORS as player_error:
        raise PermanentError.public(
            "EXTERNAL_DOWNLOAD_BLOCKED",
            "O player oficial do TikTok encontrou o vídeo, mas não conseguiu obter "
            "uma faixa de áudio reproduzível. Confirme que o link continua disponível "
            "ou envie o arquivo por upload manual.",
        ) from player_error


async def download_after_extraction_error(
    source_url: str,
    out_dir: Path,
    *,
    user_id: str,
    initial_error: BaseException,
    log: Any,
) -> Path:
    if video_url.detect_source(source_url) != "TIKTOK" or not is_extraction_error(initial_error):
        raise initial_error
    log.warning(
        "tiktok-audio-retry-impersonate-chrome",
        **error_diagnostic(initial_error, "TIKTOK_AUDIO_RETRY"),
    )
    try:
        return await _retry_impersonated(
            lambda: ytdl.download_audio_opus(
                source_url,
                out_dir,
                user_id=user_id,
                force_impersonate="chrome",
            )
        )
    except _EXTERNAL_ERRORS as impersonated_error:
        if not is_extraction_error(impersonated_error):
            raise
        log.warning(
            "tiktok-audio-fallback-official-player",
            **error_diagnostic(impersonated_error, "TIKTOK_PLAYER_FALLBACK"),
        )
        try:
            _, item = await _retry_official(lambda: probe_player(source_url))
            return await _retry_official(lambda: download_player_audio(item, out_dir))
        except _EXTERNAL_ERRORS as player_error:
            raise PermanentError.public(
                "EXTERNAL_DOWNLOAD_BLOCKED",
                "O extrator e o player oficial do TikTok não conseguiram obter o "
                "áudio deste vídeo público. Confirme que o link continua disponível "
                "ou envie o arquivo por upload manual.",
            ) from player_error
