"""Durable claims and retry state for grounded Brain compilation."""

from __future__ import annotations

from typing import Any

GROUNDED_SEGMENT_MAX_ATTEMPTS = 6
GROUNDED_SEGMENT_CLAIM_TTL_SEC = 15 * 60
GROUNDED_SEGMENT_MAX_RETRY_SEC = 30 * 60


async def refresh_compilation(conn: Any, compilation_id: str) -> None:  # noqa: ANN401
    """Aggregate segment state into its compilation within the caller transaction."""
    await conn.execute(
        """
        UPDATE "BrainCompilation" compilation
        SET "totalSegments" = counts.total,
            "completedSegments" = counts.completed,
            status = CASE
                WHEN counts.total = 0 THEN 'PENDING'::"BrainCompilationStatus"
                WHEN counts.completed = counts.total THEN 'COMPLETED'::"BrainCompilationStatus"
                WHEN counts.running > 0 THEN 'RUNNING'::"BrainCompilationStatus"
                WHEN counts.completed > 0 THEN 'PARTIAL'::"BrainCompilationStatus"
                WHEN counts.failed = counts.total THEN 'FAILED'::"BrainCompilationStatus"
                WHEN counts.retrying > 0 THEN 'RETRY'::"BrainCompilationStatus"
                ELSE 'PENDING'::"BrainCompilationStatus"
            END,
            "lastError" = CASE WHEN counts.failed > 0 THEN counts.last_error ELSE NULL END,
            "updatedAt" = NOW()
        FROM (
            SELECT COUNT(*)::integer AS total,
                   COUNT(*) FILTER (
                       WHERE status = 'COMPLETED'::"BrainCompilationStatus"
                   )::integer AS completed,
                   COUNT(*) FILTER (
                       WHERE status = 'FAILED'::"BrainCompilationStatus"
                   )::integer AS failed,
                   COUNT(*) FILTER (
                       WHERE status = 'RUNNING'::"BrainCompilationStatus"
                   )::integer AS running,
                   COUNT(*) FILTER (
                       WHERE status = 'RETRY'::"BrainCompilationStatus"
                   )::integer AS retrying,
                   MAX(error) FILTER (
                       WHERE status IN (
                         'FAILED'::"BrainCompilationStatus", 'RETRY'::"BrainCompilationStatus"
                       )
                   ) AS last_error
            FROM "BrainCompilationSegment"
            WHERE "compilationId" = $1
        ) counts
        WHERE compilation.id = $1
        """,
        compilation_id,
    )


async def claim_segments(
    *,
    user_id: str,
    compilation_id: str,
    segment_keys: list[str],
    worker_id: str,
    limit: int,
) -> list[dict[str, Any]]:
    """Claim due segments once across horizontally scaled workers."""
    from . import db

    keys = list(dict.fromkeys(key for key in segment_keys if key))
    if not keys or limit <= 0:
        return []
    async with db.connection() as conn:
        rows = await conn.fetch(
            """
            WITH exhausted AS (
              UPDATE "BrainCompilationSegment" segment
              SET status = 'FAILED'::"BrainCompilationStatus",
                  "claimedBy" = NULL, "claimedAt" = NULL, "leaseExpiresAt" = NULL,
                  "nextAttemptAt" = NULL,
                  error = COALESCE(error, 'ATTEMPT_LIMIT_REACHED'),
                  "updatedAt" = NOW()
              WHERE segment."compilationId" = $1
                AND EXISTS (
                  SELECT 1 FROM "BrainCompilation" compilation
                  WHERE compilation.id = segment."compilationId"
                    AND compilation."userId" = $2
                )
                AND segment.attempts >= $6
                AND segment.status <> 'COMPLETED'::"BrainCompilationStatus"
                AND segment.status <> 'SKIPPED'::"BrainCompilationStatus"
              RETURNING id
            ), candidates AS (
              SELECT segment.id
              FROM "BrainCompilationSegment" segment
              JOIN "BrainCompilation" compilation
                ON compilation.id = segment."compilationId"
               AND compilation."userId" = $2
              WHERE segment."compilationId" = $1
                AND segment."segmentKey" = ANY($3::text[])
                AND segment.attempts < $6
                AND (
                  segment.status = 'PENDING'::"BrainCompilationStatus"
                  OR segment.status = 'FAILED'::"BrainCompilationStatus"
                  OR (
                    segment.status = 'RETRY'::"BrainCompilationStatus"
                    AND (segment."nextAttemptAt" IS NULL OR segment."nextAttemptAt" <= NOW())
                  )
                  OR (
                    segment.status = 'RUNNING'::"BrainCompilationStatus"
                    AND segment."leaseExpiresAt" < NOW()
                  )
                )
              ORDER BY segment."startLine", segment."endLine", segment."segmentKey"
              FOR UPDATE SKIP LOCKED
              LIMIT $5
            )
            UPDATE "BrainCompilationSegment" segment
            SET status = 'RUNNING'::"BrainCompilationStatus",
                attempts = segment.attempts + 1,
                "claimedBy" = $4,
                "claimedAt" = NOW(),
                "leaseExpiresAt" = NOW() + make_interval(secs => $7),
                "nextAttemptAt" = NULL,
                error = NULL,
                "updatedAt" = NOW()
            FROM candidates
            WHERE segment.id = candidates.id
            RETURNING segment."segmentKey", segment.attempts,
                      segment."startLine", segment."endLine",
                      segment."startSec", segment."endSec"
            """,
            compilation_id,
            user_id,
            keys,
            worker_id,
            min(limit, len(keys)),
            GROUNDED_SEGMENT_MAX_ATTEMPTS,
            GROUNDED_SEGMENT_CLAIM_TTL_SEC,
        )
        await refresh_compilation(conn, compilation_id)
    return [dict(row) for row in rows]


