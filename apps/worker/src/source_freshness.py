"""Invalidate reviewable derivatives after a canonical source changes."""

from typing import Any


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
