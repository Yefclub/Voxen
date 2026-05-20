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
from src.ytdl import _parse_youtube_clients, _parse_youtube_po_tokens


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


def test_parse_youtube_clients_keeps_allowed_unique_values() -> None:
    assert _parse_youtube_clients("web,mweb,android,unknown,web") == [
        "web",
        "mweb",
        "android",
    ]
    assert _parse_youtube_clients("") == []


def test_parse_youtube_po_tokens_keeps_context_tokens_only() -> None:
    assert _parse_youtube_po_tokens("mweb.gvs+AAA\nweb.subs+BBB,invalid,mweb.gvs+AAA") == [
        "mweb.gvs+AAA",
        "web.subs+BBB",
    ]
    assert _parse_youtube_po_tokens("") == []


async def test_runtime_options_includes_configured_pot_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("YTDLP_POT_PROVIDER_URL", "http://bgutil-provider:4416")
    monkeypatch.setattr(
        ytdl.voxen_settings, "get_yt_dlp_youtube_clients", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(
        ytdl.voxen_settings, "get_yt_dlp_youtube_po_tokens", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(
        ytdl.voxen_settings, "get_yt_dlp_pot_provider_url", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(ytdl.voxen_settings, "get_yt_dlp_user_agent", AsyncMock(return_value=None))
    monkeypatch.setattr(ytdl.voxen_settings, "get_yt_dlp_proxy_urls", AsyncMock(return_value=None))
    monkeypatch.setattr(ytdl.voxen_settings, "get_yt_dlp_cookies_txt", AsyncMock(return_value=None))

    runtime = await ytdl._runtime_options()

    assert runtime.opts["extractor_args"]["youtubepot-bgutilhttp"]["base_url"] == [
        "http://bgutil-provider:4416"
    ]
