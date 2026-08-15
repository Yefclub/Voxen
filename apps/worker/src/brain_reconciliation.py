"""Durable Brain backfill and terminal job-warning reconciliation."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from . import db, events


async def reconcile_resolved_warning_jobs(limit: int = 50) -> list[dict[str, Any]]:
    """Promote warnings after every required derivative has converged.

    COMPLETED_WITH_WARNINGS is written only by the persisted-transcript enrichment
    path. Eligibility therefore comes from durable derivative state rather than
    parsing its human-facing warning text. The status update and terminal progress
    event share one transaction.
    """
    created_at = datetime.now(UTC).replace(tzinfo=None)
    repaired: list[dict[str, Any]] = []
    async with db.connection() as conn:
        async with conn.transaction():
            rows = await conn.fetch(
                """
                WITH candidates AS (
                    SELECT j.id, j."userId",
                           COALESCE(j."transcriptId", j."refreshTranscriptId") AS "transcriptId"
                    FROM "Job" j
                    JOIN "Transcript" t
                      ON t.id = COALESCE(j."transcriptId", j."refreshTranscriptId")
                     AND t."userId" = j."userId"
                    JOIN "BrainNode" n
                      ON n."userId" = j."userId"
                     AND n.key = CONCAT(
                       'TRANSCRIPT:', COALESCE(j."transcriptId", j."refreshTranscriptId")
                     )
                    WHERE j.status = 'COMPLETED_WITH_WARNINGS'::"JobStatus"
                      AND t."summaryStatus" IN (
                        'COMPLETE'::"EnrichmentStatus", 'SKIPPED'::"EnrichmentStatus"
                      )
                      AND t."taggingStatus" IN (
                        'COMPLETE'::"EnrichmentStatus", 'SKIPPED'::"EnrichmentStatus"
                      )
                      AND n."updatedAt" >= t."updatedAt"
                      AND COALESCE(n.metadata->>'topicIndexVersion', '') = $1
                    ORDER BY j."finishedAt" ASC NULLS FIRST
                    FOR UPDATE OF j SKIP LOCKED
                    LIMIT $2
                )
                UPDATE "Job" j
                SET status = 'DONE'::"JobStatus",
                    "errorMsg" = NULL,
                    "progressStage" = 'done',
                    "progressPercent" = 100,
                    "progressedAt" = $3
                FROM candidates c
                WHERE j.id = c.id
                RETURNING j.id, j."userId", c."transcriptId"
                """,
                str(db.BRAIN_TOPIC_INDEX_VERSION),
                limit,
                created_at,
            )
            for row in rows:
                event_id = db.generate_cuid()
                await conn.execute(
                    """
                    INSERT INTO "JobProgressEvent" (
                      id, "jobId", "userId", stage, percent, "transcriptId", "createdAt"
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                    """,
                    event_id,
                    row["id"],
                    row["userId"],
                    "done",
                    100,
                    row["transcriptId"],
                    created_at,
                )
                repaired.append(
                    {
                        **dict(row),
                        "eventId": event_id,
                        "createdAt": created_at.replace(tzinfo=UTC),
                    }
                )
    return repaired


async def reconcile_once(log: Any, *, limit: int = 50) -> int:  # noqa: ANN401
    """Backfill missing graph state, promote resolved jobs, and publish snapshots."""
    indexed = await db.reindex_missing_transcript_brain_nodes(limit=limit)
    if indexed:
        log.info("brain-reconciliation-indexed", count=indexed)
    repaired = await reconcile_resolved_warning_jobs(limit=limit)
    for item in repaired:
        await events.publish_recorded_job_event(
            str(item["userId"]),
            str(item["id"]),
            "done",
            event_id=str(item["eventId"]),
            created_at=item["createdAt"],
            percent=100,
            transcript_id=str(item["transcriptId"]),
        )
    if repaired:
        log.info("brain-reconciliation-jobs-promoted", count=len(repaired))
    return len(repaired)
