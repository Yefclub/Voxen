import os
import uuid
from typing import Any

import asyncpg
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

    assert len(conn.calls) == 11
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

    enrichment_query, enrichment_args = conn.calls[3]
    assert 'UPDATE "TranscriptEnrichment"' in enrichment_query
    assert "\"staleReason\" = 'source-version-changed'" in enrichment_query
    assert enrichment_args == ("user-1", "transcript-1", 4, "checksum-4")

    enrichment_brain_query, enrichment_brain_args = conn.calls[4]
    assert 'DELETE FROM "BrainNode"' in enrichment_brain_query
    assert "'EXTERNAL_ENRICHMENT'" in enrichment_brain_query
    assert enrichment_brain_args == ("user-1", "transcript-1")

    grounded_source_query, grounded_source_args = conn.calls[5]
    assert 'DELETE FROM "BrainSource"' in grounded_source_query
    assert "llm-grounded%" in grounded_source_query
    assert grounded_source_args == ("user-1", "transcript-1")

    compilation_query, compilation_args = conn.calls[10]
    assert 'INSERT INTO "BrainCompilation"' in compilation_query
    assert 'INSERT INTO "BrainCompilationSegment"' in compilation_query
    assert 'ON CONFLICT ("transcriptId") DO UPDATE' in compilation_query
    assert compilation_args[1:4] == (
        "user-1",
        "transcript-1",
        "source-pending:4:checksum-4",
    )
    assert compilation_args[5] == "source:4"


@pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="PostgreSQL integration test requires DATABASE_URL",
)
@pytest.mark.asyncio
async def test_stale_anchor_withdraws_only_its_brain_evidence() -> None:
    suffix = uuid.uuid4().hex
    user_id = f"anchor-user-{suffix}"
    transcript_id = f"anchor-transcript-{suffix}"
    note_id = f"anchor-note-{suffix}"
    anchor_id = f"anchor-{suffix}"
    brain_node_id = f"anchor-node-{suffix}"
    enrichment_id = f"enrichment-{suffix}"
    enrichment_brain_node_id = f"enrichment-node-{suffix}"
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        await conn.execute(
            """
            INSERT INTO "User" (id, email, name, status, role, "createdAt", "updatedAt")
            VALUES ($1, $2, 'Anchor Test', 'APPROVED', 'USER', NOW(), NOW())
            """,
            user_id,
            f"{user_id}@example.test",
        )
        await conn.execute(
            """
            INSERT INTO "Transcript" (
              id, "userId", source, url, title, "durationSec", language,
              "transcriptionMethod", "mdPath", "plainText", frontmatter,
              "sourceVersion", "sourceChecksum", "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, 'WEB', 'https://example.test/anchor', 'Anchor source', 30, 'pt',
              'SCRAPE', 'anchor.md', 'verified passage', '{}'::jsonb,
              1, 'checksum-1', NOW(), NOW()
            )
            """,
            transcript_id,
            user_id,
        )
        await conn.execute(
            """
            INSERT INTO "Note" (
              id, "userId", kind, title, content, "createdAt", "updatedAt"
            ) VALUES ($1, $2, 'NOTE', 'Anchored note', 'curated text', NOW(), NOW())
            """,
            note_id,
            user_id,
        )
        await conn.execute(
            """
            INSERT INTO "NoteTranscriptSource" ("noteId", "transcriptId", "userId", "createdAt")
            VALUES ($1, $2, $3, NOW())
            """,
            note_id,
            transcript_id,
            user_id,
        )
        await conn.execute(
            """
            INSERT INTO "NoteTranscriptAnchor" (
              id, "noteId", "transcriptId", "userId", "startLine", "endLine",
              "selectedQuote", "quoteHash", "sourceVersion", "sourceChecksum",
              status, "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3, $4, 3, 3, 'verified passage', 'quote-hash', 1,
              'checksum-1', 'VALID', NOW(), NOW()
            )
            """,
            anchor_id,
            note_id,
            transcript_id,
            user_id,
        )
        await conn.execute(
            """
            INSERT INTO "BrainNode" (
              id, "userId", key, type, label, status, metadata, "createdAt", "updatedAt"
            ) VALUES ($1, $2, $3, 'CONTENT', 'Anchored note', 'ACTIVE', '{}'::jsonb, NOW(), NOW())
            """,
            brain_node_id,
            user_id,
            f"NOTE:{note_id}",
        )
        await conn.execute(
            """
            INSERT INTO "BrainSource" (
              id, "userId", "nodeId", "sourceType", "sourceId", "startLine", "endLine",
              "segmentKey", "evidenceKey", excerpt, "createdAt"
            ) VALUES (
              $1, $2, $3, 'NOTE', $4, 3, 3, $5, $6, 'verified passage', NOW()
            )
            """,
            f"brain-source-{suffix}",
            user_id,
            brain_node_id,
            note_id,
            f"transcript:{transcript_id}",
            f"note-anchor:{anchor_id}",
        )
        await conn.execute(
            """
            INSERT INTO "TranscriptEnrichment" (
              id, "userId", "transcriptId", "runKey", trigger, status, "reviewState",
              title, content, citations, queries, "sourceVersion", "sourceChecksum",
              "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3, $4, 'MANUAL', 'READY', 'ACCEPTED',
              'External context', 'Cited external claim',
              '[{"url":"https://example.test/source","title":"Source","excerpt":"Evidence"}]'::jsonb,
              '["query"]'::jsonb, 1, 'checksum-1', NOW(), NOW()
            )
            """,
            enrichment_id,
            user_id,
            transcript_id,
            f"run-{suffix}",
        )
        await conn.execute(
            """
            INSERT INTO "BrainNode" (
              id, "userId", key, type, label, status, metadata,
              "sourceType", "sourceId", "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3, 'CONTENT', 'External context', 'ACTIVE', '{}'::jsonb,
              'EXTERNAL_ENRICHMENT', $4, NOW(), NOW()
            )
            """,
            enrichment_brain_node_id,
            user_id,
            f"EXTERNAL_ENRICHMENT:{enrichment_id}",
            enrichment_id,
        )

        await mark_reviewable_derivatives_stale(conn, user_id, transcript_id, 2, "checksum-2")

        status = await conn.fetchval(
            'SELECT status::text FROM "NoteTranscriptAnchor" WHERE id = $1', anchor_id
        )
        evidence_count = await conn.fetchval(
            'SELECT COUNT(*) FROM "BrainSource" WHERE "userId" = $1 AND "evidenceKey" = $2',
            user_id,
            f"note-anchor:{anchor_id}",
        )
        enrichment_stale_reason = await conn.fetchval(
            'SELECT "staleReason" FROM "TranscriptEnrichment" WHERE id = $1', enrichment_id
        )
        enrichment_brain_count = await conn.fetchval(
            'SELECT COUNT(*) FROM "BrainNode" WHERE id = $1', enrichment_brain_node_id
        )
        compilation = await conn.fetchrow(
            """
            SELECT id, "contentHash", status::text, "completedSegments"
            FROM "BrainCompilation" WHERE "transcriptId" = $1
            """,
            transcript_id,
        )
        assert compilation is not None
        pending_segment = await conn.fetchrow(
            """
            SELECT "segmentKey", status::text, attempts
            FROM "BrainCompilationSegment"
            WHERE "compilationId" = $1 AND "segmentKey" = 'source:2'
            """,
            compilation["id"],
        )
        assert status == "STALE"
        assert evidence_count == 0
        assert enrichment_stale_reason == "source-version-changed"
        assert enrichment_brain_count == 0
        assert compilation["contentHash"] == "source-pending:2:checksum-2"
        assert compilation["status"] == "PENDING"
        assert compilation["completedSegments"] == 0
        assert pending_segment is not None
        assert pending_segment["status"] == "PENDING"
        assert pending_segment["attempts"] == 0
        assert await conn.fetchval('SELECT COUNT(*) FROM "Note" WHERE id = $1', note_id) == 1
        assert (
            await conn.fetchval('SELECT COUNT(*) FROM "Transcript" WHERE id = $1', transcript_id)
            == 1
        )
    finally:
        await conn.execute('DELETE FROM "User" WHERE id = $1', user_id)
        await conn.close()
