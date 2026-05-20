"""Testes do summary.maybe_generate (best-effort, delega pro chat service)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from src import summary


class _FakeLogger:
    def __init__(self) -> None:
        self.events: list[tuple[str, str]] = []

    def info(self, event: str, **_kw: object) -> None:
        self.events.append(("info", event))

    def warning(self, event: str, **_kw: object) -> None:
        self.events.append(("warning", event))

    def exception(self, event: str, **_kw: object) -> None:
        self.events.append(("exception", event))


async def test_skip_when_cancelled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(summary, "is_cancelled", lambda _job_id: True)
    log = _FakeLogger()
    await summary.maybe_generate(user_id="u1", transcript_id="t1", job_id="j1", log=log)
    assert ("info", "summary-skipped-cancelled") in log.events


async def test_skip_when_row_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(summary, "is_cancelled", lambda _: False)

    fake_conn = MagicMock()
    fake_conn.fetchrow = AsyncMock(return_value=None)
    fake_ctx = MagicMock()
    fake_ctx.__aenter__ = AsyncMock(return_value=fake_conn)
    fake_ctx.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(summary.db, "connection", lambda: fake_ctx)

    log = _FakeLogger()
    await summary.maybe_generate(user_id="u1", transcript_id="t1", job_id="j1", log=log)
    assert ("info", "summary-skipped-empty-text") in log.events


async def test_skip_when_plain_text_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(summary, "is_cancelled", lambda _: False)

    fake_conn = MagicMock()
    fake_conn.fetchrow = AsyncMock(return_value={"title": "X", "plainText": ""})
    fake_ctx = MagicMock()
    fake_ctx.__aenter__ = AsyncMock(return_value=fake_conn)
    fake_ctx.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(summary.db, "connection", lambda: fake_ctx)

    log = _FakeLogger()
    await summary.maybe_generate(user_id="u1", transcript_id="t1", job_id="j1", log=log)
    assert ("info", "summary-skipped-empty-text") in log.events


async def test_logs_done_on_200_with_summary(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(summary, "is_cancelled", lambda _: False)
    monkeypatch.setattr(
        summary.voxen_settings,
        "get_summary_timeout_sec",
        AsyncMock(return_value=42.0),
    )

    fake_conn = MagicMock()
    fake_conn.fetchrow = AsyncMock(return_value={"title": "T", "plainText": "lorem ipsum"})
    fake_ctx = MagicMock()
    fake_ctx.__aenter__ = AsyncMock(return_value=fake_conn)
    fake_ctx.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(summary.db, "connection", lambda: fake_ctx)

    fake_response = MagicMock()
    fake_response.status_code = 200
    fake_response.json = MagicMock(return_value={"summary_md": "## TL;DR\nfoo"})
    seen_timeout: dict[str, object] = {}

    async def fake_post(self: httpx.AsyncClient, *args: object, **kw: object) -> object:
        return fake_response

    original_init = httpx.AsyncClient.__init__

    def fake_init(self: httpx.AsyncClient, *args: object, **kw: object) -> None:
        seen_timeout["value"] = kw.get("timeout")
        original_init(self, *args, **kw)

    with (
        patch.object(httpx.AsyncClient, "__init__", fake_init),
        patch.object(httpx.AsyncClient, "post", fake_post),
    ):
        log = _FakeLogger()
        await summary.maybe_generate(user_id="u1", transcript_id="t1", job_id="j1", log=log)
    assert ("info", "summary-done") in log.events
    assert seen_timeout["value"] == 42.0


async def test_logs_empty_when_200_without_summary(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(summary, "is_cancelled", lambda _: False)
    monkeypatch.setattr(
        summary.voxen_settings,
        "get_summary_timeout_sec",
        AsyncMock(return_value=120.0),
    )

    fake_conn = MagicMock()
    fake_conn.fetchrow = AsyncMock(return_value={"title": "T", "plainText": "lorem"})
    fake_ctx = MagicMock()
    fake_ctx.__aenter__ = AsyncMock(return_value=fake_conn)
    fake_ctx.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(summary.db, "connection", lambda: fake_ctx)

    fake_response = MagicMock()
    fake_response.status_code = 200
    fake_response.json = MagicMock(return_value={"summary_md": ""})

    async def fake_post(self: httpx.AsyncClient, *args: object, **kw: object) -> object:
        return fake_response

    with patch.object(httpx.AsyncClient, "post", fake_post):
        log = _FakeLogger()
        await summary.maybe_generate(user_id="u1", transcript_id="t1", job_id="j1", log=log)
    assert ("info", "summary-empty") in log.events


async def test_warns_on_non_200(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(summary, "is_cancelled", lambda _: False)
    monkeypatch.setattr(
        summary.voxen_settings,
        "get_summary_timeout_sec",
        AsyncMock(return_value=120.0),
    )

    fake_conn = MagicMock()
    fake_conn.fetchrow = AsyncMock(return_value={"title": "T", "plainText": "lorem"})
    fake_ctx = MagicMock()
    fake_ctx.__aenter__ = AsyncMock(return_value=fake_conn)
    fake_ctx.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(summary.db, "connection", lambda: fake_ctx)

    fake_response = MagicMock()
    fake_response.status_code = 502
    fake_response.text = "Bad Gateway"

    async def fake_post(self: httpx.AsyncClient, *args: object, **kw: object) -> object:
        return fake_response

    with patch.object(httpx.AsyncClient, "post", fake_post):
        log = _FakeLogger()
        await summary.maybe_generate(user_id="u1", transcript_id="t1", job_id="j1", log=log)
    assert ("warning", "summary-upstream-non-200") in log.events


async def test_exception_is_logged_but_not_raised(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(summary, "is_cancelled", lambda _: False)

    def boom() -> object:
        raise RuntimeError("DB exploded")

    monkeypatch.setattr(summary.db, "connection", boom)

    log = _FakeLogger()
    # Não levanta — best-effort
    await summary.maybe_generate(user_id="u1", transcript_id="t1", job_id="j1", log=log)
    assert ("exception", "summary-failed") in log.events
