from typing import Any

import pytest

from src.source_freshness import mark_reviewable_derivatives_stale


class FakeConnection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    async def execute(self, query: str, *args: Any) -> None:
        self.calls.append((query, args))


@pytest.mark.asyncio
async def test_marks_only_outdated_valid_anchors_for_the_owner() -> None:
    conn = FakeConnection()

    await mark_reviewable_derivatives_stale(conn, "user-1", "transcript-1", 4, "checksum-4")

    assert len(conn.calls) == 3
    anchor_query, anchor_args = conn.calls[1]
    assert 'UPDATE "NoteTranscriptAnchor"' in anchor_query
    assert '"userId" = $1' in anchor_query
    assert '"transcriptId" = $2' in anchor_query
    assert "status = 'VALID'" in anchor_query
    assert '"sourceVersion" <> $3' in anchor_query
    assert '"sourceChecksum" IS DISTINCT FROM $4' in anchor_query
    assert anchor_args == ("user-1", "transcript-1", 4, "checksum-4")

    evidence_query, evidence_args = conn.calls[2]
    assert 'DELETE FROM "BrainSource"' in evidence_query
    assert '"evidenceKey" IN' in evidence_query
    assert "'note-anchor:' || id" in evidence_query
    assert '"userId" = $1' in evidence_query
    assert '"transcriptId" = $2' in evidence_query
    assert evidence_args == ("user-1", "transcript-1")
