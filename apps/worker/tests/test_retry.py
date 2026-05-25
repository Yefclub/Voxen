"""Testes do retry helper — confirma que pega exceptions reais de yt-dlp + botocore.

Bug encontrado em review da PR 8b: o `_retry_transient` capturava apenas
(TransientError, OSError, RuntimeError) — yt-dlp `YoutubeDLError` e botocore
`BotoCoreError`/`ClientError` herdam direto de Exception. Sem este teste,
qualquer regressão futura no `_TRANSIENT_EXC` deixa retry virar no-op.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import botocore.exceptions
import pytest
import yt_dlp.utils

from src import ytdl
from src.pipeline import PermanentError, TransientError, _retry_transient


async def test_retry_succeeds_on_third_attempt() -> None:
    attempts = 0

    async def fn() -> str:
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise TransientError("fail")
        return "ok"

    result = await _retry_transient(fn, tries=3, base_delay=0)
    assert result == "ok"
    assert attempts == 3


async def test_retry_catches_ytdlp_download_error() -> None:
    attempts = 0

    async def fn() -> None:
        nonlocal attempts
        attempts += 1
        raise yt_dlp.utils.DownloadError("simulated")

    with pytest.raises(yt_dlp.utils.DownloadError):
        await _retry_transient(fn, tries=3, base_delay=0)
    assert attempts == 3, "retry deve tentar 3 vezes mesmo com DownloadError"


async def test_retry_catches_botocore_client_error() -> None:
    attempts = 0

    async def fn() -> None:
        nonlocal attempts
        attempts += 1
        raise botocore.exceptions.ClientError(
            {"Error": {"Code": "InternalError", "Message": "fail"}}, "PutObject"
        )

    with pytest.raises(botocore.exceptions.ClientError):
        await _retry_transient(fn, tries=3, base_delay=0)
    assert attempts == 3


async def test_retry_catches_botocore_endpoint_connection_error() -> None:
    attempts = 0

    async def fn() -> None:
        nonlocal attempts
        attempts += 1
        raise botocore.exceptions.EndpointConnectionError(endpoint_url="http://minio:9000")

    with pytest.raises(botocore.exceptions.EndpointConnectionError):
        await _retry_transient(fn, tries=3, base_delay=0)
    assert attempts == 3


async def test_retry_does_not_catch_permanent_error() -> None:
    attempts = 0

    async def fn() -> None:
        nonlocal attempts
        attempts += 1
        raise PermanentError("not retryable")

    with pytest.raises(PermanentError):
        await _retry_transient(fn, tries=3, base_delay=0)
    assert attempts == 1, "PermanentError não deve retentar"


async def test_retry_turns_youtube_antibot_into_permanent_error() -> None:
    attempts = 0

    async def fn() -> None:
        nonlocal attempts
        attempts += 1
        raise yt_dlp.utils.DownloadError("Sign in to confirm you’re not a bot. Use cookies.")

    with pytest.raises(PermanentError, match="YouTube bloqueou"):
        await _retry_transient(fn, tries=3, base_delay=0)
    assert attempts == 1


async def test_runtime_options_without_proxy_returns_base_opts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("YTDLP_PROXY_URLS", raising=False)
    monkeypatch.delenv("YTDLP_PROXY_URL", raising=False)
    monkeypatch.delenv("YTDLP_BGUTIL_BASE_URL", raising=False)
    monkeypatch.delenv("YTDLP_POT_PROVIDER_URL", raising=False)
    monkeypatch.setattr(ytdl.voxen_settings, "get_yt_dlp_proxy_urls", AsyncMock(return_value=None))

    opts = await ytdl._runtime_options()

    assert opts["retries"] == 3
    assert opts["geo_bypass"] is True
    assert "proxy" not in opts


async def test_runtime_options_applies_configured_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("YTDLP_PROXY_URLS", raising=False)
    monkeypatch.delenv("YTDLP_PROXY_URL", raising=False)
    monkeypatch.delenv("YTDLP_BGUTIL_BASE_URL", raising=False)
    monkeypatch.delenv("YTDLP_POT_PROVIDER_URL", raising=False)
    monkeypatch.setattr(
        ytdl.voxen_settings,
        "get_yt_dlp_proxy_urls",
        AsyncMock(return_value="http://user:pass@proxy.example:8080"),
    )

    opts = await ytdl._runtime_options()

    assert opts["proxy"] == "http://user:pass@proxy.example:8080"


async def test_runtime_options_enables_bgutil_provider_when_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("YTDLP_PROXY_URLS", raising=False)
    monkeypatch.delenv("YTDLP_PROXY_URL", raising=False)
    monkeypatch.setenv("YTDLP_BGUTIL_BASE_URL", "http://bgutil-provider:4416")
    monkeypatch.delenv("YTDLP_POT_PROVIDER_URL", raising=False)
    monkeypatch.setattr(ytdl.voxen_settings, "get_yt_dlp_proxy_urls", AsyncMock(return_value=None))

    opts = await ytdl._runtime_options()

    assert opts["extractor_args"]["youtube"]["player_client"] == ["mweb"]
    assert opts["extractor_args"]["youtubepot-bgutilhttp"]["base_url"] == [
        "http://bgutil-provider:4416"
    ]
