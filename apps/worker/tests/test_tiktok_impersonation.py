"""Fix de TikTok: impersonation de browser (curl_cffi) + erro amigável.

TikTok exige imitar o TLS/JA3 de um browser real. O extractor do yt-dlp pede
impersonation sozinho; basta o backend `curl_cffi` (extra yt-dlp[curl-cffi])
estar instalado para ele auto-selecionar um alvo. O env `YTDLP_IMPERSONATE`
força um alvo específico quando o padrão falha.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
import yt_dlp.utils

from src import pipeline, ytdl


def test_curl_cffi_backend_installed() -> None:
    import curl_cffi  # noqa: F401 — só garante que o extra está instalado
    from yt_dlp import YoutubeDL
    from yt_dlp.networking.impersonate import ImpersonateTarget

    ydl = YoutubeDL({"quiet": True})
    assert ydl._impersonate_target_available(ImpersonateTarget.from_str("chrome"))


async def test_runtime_options_no_impersonate_by_default(monkeypatch) -> None:
    monkeypatch.delenv("YTDLP_IMPERSONATE", raising=False)
    monkeypatch.delenv("YTDLP_PROXY_URLS", raising=False)
    monkeypatch.delenv("YTDLP_PROXY_URL", raising=False)
    monkeypatch.setattr(ytdl.voxen_settings, "get_yt_dlp_proxy_urls", AsyncMock(return_value=None))
    opts = await ytdl._runtime_options()
    assert "impersonate" not in opts


async def test_runtime_options_forces_impersonate_from_env(monkeypatch) -> None:
    monkeypatch.setenv("YTDLP_IMPERSONATE", "chrome")
    monkeypatch.setattr(ytdl.voxen_settings, "get_yt_dlp_proxy_urls", AsyncMock(return_value=None))
    opts = await ytdl._runtime_options()
    assert "impersonate" in opts
    assert str(opts["impersonate"]).startswith("chrome")


async def test_runtime_options_impersonate_disabled_value(monkeypatch) -> None:
    monkeypatch.setenv("YTDLP_IMPERSONATE", "off")
    monkeypatch.setattr(ytdl.voxen_settings, "get_yt_dlp_proxy_urls", AsyncMock(return_value=None))
    opts = await ytdl._runtime_options()
    assert "impersonate" not in opts


async def test_runtime_options_invalid_target_degrades_gracefully(monkeypatch) -> None:
    # Alvo inválido não deve derrubar o job por config: o except segura e o
    # extractor ainda pode auto-selecionar (spec 035 R2).
    monkeypatch.setenv("YTDLP_IMPERSONATE", "not-a-real-target")
    monkeypatch.setattr(ytdl.voxen_settings, "get_yt_dlp_proxy_urls", AsyncMock(return_value=None))
    opts = await ytdl._runtime_options()
    assert "impersonate" not in opts


def test_friendly_error_tiktok_rehydration() -> None:
    exc = RuntimeError(
        "ERROR: [TikTok] 7652846085165239573: Unable to extract universal data "
        "for rehydration; please report this issue on https://github.com/yt-dlp/yt-dlp/issues"
    )
    msg = pipeline._friendly_external_error(exc)
    assert msg is not None
    assert "TikTok" in msg
    assert "upload" in msg.lower()


def test_friendly_error_http_403() -> None:
    msg = pipeline._friendly_external_error(RuntimeError("HTTP Error 403: Forbidden"))
    assert msg is not None
    assert "403" in msg or "recusou" in msg.lower()


def test_friendly_error_rate_limit() -> None:
    msg = pipeline._friendly_external_error(RuntimeError("HTTP Error 429: Too Many Requests"))
    assert msg is not None
    assert "rate" in msg.lower() or "requisi" in msg.lower()


def test_is_tiktok_rehydration_error() -> None:
    assert pipeline._is_tiktok_rehydration_error(
        RuntimeError("ERROR: [TikTok] Unable to extract universal data for rehydration")
    )
    assert not pipeline._is_tiktok_rehydration_error(RuntimeError("HTTP Error 404"))


def test_runtime_versions_has_ytdlp() -> None:
    versions = ytdl.runtime_versions()
    assert "yt_dlp_version" in versions
    assert versions["yt_dlp_version"] not in ("",)


def test_friendly_error_no_audio_codec() -> None:
    # Reels/posts servidos só-vídeo fazem o FFmpegExtractAudio estourar no ffprobe.
    exc = RuntimeError(
        "ERROR: Postprocessing: WARNING: unable to obtain file audio codec with ffprobe"
    )
    msg = pipeline._friendly_external_error(exc)
    assert msg is not None
    assert "áudio" in msg.lower()
    assert "upload" in msg.lower()


def test_friendly_error_non_tiktok_returns_none() -> None:
    assert pipeline._friendly_external_error(RuntimeError("algo sem relação")) is None


async def test_no_audio_short_circuits_without_retry() -> None:
    # Falha determinística "sem áudio" não deve retentar: _retry_transient detecta
    # o erro amigável e levanta PermanentError na 1ª tentativa (spec 002).
    calls = 0

    async def fn() -> None:
        nonlocal calls
        calls += 1
        raise yt_dlp.utils.PostProcessingError(
            "ERROR: Postprocessing: WARNING: unable to obtain file audio codec with ffprobe"
        )

    with pytest.raises(pipeline.PermanentError):
        await pipeline._retry_transient(fn, tries=3)
    assert calls == 1  # sem retries (curto-circuito)
