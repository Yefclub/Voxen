"""Regression matrix for temporary upstream failures and bounded recovery."""

import socket
from datetime import UTC, datetime, timedelta
from email.utils import format_datetime
from io import BytesIO
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
import requests
import yt_dlp.utils
from yt_dlp.networking.common import Response as YtdlpResponse
from yt_dlp.networking.exceptions import HTTPError as YtdlpHTTPError

from src import external_retry, pipeline, scrape_pipeline, scraper, tiktok_ingestion, tiktok_player
from src.pipeline_errors import DeferredJobError, PermanentError


@pytest.mark.parametrize(
    "value, expected",
    [
        ("120", 120),
        ("999999", 3600),
        ("0", 0),
        ("-1", None),
        ("nan", None),
        ("invalid", None),
        (None, None),
    ],
)
def test_retry_after_seconds(value, expected) -> None:
    assert external_retry.parse_retry_after(value) == expected


def test_retry_after_http_date() -> None:
    now = datetime(2026, 10, 5, 12, tzinfo=UTC)
    assert (
        external_retry.parse_retry_after(format_datetime(now + timedelta(seconds=90)), now=now)
        == 90
    )
    assert (
        external_retry.parse_retry_after(format_datetime(now - timedelta(seconds=90)), now=now) == 0
    )


@pytest.mark.parametrize("status", [408, 429, 500, 502, 503, 504])
async def test_web_temporary_status_preserves_cooldown(monkeypatch, status) -> None:
    response = httpx.Response(
        status, headers={"Retry-After": "120"}, request=httpx.Request("GET", "https://example.com")
    )
    monkeypatch.setattr(httpx.AsyncClient, "get", AsyncMock(return_value=response))
    with pytest.raises(scraper.FetchTransientError) as caught:
        await scraper._fetch_with_manual_redirects("https://example.com")
    assert caught.value.status_code == status
    assert caught.value.retry_after == 120


@pytest.mark.parametrize("status", [403, 404])
async def test_web_permanent_status_is_not_retried(monkeypatch, status) -> None:
    monkeypatch.setattr(httpx.AsyncClient, "get", AsyncMock(return_value=httpx.Response(status)))
    with pytest.raises(scraper.FetchBlockedError):
        await scraper._fetch_with_manual_redirects("https://example.com")


@pytest.mark.parametrize(
    "errno, error_type",
    [
        (socket.EAI_AGAIN, scraper.FetchTransientError),
        (socket.EAI_NONAME, scraper.FetchBlockedError),
    ],
)
def test_dns_temporary_and_invalid_names_are_distinct(monkeypatch, errno, error_type) -> None:
    def fail(*_args):
        raise socket.gaierror(errno, "DNS unavailable")

    monkeypatch.setattr(socket, "getaddrinfo", fail)
    with pytest.raises(error_type):
        scraper._resolve_and_validate("example.com")


async def test_short_web_outage_recovers_locally(monkeypatch) -> None:
    fetch = AsyncMock(side_effect=[scraper.FetchTransientError("temporary"), "ok"])
    monkeypatch.setattr(scraper, "fetch_and_extract", fetch)
    sleep = AsyncMock()
    monkeypatch.setattr(scrape_pipeline.asyncio, "sleep", sleep)
    assert await scrape_pipeline._scrape_with_retry("https://example.com") == "ok"
    assert fetch.await_count == 2
    sleep.assert_awaited_once_with(1)


async def test_long_web_cooldown_returns_without_sleeping(monkeypatch) -> None:
    fetch = AsyncMock(
        side_effect=scraper.FetchTransientError("temporary", status_code=429, retry_after=120)
    )
    monkeypatch.setattr(scraper, "fetch_and_extract", fetch)
    sleep = AsyncMock()
    monkeypatch.setattr(scrape_pipeline.asyncio, "sleep", sleep)
    with pytest.raises(external_retry.ExternalTransientError):
        await scrape_pipeline._scrape_with_retry("https://example.com")
    assert fetch.await_count == 1
    sleep.assert_not_awaited()


@pytest.mark.parametrize("status", [408, 429, 503])
def test_tiktok_status_retains_retry_hints(status) -> None:
    response = requests.Response()
    response.status_code = status
    response.headers["Retry-After"] = "120"
    response._content = b"secret upstream body"
    response._content_consumed = True
    with pytest.raises(tiktok_player.TikTokPlayerError) as caught:
        tiktok_player._json_object(response, operation="item")
    transient = external_retry.as_transient(caught.value)
    assert transient is not None
    assert transient.status_code == status
    assert transient.retry_after == 120
    assert "secret" not in str(transient)


