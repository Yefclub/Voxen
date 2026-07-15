"""Contratos de convergencia entre o indexador compatível e o Brain completo."""

from __future__ import annotations

import json
from typing import Any, cast

import asyncpg

from src import db


class _FakeConnection:
    def __init__(self) -> None:
        self.fetchrow_calls: list[tuple[str, tuple[object, ...]]] = []

    async def fetch(self, _query: str, *_args: object) -> list[dict[str, Any]]:
        return []

    async def fetchrow(self, query: str, *args: object) -> dict[str, str]:
        self.fetchrow_calls.append((query, args))
        return {"id": "brain-node-1"}

    async def execute(self, _query: str, *_args: object) -> str:
        return "OK"


async def test_worker_preserves_full_index_metadata_without_claiming_its_version() -> None:
    conn = _FakeConnection()

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

    source_query, source_args = conn.fetchrow_calls[0]
    metadata = json.loads(cast(str, source_args[6]))

    assert '"BrainNode".metadata || EXCLUDED.metadata' in source_query
    assert metadata["topicIndexVersion"] == 1
    assert "brainIndexVersion" not in metadata
