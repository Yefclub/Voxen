"""Lease-fenced durable deferral for temporarily blocked worker jobs."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from . import db
from .job_lease import JobLeaseLostError, current_job_lease


async def defer_job_lease(
    job_id: str,
    user_id: str,
    *,
    delay_seconds: int,
) -> tuple[str, datetime]:
    """Atomically return an owned attempt and persist its queued event."""
    token = current_job_lease()
    if token is None or token.job_id != job_id:
        raise JobLeaseLostError("job deferral has no active lease")
    now = datetime.now(UTC).replace(tzinfo=None)
    event_id = db.generate_cuid()
    async with db.connection() as conn, conn.transaction():
        row = await conn.fetchrow(
            """
            UPDATE "Job"
            SET status = 'QUEUED', "workerId" = NULL, "heartbeatAt" = NULL,
                "leaseExpiresAt" = NULL, "progressStage" = 'queued',
                "progressPercent" = 0, "progressedAt" = $4,
                "queuedAt" = $5, "finishedAt" = NULL, "errorMsg" = NULL
            WHERE id = $1 AND "userId" = $6 AND status = 'RUNNING'
              AND "workerId" = $2 AND attempt = $3
              AND "leaseExpiresAt" >= $4
            RETURNING id
            """,
            job_id,
            token.worker_id,
            token.attempt,
            now,
            now + timedelta(seconds=max(1, delay_seconds)),
            user_id,
        )
        if row is None:
            raise JobLeaseLostError("job deferral rejected by lease fence")
        await conn.execute(
            """
            INSERT INTO "JobProgressEvent" (
                id, "jobId", "userId", stage, percent, "createdAt"
            ) VALUES ($1, $2, $3, 'queued', 0, $4)
            """,
            event_id,
            job_id,
            user_id,
            now,
        )
        await conn.execute(
            """
            DELETE FROM "JobProgressEvent"
            WHERE id IN (
                SELECT id FROM "JobProgressEvent"
                WHERE "jobId" = $1
                ORDER BY "createdAt" DESC, id DESC
                OFFSET 120
            )
            """,
            job_id,
        )
    return event_id, now.replace(tzinfo=UTC)