async def test_tiktok_official_timeout_is_temporary(monkeypatch) -> None:
    original = RuntimeError("[TikTok] Unexpected response from webpage request")
    monkeypatch.setattr(tiktok_ingestion.ytdl, "probe", AsyncMock(side_effect=original))
    monkeypatch.setattr(
        tiktok_ingestion,
        "probe_player",
        AsyncMock(side_effect=requests.ReadTimeout("signed-url?token=secret")),
    )
    monkeypatch.setattr(tiktok_ingestion.asyncio, "sleep", AsyncMock())
    with pytest.raises(external_retry.ExternalTransientError):
        await tiktok_ingestion.probe_after_extraction_error(
            "https://www.tiktok.com/@a/video/1234567890",
            user_id="user",
            initial_error=original,
            log=MagicMock(),
        )


@pytest.mark.parametrize(
    "error",
    [
        TimeoutError("timeout"),
        ConnectionRefusedError("refused"),
        yt_dlp.utils.DownloadError("HTTP Error 503: unavailable"),
        yt_dlp.utils.DownloadError("HTTP Error 429: Too Many Requests"),
    ],
)
async def test_exhausted_media_transport_failure_is_temporary(monkeypatch, error) -> None:
    call = AsyncMock(side_effect=error)
    monkeypatch.setattr(pipeline.asyncio, "sleep", AsyncMock())
    with pytest.raises(external_retry.ExternalTransientError):
        await pipeline._retry_transient(call)
    assert call.await_count == (2 if "429" in str(error) else 3)


@pytest.mark.parametrize("attempt", [1, 2, 3])
async def test_recovery_budget_is_bounded(attempt) -> None:
    expected = DeferredJobError if attempt < 3 else PermanentError
    with pytest.raises(expected) as caught:
        async with external_retry.recover(attempt=attempt, max_attempts=3):
            raise external_retry.ExternalTransientError(status_code=429, retry_after=120)
    if attempt < 3:
        assert caught.value.retry_after_seconds == 120
    else:
        assert caught.value.code == "EXTERNAL_TEMPORARILY_UNAVAILABLE"
        assert "temporariamente" in caught.value.public_message


async def test_nonresponding_web_fetch_has_total_deadline(monkeypatch) -> None:
    import asyncio

    cancelled = asyncio.Event()

    async def stall(_url):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    monkeypatch.setattr(scrape_pipeline, "SCRAPE_ATTEMPT_TIMEOUT_SECONDS", 0.001)
    monkeypatch.setattr(scraper, "fetch_and_extract", stall)
    with pytest.raises(external_retry.ExternalTransientError):
        await scrape_pipeline._scrape_with_retry("https://example.com", tries=1)
    assert cancelled.is_set()


def _ytdlp_http_error(status: int, *, wrapped: bool) -> BaseException:
    response = YtdlpResponse(
        BytesIO(b"private provider body"),
        "https://example.com?token=private-secret",
        {"Retry-After": "120"},
        status=status,
    )
    error = YtdlpHTTPError(response)
    return (
        yt_dlp.utils.DownloadError(
            "HTTP Error: upstream failure", exc_info=(type(error), error, None)
        )
        if wrapped
        else error
    )


@pytest.mark.parametrize("wrapped", [False, True])
@pytest.mark.parametrize("status", [403, 429, 503])
def test_real_ytdlp_http_errors_preserve_structured_cooldown(status, wrapped) -> None:
    temporary = external_retry.as_transient(_ytdlp_http_error(status, wrapped=wrapped))
    if status == 403:
        assert temporary is None
    else:
        assert temporary is not None
        assert temporary.status_code == status
        assert temporary.retry_after == 120
        assert "private" not in str(temporary)


async def test_wrapped_ytdlp_cooldown_defers_before_local_retry(monkeypatch) -> None:
    call = AsyncMock(side_effect=_ytdlp_http_error(429, wrapped=True))
    sleep = AsyncMock()
    monkeypatch.setattr(pipeline.asyncio, "sleep", sleep)
    with pytest.raises(DeferredJobError) as caught:
        async with external_retry.recover(attempt=1, max_attempts=3):
            await pipeline._retry_transient(call)
    call.assert_awaited_once()
    sleep.assert_not_awaited()
    assert caught.value.retry_after_seconds == 120
