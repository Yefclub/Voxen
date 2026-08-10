"""Atomic, correction-aware tag enrichment claims."""

from __future__ import annotations

from typing import Any

from . import db


async def start_tag_enrichment(user_id: str, transcript_id: str) -> dict[str, int] | None:
    async with db.connection() as conn:
        row = await conn.fetchrow(
            """
            UPDATE "Transcript"
            SET "taggingStatus" = 'RUNNING'::"EnrichmentStatus",
                "taggingAttempts" = "taggingAttempts" + 1,
                "taggingStartedAt" = NOW(), "taggingError" = NULL
            WHERE "userId" = $1 AND id = $2 AND "taggingAttempts" < 6
              AND "taggingStatus" IN (
                'PENDING'::"EnrichmentStatus", 'RETRY'::"EnrichmentStatus"
              )
              AND ("taggingNextAttemptAt" IS NULL OR "taggingNextAttemptAt" <= NOW())
              AND NOT EXISTS (
                SELECT 1 FROM "TranscriptTag" tt
                WHERE tt."transcriptId" = "Transcript".id
              )
            RETURNING "taggingAttempts" AS "taggingAttempt", "correctionRevision"
            """,
            user_id,
            transcript_id,
        )
    return dict(row) if row else None


async def claim_pending_tag_enrichments(limit: int = 10) -> list[dict[str, Any]]:
    async with db.connection() as conn:
        rows = await conn.fetch(
            """
            WITH exhausted AS (
                UPDATE "Transcript"
                SET "taggingStatus" = 'SKIPPED'::"EnrichmentStatus",
                    "taggingStartedAt" = NULL, "taggingNextAttemptAt" = NULL,
                    "taggingError" = COALESCE(
                      "taggingError", 'Limite de 6 tentativas de tags atingido.'
                    )
                WHERE "taggingAttempts" >= 6
                  AND (
                    "taggingStatus" IN (
                      'PENDING'::"EnrichmentStatus", 'RETRY'::"EnrichmentStatus"
                    ) OR (
                      "taggingStatus" = 'RUNNING'::"EnrichmentStatus"
                      AND "taggingStartedAt" < NOW() - INTERVAL '15 minutes'
                    )
                  )
                RETURNING id
            ), candidates AS (
                SELECT t.id FROM "Transcript" t
                WHERE t.status = 'ACTIVE'::"ContentStatus" AND t."taggingAttempts" < 6
                  AND NOT EXISTS (
                    SELECT 1 FROM "TranscriptTag" tt WHERE tt."transcriptId" = t.id
                  )
                  AND (
                    t."taggingStatus" IN (
                      'PENDING'::"EnrichmentStatus", 'RETRY'::"EnrichmentStatus"
                    ) OR (
                      t."taggingStatus" = 'RUNNING'::"EnrichmentStatus"
                      AND t."taggingStartedAt" < NOW() - INTERVAL '15 minutes'
                    )
                  )
                  AND (t."taggingNextAttemptAt" IS NULL OR t."taggingNextAttemptAt" <= NOW())
                ORDER BY t."createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT $1
            )
            UPDATE "Transcript" t
            SET "taggingStatus" = 'RUNNING'::"EnrichmentStatus",
                "taggingAttempts" = t."taggingAttempts" + 1,
                "taggingStartedAt" = NOW(), "taggingError" = NULL
            FROM candidates WHERE t.id = candidates.id
            RETURNING t.id, t."userId", t."taggingAttempts" AS "taggingAttempt",
              t."correctionRevision", (
                SELECT j.id FROM "Job" j WHERE j."transcriptId" = t.id LIMIT 1
              ) AS "jobId"
            """,
            limit,
        )
    return [dict(row) for row in rows]


async def finish_tag_enrichment(
    user_id: str,
    transcript_id: str,
    *,
    status: str,
    error: str | None = None,
    claim_attempt: int,
    correction_revision: int,
) -> None:
    async with db.connection() as conn:
        await conn.execute(
            """
            UPDATE "Transcript"
            SET "taggingStatus" = CASE
                  WHEN $3::text = 'RETRY' AND "taggingAttempts" >= 6
                  THEN 'SKIPPED'::"EnrichmentStatus" ELSE $3::"EnrichmentStatus" END,
                "taggingStartedAt" = NULL,
                "taggingNextAttemptAt" = CASE
                  WHEN $3::text = 'RETRY' AND "taggingAttempts" < 6
                  THEN NOW() + (
                    LEAST(3600, 60 * POWER(2, LEAST("taggingAttempts", 6))) * INTERVAL '1 second'
                  ) ELSE NULL END,
                "taggingError" = $4
            WHERE "userId" = $1 AND id = $2
              AND "taggingStatus" = 'RUNNING'::"EnrichmentStatus"
              AND "taggingAttempts" = $5 AND "correctionRevision" = $6
            """,
            user_id,
            transcript_id,
            status,
            (error or "")[:500] or None,
            claim_attempt,
            correction_revision,
        )


async def get_transcript_title_summary_folder(
    user_id: str,
    transcript_id: str,
    *,
    claim_attempt: int | None = None,
    correction_revision: int | None = None,
) -> tuple[str, str, str | None, int] | None:
    async with db.connection() as conn:
        row = await conn.fetchrow(
            """
            SELECT title, "plainText", "correctedPlainText", "correctionState",
                   "summaryMd", "folderId", "correctionRevision"
            FROM "Transcript" WHERE "userId" = $1 AND id = $2
              AND ($3::integer IS NULL OR (
                "taggingStatus" = 'RUNNING'::"EnrichmentStatus"
                AND "taggingAttempts" = $3 AND "correctionRevision" = $4
              ))
            """,
            user_id,
            transcript_id,
            claim_attempt,
            correction_revision,
        )
    if not row:
        return None
    title = str(row["title"] or "")
    summary = (row["summaryMd"] or "").strip()
    plain = (
        row["correctedPlainText"]
        if row["correctionState"] == "ACTIVE" and row["correctedPlainText"]
        else row["plainText"]
    )
    content = summary or (plain or "").strip()
    folder_id = row["folderId"]
    return title, content, (str(folder_id) if folder_id else None), int(row["correctionRevision"])
