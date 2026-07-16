"""Contratos de convergencia entre o indexador compatível e o Brain completo."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, cast

import asyncpg

from src import db


class _FakeLease:
    def __init__(self, renew_results: list[bool] | None = None) -> None:
        self.renew_results = iter(renew_results or [True] * 20)
        self.renew_count = 0
        self.release_count = 0
        self.owned = True

    async def renew(self) -> bool:
        self.renew_count += 1
        renewed = next(self.renew_results)
        if not renewed:
            self.owned = False
        return renewed

    async def release(self) -> bool:
        self.release_count += 1
        return True

    def locally_owned(self) -> bool:
        return self.owned

    @asynccontextmanager
    async def heartbeat(self) -> AsyncIterator[None]:
        yield


class _FakeConnection:
    def __init__(
        self,
        *,
        fail_edge_source: bool = False,
        lose_lease_after_refreshable_fetch: _FakeLease | None = None,
        marker_update_result: str = "UPDATE 1",
    ) -> None:
        self.fetch_calls: list[tuple[str, tuple[object, ...]]] = []
        self.fetchrow_calls: list[tuple[str, tuple[object, ...]]] = []
        self.execute_calls: list[tuple[str, tuple[object, ...]]] = []
        self.fail_edge_source = fail_edge_source
        self.lose_lease_after_refreshable_fetch = lose_lease_after_refreshable_fetch
        self.marker_update_result = marker_update_result
        self.metadata: dict[str, object] = {
            "brainIndexVersion": 3,
            "topicIndexVersion": 1,
            "workerMetadata": "preserved",
        }

    async def fetch(self, query: str, *args: object) -> list[dict[str, Any]]:
        self.fetch_calls.append((query, args))
        if 'SELECT bs."edgeId"' in query and self.lose_lease_after_refreshable_fetch:
            self.lose_lease_after_refreshable_fetch.owned = False
            return [{"edgeId": "edge-1"}]
        return []

    async def fetchrow(self, query: str, *args: object) -> dict[str, str]:
        self.fetchrow_calls.append((query, args))
        if "'TRANSCRIPT'::\"BrainSourceType\"" in query:
            self.metadata.pop("topicIndexVersion", None)
            self.metadata.update(json.loads(cast(str, args[6])))
            return {"id": "brain-node-1"}
        return {"id": "brain-node-1"}

    async def execute(self, query: str, *args: object) -> str:
        self.execute_calls.append((query, args))
        if self.fail_edge_source and 'INSERT INTO "BrainSource"' in query and '"edgeId"' in query:
            raise RuntimeError("fault-during-topic-evidence")
        if 'UPDATE "BrainNode"' in query and "metadata = metadata ||" in query:
            if self.marker_update_result == "UPDATE 1":
                self.metadata.update(json.loads(cast(str, args[2])))
            return self.marker_update_result
        return "OK"


async def test_worker_preserves_full_index_metadata_and_finalizes_its_topic_version(
    monkeypatch: Any,
) -> None:
    conn = _FakeConnection()
    lease = _FakeLease()
    monkeypatch.setattr(db, "acquire_graph_index_lease", lambda _user_id: _async_value(lease))

    completed = await db.upsert_transcript_brain_node(
        cast(asyncpg.Connection, conn),
        user_id="user-1",
        transcript_id="transcript-1",
        source="WEB",
        url="https://example.com/item",
        title="abc",
        channel=None,
        language="pt",
        transcription_method="SCRAPE",
        thumbnail_url=None,
        plain_text="",
    )

    source_query, source_args = conn.fetchrow_calls[0]
    metadata = json.loads(cast(str, source_args[6]))

    assert "(\"BrainNode\".metadata - 'topicIndexVersion') || EXCLUDED.metadata" in source_query
    assert "topicIndexVersion" not in metadata
    assert "brainIndexVersion" not in metadata
    assert conn.metadata["brainIndexVersion"] == 3
    assert conn.metadata["topicIndexVersion"] == 1
    assert conn.metadata["workerMetadata"] == "preserved"
    assert completed is True


async def test_worker_leaves_topic_marker_absent_when_topic_evidence_fails(
    monkeypatch: Any,
) -> None:
    conn = _FakeConnection(fail_edge_source=True)
    lease = _FakeLease()
    monkeypatch.setattr(db, "acquire_graph_index_lease", lambda _user_id: _async_value(lease))

    completed = await db.upsert_transcript_brain_node(
        cast(asyncpg.Connection, conn),
        user_id="user-1",
        transcript_id="transcript-1",
        source="WEB",
        url="https://example.com/item",
        title="Automação do Brain",
        channel=None,
        language="pt",
        transcription_method="SCRAPE",
        thumbnail_url=None,
        plain_text="Automação automação cria conceitos no grafo.",
    )

    assert conn.metadata["brainIndexVersion"] == 3
    assert "topicIndexVersion" not in conn.metadata
    assert conn.metadata["workerMetadata"] == "preserved"
    assert completed is False


async def test_worker_skips_all_db_calls_when_lease_is_occupied_or_redis_unavailable(
    monkeypatch: Any,
) -> None:
    connection_calls = 0

    @asynccontextmanager
    async def forbidden_connection() -> AsyncIterator[asyncpg.Connection]:
        nonlocal connection_calls
        connection_calls += 1
        raise AssertionError("DB must not be touched without the Redis lease")
        yield cast(asyncpg.Connection, object())

    monkeypatch.setattr(db, "connection", forbidden_connection)
    monkeypatch.setattr(db, "acquire_graph_index_lease", lambda _user_id: _async_value(None))

    assert await db.reindex_transcript_brain_node("user-1", "transcript-1") is False
    assert await db.reindex_transcript_brain_node("user-1", "transcript-2") is False
    assert connection_calls == 0

    conn = _FakeConnection()
    assert (
        await db.upsert_transcript_brain_node(
            cast(asyncpg.Connection, conn),
            user_id="user-1",
            transcript_id="transcript-1",
            source="WEB",
            url="https://example.com/item",
            title="abc",
            channel=None,
            language="pt",
            transcription_method="SCRAPE",
            thumbnail_url=None,
            plain_text="",
        )
        is False
    )
    assert conn.fetchrow_calls == []
    assert conn.execute_calls == []


async def test_worker_keeps_topic_marker_absent_when_lease_is_lost_before_finalize(
    monkeypatch: Any,
) -> None:
    conn = _FakeConnection()
    lease = _FakeLease([True, True, True, True, False])
    monkeypatch.setattr(db, "acquire_graph_index_lease", lambda _user_id: _async_value(lease))

    completed = await db.upsert_transcript_brain_node(
        cast(asyncpg.Connection, conn),
        user_id="user-1",
        transcript_id="transcript-1",
        source="WEB",
        url="https://example.com/item",
        title="abc",
        channel=None,
        language="pt",
        transcription_method="SCRAPE",
        thumbnail_url=None,
        plain_text="",
    )

    assert completed is False
    assert lease.renew_count == 5
    assert lease.release_count == 1
    assert "topicIndexVersion" not in conn.metadata
    assert not any(
        'UPDATE "BrainNode"' in query and "metadata = metadata ||" in query
        for query, _args in conn.execute_calls
    )


async def test_worker_stops_refresh_cleanup_when_local_lease_is_lost(
    monkeypatch: Any,
) -> None:
    lease = _FakeLease()
    conn = _FakeConnection(lose_lease_after_refreshable_fetch=lease)
    monkeypatch.setattr(db, "acquire_graph_index_lease", lambda _user_id: _async_value(lease))

    completed = await db.upsert_transcript_brain_node(
        cast(asyncpg.Connection, conn),
        user_id="user-1",
        transcript_id="transcript-1",
        source="WEB",
        url="https://example.com/item",
        title="abc",
        channel=None,
        language="pt",
        transcription_method="SCRAPE",
        thumbnail_url=None,
        plain_text="",
    )

    assert completed is False
    assert len(conn.fetch_calls) == 1
    assert 'SELECT bs."edgeId"' in conn.fetch_calls[0][0]
    assert not any('DELETE FROM "BrainSource"' in query for query, _args in conn.execute_calls)
    assert "topicIndexVersion" not in conn.metadata


async def test_worker_treats_zero_row_topic_marker_update_as_incomplete(
    monkeypatch: Any,
) -> None:
    conn = _FakeConnection(marker_update_result="UPDATE 0")
    lease = _FakeLease()
    monkeypatch.setattr(db, "acquire_graph_index_lease", lambda _user_id: _async_value(lease))

    completed = await db.upsert_transcript_brain_node(
        cast(asyncpg.Connection, conn),
        user_id="user-1",
        transcript_id="transcript-1",
        source="WEB",
        url="https://example.com/item",
        title="abc",
        channel=None,
        language="pt",
        transcription_method="SCRAPE",
        thumbnail_url=None,
        plain_text="",
    )

    assert completed is False
    assert "topicIndexVersion" not in conn.metadata
    assert any(
        'UPDATE "BrainNode"' in query and "metadata = metadata ||" in query
        for query, _args in conn.execute_calls
    )


async def _async_value(value: Any) -> Any:
    return value
