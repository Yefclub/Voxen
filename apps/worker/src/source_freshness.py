"""Invalidate reviewable derivatives after a canonical source changes."""

from typing import Any
from uuid import uuid4


async def _defer_grounded_compilation(
    conn: Any,
    user_id: str,
    transcript_id: str,
    source_version: int,
    source_checksum: str,
) -> None:
    """Withdraw stale automatic evidence and durably schedule the new source."""
    await conn.execute(
        """
        DELETE FROM "BrainSource" source
        USING "BrainEdge" edge
        WHERE source."edgeId" = edge.id
          AND source."userId" = $1
          AND source."sourceId" = $2
          AND edge.method LIKE 'llm-grounded%'
        """,
        user_id,
        transcript_id,
    )
    await conn.execute(
        """
        DELETE FROM "BrainEdge" edge
        WHERE edge."userId" = $1
          AND edge.method LIKE 'llm-grounded%'
          AND NOT EXISTS (SELECT 1 FROM "BrainSource" source WHERE source."edgeId" = edge.id)
        """,
        user_id,
    )
    await conn.execute(
        """
        DELETE FROM "BrainNode" node
        WHERE node."userId" = $1
          AND node.metadata->>'method' = 'llm-grounded'
          AND node."sourceType" IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM "BrainEdge" edge
            WHERE edge."fromNodeId" = node.id OR edge."toNodeId" = node.id
          )
        """,
        user_id,
    )
    await conn.execute(
        """
        UPDATE "BrainNode"
        SET metadata = COALESCE(metadata, '{}'::jsonb) - 'embedding', "updatedAt" = NOW()
        WHERE "userId" = $1 AND key = $2
        """,
        user_id,
        f"TRANSCRIPT:{transcript_id}",
    )
    await conn.execute(
        """
        UPDATE "BrainCompilationSegment" segment
        SET status = 'PENDING'::"BrainCompilationStatus", attempts = 0,
            "claimedBy" = NULL, "claimedAt" = NULL, "leaseExpiresAt" = NULL,
            "nextAttemptAt" = NULL, error = NULL, "updatedAt" = NOW()
        FROM "BrainCompilation" compilation
        WHERE segment."compilationId" = compilation.id
          AND compilation."userId" = $1
          AND compilation."transcriptId" = $2
        """,
        user_id,
        transcript_id,
    )
    await conn.execute(
        """
        WITH compilation AS (
          INSERT INTO "BrainCompilation" (
            id, "userId", "transcriptId", "contentHash", status,
            "totalSegments", "completedSegments", "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, $3, $4, 'PENDING'::"BrainCompilationStatus", 1, 0, NOW(), NOW()
          )
          ON CONFLICT ("transcriptId") DO UPDATE SET
            "contentHash" = EXCLUDED."contentHash",
            status = 'PENDING'::"BrainCompilationStatus",
            "completedSegments" = 0,
            "lastError" = NULL,
            "updatedAt" = NOW()
          RETURNING id
        ), pending_segment AS (
          INSERT INTO "BrainCompilationSegment" (
            id, "compilationId", "segmentKey", status, "startLine", "endLine",
            "itemCount", attempts, "createdAt", "updatedAt"
          )
          SELECT $5, id, $6, 'PENDING'::"BrainCompilationStatus", 1, 1, 0, 0, NOW(), NOW()
          FROM compilation
          ON CONFLICT ("compilationId", "segmentKey") DO UPDATE SET
            status = 'PENDING'::"BrainCompilationStatus", attempts = 0,
            error = NULL, "claimedBy" = NULL, "claimedAt" = NULL,
            "leaseExpiresAt" = NULL, "nextAttemptAt" = NULL, "updatedAt" = NOW()
          RETURNING "compilationId"
        )
        UPDATE "BrainCompilation" compilation
        SET "totalSegments" = (
          SELECT COUNT(*) FROM "BrainCompilationSegment"
          WHERE "compilationId" = compilation.id
        )
        WHERE compilation.id = (SELECT "compilationId" FROM pending_segment)
        """,
        uuid4().hex,
        user_id,
        transcript_id,
        f"source-pending:{source_version}:{source_checksum}",
        uuid4().hex,
        f"source:{source_version}",
    )


async def mark_reviewable_derivatives_stale(
    conn: Any,
    user_id: str,
    transcript_id: str,
    source_version: int,
    source_checksum: str,
) -> None:
    """Preserve historical evidence while withdrawing current-version claims."""
    await conn.execute(
        """
        UPDATE "ChatMessage"
        SET citations = (
          SELECT jsonb_agg(
            CASE WHEN citation->>'sourceId' = $1::text
              THEN citation || '{"stale": true, "verified": false}'::jsonb
              ELSE citation
            END
          )
          FROM jsonb_array_elements(citations) AS citation
        )
        WHERE jsonb_typeof(citations) = 'array'
          AND citations @> jsonb_build_array(jsonb_build_object('sourceId', $1::text))
        """,
        transcript_id,
    )
    await conn.execute(
        """
        UPDATE "NoteTranscriptAnchor"
        SET status = 'STALE'::"NoteAnchorStatus",
            "staleReason" = 'source-version-changed',
            "updatedAt" = NOW()
        WHERE "userId" = $1
          AND "transcriptId" = $2
          AND status = 'VALID'::"NoteAnchorStatus"
          AND ("sourceVersion" <> $3 OR "sourceChecksum" IS DISTINCT FROM $4)
        """,
        user_id,
        transcript_id,
        source_version,
        source_checksum,
    )
    await conn.execute(
        """
        DELETE FROM "BrainSource"
        WHERE "userId" = $1
          AND "evidenceKey" IN (
            SELECT 'note-anchor:' || id
            FROM "NoteTranscriptAnchor"
            WHERE "userId" = $1
              AND "transcriptId" = $2
              AND status <> 'VALID'::"NoteAnchorStatus"
          )
        """,
        user_id,
        transcript_id,
    )
    await conn.execute(
        """
        UPDATE "TranscriptEnrichment"
        SET "staleReason" = 'source-version-changed',
            "updatedAt" = NOW()
        WHERE "userId" = $1
          AND "transcriptId" = $2
          AND "staleReason" IS NULL
          AND ("sourceVersion" <> $3 OR "sourceChecksum" IS DISTINCT FROM $4)
        """,
        user_id,
        transcript_id,
        source_version,
        source_checksum,
    )
    await conn.execute(
        """
        DELETE FROM "BrainNode"
        WHERE "userId" = $1
          AND "sourceType" = 'EXTERNAL_ENRICHMENT'::"BrainSourceType"
          AND "sourceId" IN (
            SELECT id
            FROM "TranscriptEnrichment"
            WHERE "userId" = $1
              AND "transcriptId" = $2
              AND "staleReason" IS NOT NULL
          )
        """,
        user_id,
        transcript_id,
    )
    await _defer_grounded_compilation(conn, user_id, transcript_id, source_version, source_checksum)
