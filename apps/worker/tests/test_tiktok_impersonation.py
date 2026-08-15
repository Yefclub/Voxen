"""Fix de TikTok: impersonation de browser (curl_cffi) + erro amigável.

TikTok exige imitar o TLS/JA3 de um browser real. O extractor do yt-dlp pede
impersonation sozinho; basta o backend `curl_cffi` (extra yt-dlp[curl-cffi])
estar instalado para ele auto-selecionar um alvo. O env `YTDLP_IMPERSONATE`
força um alvo específico quando o padrão falha.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import pytest
import yt_dlp.utils

from src import pipeline, ytdl


class _Logger:
    def info(self, *_args: object, **_kwargs: object) -> None:
        pass

    def warning(self, *_args: object, **_kwargs: object) -> None:
        pass


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


def test_friendly_error_tiktok_unexpected_webpage_response() -> None:
    exc = RuntimeError("ERROR: [TikTok] ZSvJHUMAG: Unexpected response from webpage request")
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


def test_is_tiktok_unexpected_webpage_response_error() -> None:
    assert pipeline._is_tiktok_rehydration_error(
        RuntimeError("ERROR: [TikTok] ZSvJHUMAG: Unexpected response from webpage request")
    )


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


def test_friendly_error_proxy_refused() -> None:
    # Erro real quando o túnel SOCKS do Agente de Proxy está fora do ar.
    exc = RuntimeError(
        "ERROR: [vm.tiktok] ZSXL5NWgh: Unable to download webpage: "
        "SocksHTTPSConnection(host='vt.tiktok.com', port=443): Failed to establish "
        "a new connection: [Errno 111] Connection refused"
    )
    msg = pipeline._friendly_external_error(exc)
    assert msg is not None
    assert "proxy" in msg.lower()
    assert "integra" in msg.lower()


def test_friendly_error_connection_refused_without_proxy_not_matched() -> None:
    # Guarda contra falso-positivo: connection-refused SEM proxy/socks não deve
    # virar a mensagem de "proxy fora do ar".
    exc = RuntimeError("Failed to establish a new connection: [Errno 111] Connection refused")
    assert pipeline._friendly_external_error(exc) is None


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


async def test_tiktok_rehydration_bypasses_friendly_shortcircuit_with_passthrough() -> None:
    # Com `immediate_passthrough`, a rehydration é relançada crua (ainda
    # `_TRANSIENT_EXC`) em vez de virar `PermanentError` — é o que permite o
    # `except _TRANSIENT_EXC` do `_run_pipeline` capturar e acionar o retry
    # com `force_impersonate="chrome"`. Sem este parâmetro (teste abaixo), a
    # conversão amigável intercepta antes e o retry nunca é alcançado — essa
    # era a regressão real em produção.
    calls = 0

    async def fn() -> None:
        nonlocal calls
        calls += 1
        raise yt_dlp.utils.DownloadError(
            "ERROR: [TikTok] 123: Unable to extract universal data for rehydration"
        )

    with pytest.raises(yt_dlp.utils.DownloadError):
        await pipeline._retry_transient(
            fn, tries=3, immediate_passthrough=pipeline._is_tiktok_rehydration_error
        )
    assert calls == 1  # relançada crua na 1ª tentativa, sem consumir retries


async def test_tiktok_rehydration_without_passthrough_still_shortcircuits() -> None:
    # Sem o parâmetro (comportamento de todo outro chamador de
    # `_retry_transient`), a conversão amigável continua idêntica a antes —
    # este fix não muda nenhum outro call site.
    calls = 0

    async def fn() -> None:
        nonlocal calls
        calls += 1
        raise yt_dlp.utils.DownloadError(
            "ERROR: [TikTok] 123: Unable to extract universal data for rehydration"
        )

    with pytest.raises(pipeline.PermanentError):
        await pipeline._retry_transient(fn, tries=3)
    assert calls == 1


def _tiktok_probe(*, duration_sec: int = 30) -> ytdl.VideoProbe:
    return ytdl.VideoProbe(
        video_id="7000000000000000000",
        title="Vídeo de teste",
        channel="autor",
        duration_sec=duration_sec,
        published_at=None,
        thumbnail_url=None,
        language_hint=None,
        available_subtitles={},
        automatic_captions={},
    )


async def test_run_pipeline_retries_probe_with_impersonate_after_rehydration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Regressão de nível de integração (era o call site que estava quebrado,
    # não `_retry_transient` isolada — ver review da PR): prova que
    # `_run_pipeline` de fato chama `ytdl.probe` de novo com
    # `force_impersonate="chrome"` após a 1ª falha de rehydration, em vez de
    # abortar direto como `PermanentError`.
    probe = AsyncMock(
        side_effect=[
            yt_dlp.utils.DownloadError(
                "ERROR: [TikTok] 123: Unable to extract universal data for rehydration"
            ),
            # Curto-circuita o resto do pipeline sem precisar mockar
            # transcrição/persistência: duração > máxima vira PermanentError
            # logo em seguida, o suficiente pra provar que o retry rodou.
            _tiktok_probe(duration_sec=ytdl.MAX_DURATION_SEC + 1),
        ]
    )
    monkeypatch.setattr(pipeline.ytdl, "probe", probe)
    monkeypatch.setattr(pipeline.events, "publish_job_event", AsyncMock(return_value=None))

    with pytest.raises(pipeline.PermanentError, match="4 horas"):
        await pipeline._run_pipeline(
            job_id="job-1",
            user_id="user-1",
            source_url="https://www.tiktok.com/@user/video/7123456789012345678",
            log=_Logger(),
        )

    assert probe.await_count == 2
    assert probe.await_args_list[1].kwargs == {
        "user_id": "user-1",
        "force_impersonate": "chrome",
    }


async def test_run_pipeline_retries_audio_download_with_impersonate_after_rehydration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Simétrico ao teste acima, para o segundo call site (download de áudio).
    # Usa uma função (não `side_effect` em lista) porque `_retry_transient`
    # com `tries=2` pode chamar o mock mais de uma vez na tentativa de
    # impersonate — uma lista fixa de 2 itens arriscaria `StopIteration`.
    monkeypatch.setattr(pipeline.asyncio, "sleep", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline.ytdl, "probe", AsyncMock(return_value=_tiktok_probe()))
    monkeypatch.setattr(pipeline.events, "publish_job_event", AsyncMock(return_value=None))

    calls: list[dict[str, object]] = []

    async def fake_download_audio_opus(*_args: object, **kwargs: object) -> Path:
        calls.append(kwargs)
        if len(calls) == 1:
            raise yt_dlp.utils.DownloadError(
                "ERROR: [TikTok] 123: Unable to extract universal data for rehydration"
            )
        # Marcador só pra provar que a chamada com impersonate aconteceu —
        # não precisamos mockar transcrição/persistência pra este teste.
        raise RuntimeError("stop-here-marker")

    monkeypatch.setattr(pipeline.ytdl, "download_audio_opus", fake_download_audio_opus)

    with pytest.raises(RuntimeError, match="stop-here-marker"):
        await pipeline._run_pipeline(
            job_id="job-1",
            user_id="user-1",
            source_url="https://www.tiktok.com/@user/video/7123456789012345678",
            log=_Logger(),
        )

    assert len(calls) >= 2
    assert calls[0] == {"user_id": "user-1"}
    assert calls[1] == {"user_id": "user-1", "force_impersonate": "chrome"}
