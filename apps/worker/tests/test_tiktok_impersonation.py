"""Fix de TikTok: impersonation de browser (curl_cffi) + erro amigável.

TikTok exige imitar o TLS/JA3 de um browser real. O extractor do yt-dlp pede
impersonation sozinho; basta o backend `curl_cffi` (extra yt-dlp[curl-cffi])
estar instalado para ele auto-selecionar um alvo. O env `YTDLP_IMPERSONATE`
força um alvo específico quando o padrão falha.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

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
