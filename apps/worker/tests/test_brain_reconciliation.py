"""Contratos de convergencia entre o indexador compatível e o Brain completo."""

from __future__ import annotations

import json
from typing import Any, cast

import asyncpg

from src import db


class _FakeConnection:
    def __init__(self, *, fail_edge_source: bool = False) -> None:
        self.fetchrow_calls: list[tuple[str, tuple[object, ...]]] = []
        self.execute_calls: list[tuple[str, tuple[object, ...]]] = []
        self.fail_edge_source = fail_edge_source
        self.metadata: dict[str, object] = {
            "brainIndexVersion": 3,
            "topicIndexVersion": 1,
            "workerMetadata": "preserved",
        }

    async def fetch(self, _query: str, *_args: object) -> list[dict[str, Any]]:
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
            self.metadata.update(json.loads(cast(str, args[2])))
        return "OK"


async def test_worker_preserves_full_index_metadata_and_finalizes_its_topic_version() -> None:
    conn = _FakeConnection()

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


async def test_worker_leaves_topic_marker_absent_when_topic_evidence_fails() -> None:
    conn = _FakeConnection(fail_edge_source=True)

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
