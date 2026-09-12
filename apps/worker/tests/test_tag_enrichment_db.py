from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, cast

import asyncpg
import pytest

from src import db


class _FakeConnection:
    def __init__(self) -> None:
        self.fetch_calls: list[tuple[str, tuple[object, ...]]] = []
        self.fetchrow_calls: list[tuple[str, tuple[object, ...]]] = []
        self.execute_calls: list[tuple[str, tuple[object, ...]]] = []
        self.fetchrow_result: dict[str, Any] | None = {
            "taggingAttempt": 1,
            "correctionRevision": 0,
            "sourceVersion": 0,
            "sourceChecksum": None,
        }

    async def fetch(self, query: str, *args: object) -> list[dict[str, Any]]:
        self.fetch_calls.append((query, args))
        return [
            {
                "id": "transcript-1",
                "userId": "user-2",
                "jobId": None,
                "taggingAttempt": 1,
                "correctionRevision": 0,
                "sourceVersion": 0,
                "sourceChecksum": None,
            }
        ]

    async def execute(self, query: str, *args: object) -> str:
        self.execute_calls.append((query, args))
        return "UPDATE 1"

    async def fetchrow(self, query: str, *args: object) -> dict[str, Any] | None:
        self.fetchrow_calls.append((query, args))
        return self.fetchrow_result


def _install_connection(monkeypatch: pytest.MonkeyPatch, conn: _FakeConnection) -> None:
    @asynccontextmanager
    async def fake_connection() -> AsyncIterator[asyncpg.Connection]:
        yield cast(asyncpg.Connection, conn)

    monkeypatch.setattr(db, "connection", fake_connection)


async def test_claim_query_covers_due_retry_stale_running_and_skip_locked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn = _FakeConnection()
    _install_connection(monkeypatch, conn)

    claimed = await db.claim_pending_tag_enrichments(limit=3)

    assert claimed == [
        {
            "id": "transcript-1",
            "userId": "user-2",
            "jobId": None,
            "taggingAttempt": 1,
            "correctionRevision": 0,
            "sourceVersion": 0,
            "sourceChecksum": None,
        }
    ]
    query, args = conn.fetch_calls[0]
    assert "NOT EXISTS" in query
    assert 'FROM "TranscriptTag"' in query
    assert "'PENDING'::\"EnrichmentStatus\"" in query
    assert "'RETRY'::\"EnrichmentStatus\"" in query
    assert "'RUNNING'::\"EnrichmentStatus\"" in query
    assert "INTERVAL '15 minutes'" in query
    assert 't."taggingNextAttemptAt" <= NOW()' in query
    assert "FOR UPDATE SKIP LOCKED" in query
    assert "LIMIT $1" in query
    assert 't."userId"' in query
    assert args == (3,)


async def test_start_increments_attempt_and_clears_previous_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn = _FakeConnection()
    _install_connection(monkeypatch, conn)

    assert await db.start_tag_enrichment("user-1", "transcript-1") == {
        "taggingAttempt": 1,
        "correctionRevision": 0,
        "sourceVersion": 0,
        "sourceChecksum": None,
    }

    query, args = conn.fetchrow_calls[0]
    assert '"taggingAttempts" = "taggingAttempts" + 1' in query
    assert '"taggingStatus" = \'RUNNING\'::"EnrichmentStatus"' in query
    assert '"taggingError" = NULL' in query
    assert "'PENDING'::\"EnrichmentStatus\"" in query
    assert "'RETRY'::\"EnrichmentStatus\"" in query
    assert '"taggingNextAttemptAt" <= NOW()' in query
    assert 'FROM "TranscriptTag"' in query
    assert '"taggingAttempt"' in query
    assert '"correctionRevision"' in query
    assert args == ("user-1", "transcript-1")


async def test_start_returns_false_when_another_worker_owns_the_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn = _FakeConnection()
    conn.fetchrow_result = None
    _install_connection(monkeypatch, conn)

    assert await db.start_tag_enrichment("user-1", "transcript-1") is None


async def test_retry_query_schedules_backoff_and_skips_after_six_attempts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn = _FakeConnection()
    _install_connection(monkeypatch, conn)

    await db.finish_tag_enrichment(
        "user-1",
        "transcript-1",
        status="RETRY",
        error="modelo não retornou tags",
        claim_attempt=1,
        correction_revision=0,
        source_version=0,
        source_checksum=None,
    )

    query, args = conn.execute_calls[0]
    assert '"taggingAttempts" >= 6' in query
    assert "THEN 'SKIPPED'::\"EnrichmentStatus\"" in query
    assert '"taggingAttempts" < 6' in query
    assert "LEAST(3600, 60 * POWER(2" in query
    assert args == (
        "user-1",
        "transcript-1",
        "RETRY",
        "modelo não retornou tags",
        1,
        0,
        0,
        None,
    )
