"""Matriz de isolamento dos contratos executados pelo worker (spec 133)."""

from __future__ import annotations

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest

from src import db, events, storage, thumbnail


class FakeTransaction:
    async def __aenter__(self) -> FakeTransaction:
        return self

    async def __aexit__(self, *_: object) -> bool:
        return False


class FakeConnection:
    def __init__(self) -> None:
        self.fetchrow = AsyncMock(return_value=None)
        self.execute = AsyncMock()

    def transaction(self) -> FakeTransaction:
        return FakeTransaction()


@asynccontextmanager
async def fake_connection(conn: FakeConnection):
    yield conn


def test_storage_and_realtime_namespaces_do_not_overlap_between_users() -> None:
    user_a = "user-a"
    user_b = "user-b"

    keys_a = {
        storage.transcript_key(user_a, "transcript-1"),
        storage.upload_key(user_a, "upload-1", "aula.mp4"),
        storage.upload_preview_key(user_a, "upload-1", "aula.mp4"),
        thumbnail.thumbnail_key(user_a, "transcript-1"),
    }
    keys_b = {
        storage.transcript_key(user_b, "transcript-1"),
        storage.upload_key(user_b, "upload-1", "aula.mp4"),
        storage.upload_preview_key(user_b, "upload-1", "aula.mp4"),
        thumbnail.thumbnail_key(user_b, "transcript-1"),
    }

    assert keys_a.isdisjoint(keys_b)
    assert events.job_channel(user_a, "job-1") != events.job_channel(user_b, "job-1")
    assert events.user_channel(user_a) != events.user_channel(user_b)
    assert events.graph_invalidation_channel(user_a) != events.graph_invalidation_channel(user_b)


@pytest.mark.asyncio
async def test_worker_refuses_to_persist_progress_for_foreign_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn = FakeConnection()
    monkeypatch.setattr(db, "connection", lambda: fake_connection(conn))

    with pytest.raises(ValueError, match="does not belong"):
        await db.record_job_progress(
            user_id="user-a",
            job_id="job-owned-by-user-b",
            stage="indexing",
        )

    conn.fetchrow.assert_awaited_once()
    conn.execute.assert_not_awaited()