async def list_due_compilations(limit: int = 10) -> list[dict[str, Any]]:
    """Find durable semantic work; the per-segment claim remains authoritative."""
    from . import db

    if limit <= 0:
        return []
    async with db.connection() as conn:
        rows = await conn.fetch(
            """
            SELECT compilation."userId", compilation."transcriptId",
                   MIN(segment."nextAttemptAt") AS "nextAttemptAt"
            FROM "BrainCompilation" compilation
            JOIN "Transcript" transcript
              ON transcript.id = compilation."transcriptId"
             AND transcript."userId" = compilation."userId"
             AND transcript.status = 'ACTIVE'::"ContentStatus"
            JOIN "BrainCompilationSegment" segment
              ON segment."compilationId" = compilation.id
            WHERE segment.attempts < $2
              AND (
                segment.status = 'PENDING'::"BrainCompilationStatus"
                OR segment.status = 'FAILED'::"BrainCompilationStatus"
                OR (
                  segment.status = 'RETRY'::"BrainCompilationStatus"
                  AND (segment."nextAttemptAt" IS NULL OR segment."nextAttemptAt" <= NOW())
                )
                OR (
                  segment.status = 'RUNNING'::"BrainCompilationStatus"
                  AND segment."leaseExpiresAt" < NOW()
                )
              )
            GROUP BY compilation.id
            ORDER BY MIN(COALESCE(segment."nextAttemptAt", segment."updatedAt")) ASC
            LIMIT $1
            """,
            limit,
            GROUNDED_SEGMENT_MAX_ATTEMPTS,
        )
    return [dict(row) for row in rows]


async def mark_compilation_skipped(compilation_id: str) -> None:
    from . import db

    async with db.connection() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                UPDATE "BrainCompilationSegment"
                SET status = 'SKIPPED'::"BrainCompilationStatus",
                    "claimedBy" = NULL, "claimedAt" = NULL, "leaseExpiresAt" = NULL,
                    "nextAttemptAt" = NULL, error = NULL, "updatedAt" = NOW()
                WHERE "compilationId" = $1
                  AND status <> 'COMPLETED'::"BrainCompilationStatus"
                """,
                compilation_id,
            )
            await conn.execute(
                """
                UPDATE "BrainCompilation"
                SET status = 'SKIPPED'::"BrainCompilationStatus", "lastError" = NULL,
                    "updatedAt" = NOW()
                WHERE id = $1
                """,
                compilation_id,
            )


async def mark_segment_failed(
    *,
    compilation_id: str,
    segment_key: str,
    error: str,
    worker_id: str | None = None,
) -> None:
    """Schedule retry, becoming terminal only after the bounded attempt limit."""
    from . import db

    async with db.connection() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                UPDATE "BrainCompilationSegment"
                SET status = CASE
                      WHEN attempts >= $5 THEN 'FAILED'::"BrainCompilationStatus"
                      ELSE 'RETRY'::"BrainCompilationStatus"
                    END,
                    error = $3,
                    "nextAttemptAt" = CASE
                      WHEN attempts >= $5 THEN NULL
                      ELSE NOW() + make_interval(
                        secs => LEAST($6, (POWER(2, GREATEST(attempts - 1, 0)) * 60)::integer)
                      )
                    END,
                    "claimedBy" = NULL, "claimedAt" = NULL, "leaseExpiresAt" = NULL,
                    "updatedAt" = NOW()
                WHERE "compilationId" = $1 AND "segmentKey" = $2
                  AND ($4::text IS NULL OR "claimedBy" = $4)
                """,
                compilation_id,
                segment_key,
                db.truncate_text(error, 500),
                worker_id,
                GROUNDED_SEGMENT_MAX_ATTEMPTS,
                GROUNDED_SEGMENT_MAX_RETRY_SEC,
            )
            await refresh_compilation(conn, compilation_id)
