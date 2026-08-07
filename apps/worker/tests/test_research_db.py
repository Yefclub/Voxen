from __future__ import annotations

from contextlib import asynccontextmanager
from decimal import Decimal
from typing import Any
from unittest.mock import AsyncMock

import pytest

from src import research_db


class _Transaction:
    async def __aenter__(self) -> None:
        return None

    async def __aexit__(self, *_args: object) -> None:
        return None


class _Connection:
    def __init__(self) -> None:
        self.fetchrow = AsyncMock()
        self.fetchval = AsyncMock()
        self.fetch = AsyncMock()
        self.execute = AsyncMock()

    def transaction(self) -> _Transaction:
        return _Transaction()


def _patch_connection(monkeypatch: pytest.MonkeyPatch, conn: _Connection) -> None:
    @asynccontextmanager
    async def connection() -> Any:
        yield conn

    monkeypatch.setattr(research_db, "connection", connection)


async def test_queue_auto_research_is_idempotent_by_source_version(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn = _Connection()
    conn.fetchrow.return_value = {"sourceVersion": 2, "sourceChecksum": "checksum"}
    conn.fetchval.return_value = "revision-1"
    conn.execute.return_value = "INSERT 0 1"
    _patch_connection(monkeypatch, conn)
    monkeypatch.setattr(
        research_db,
        "_lock_and_get_summary_research_mode",
        AsyncMock(return_value="AUTO"),
    )

    assert await research_db.queue_auto_transcript_enrichment("user-1", "transcript-1")
    assert conn.execute.await_args.args[6] == 2
    assert conn.execute.await_args.args[7] == "checksum"
    assert "FOR UPDATE OF t" in conn.fetchrow.await_args.args[0]

    conn.fetchrow.return_value = None
    assert not await research_db.queue_auto_transcript_enrichment("user-1", "missing")


async def test_claim_research_performs_reconciliation_before_claim(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn = _Connection()
    conn.fetch.return_value = [{"id": "enrichment-1", "attempt": 2}]
    _patch_connection(monkeypatch, conn)
    monkeypatch.setattr(
        research_db,
        "_lock_and_get_summary_research_mode",
        AsyncMock(return_value="MANUAL"),
    )

    claimed = await research_db.claim_pending_transcript_enrichments(limit=3)

    assert claimed == [{"id": "enrichment-1", "attempt": 2}]
    assert conn.execute.await_count == 5
    assert conn.fetch.await_args.args[-2:] == (3, "MANUAL")
    executed_sql = "\n".join(call.args[0] for call in conn.execute.await_args_list)
    claim_sql = conn.fetch.await_args.args[0]
    assert "research-policy-changed" in executed_sql
    assert "parent-inactive" in executed_sql
    assert "$2 = 'AUTO'" in claim_sql
    assert "e.trigger IN" in claim_sql
    assert "'MANUAL'" in claim_sql
    assert "'MCP'" in claim_sql


async def test_off_policy_reconciles_without_claiming(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = _Connection()
    conn.fetch.return_value = []
    _patch_connection(monkeypatch, conn)
    monkeypatch.setattr(
        research_db,
        "_lock_and_get_summary_research_mode",
        AsyncMock(return_value="OFF"),
    )

    assert await research_db.claim_pending_transcript_enrichments(limit=99) == []

    assert conn.fetch.await_args.args[-2:] == (99, "OFF")
    assert "AND $2 <> 'OFF'" in conn.fetch.await_args.args[0]


async def test_complete_research_bounds_values_and_honors_current_claim(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn = _Connection()
    conn.fetchrow.return_value = {"id": "enrichment-1"}
    _patch_connection(monkeypatch, conn)

    assert await research_db.complete_transcript_enrichment(
        enrichment_id="enrichment-1",
        user_id="user-1",
        attempt=1,
        status="READY",
        title="t" * 400,
        content="grounded",
        citations=[{"url": "https://example.com"}],
        queries=["one", "two", "three", "four", "five", "ignored"],
        rationale="r" * 5_000,
        model="example/model",
        cost_usd=Decimal("0.1"),
        tokens_in=-1,
        tokens_out=2,
        search_call_count=-1,
        search_result_count=1,
    )
    args = conn.fetchrow.await_args.args
    sql = args[0]
    assert len(args[5]) == 300
    assert args[13] == 0
    assert args[15] == 0
    assert 'e."cancelRequestedAt" IS NULL' in sql
    assert "t.status = 'ACTIVE'" in sql
    assert 't."sourceVersion" = e."sourceVersion"' in sql


async def test_fail_research_uses_retry_policy_and_claim_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn = _Connection()
    conn.fetchrow.return_value = None
    _patch_connection(monkeypatch, conn)

    assert not await research_db.fail_transcript_enrichment(
        enrichment_id="enrichment-1",
        user_id="user-1",
        attempt=3,
        retry=True,
        error="e" * 600,
    )
    assert conn.fetchrow.await_args.args[-1] == "e" * 500
