"""Testes do retry helper — confirma que pega exceptions reais de yt-dlp + botocore.

Bug encontrado em review da PR 8b: o `_retry_transient` capturava apenas
(TransientError, OSError, RuntimeError) — yt-dlp `YoutubeDLError` e botocore
`BotoCoreError`/`ClientError` herdam direto de Exception. Sem este teste,
qualquer regressão futura no `_TRANSIENT_EXC` deixa retry virar no-op.
"""

from __future__ import annotations

import botocore.exceptions
import pytest
import yt_dlp.utils

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
