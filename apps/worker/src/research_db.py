"""Durable database operations for transcript research enrichments."""

import json
from decimal import Decimal
from typing import Any

from .db import connection, generate_cuid
from .voxen_crypto import decrypt
from .voxen_settings import get_master_key

_GLOBAL_SETTINGS_LOCK = "voxen:global-settings"


async def _lock_and_get_summary_research_mode(conn: Any) -> str:
    """Read policy under the same transaction lock used by settings writes."""
    await conn.execute(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        _GLOBAL_SETTINGS_LOCK,
    )
    encrypted = await conn.fetchval(
        """
        SELECT "valueEnc"
        FROM "Setting"
        WHERE scope = 'GLOBAL'::"SettingScope"
          AND "userId" IS NULL
          AND key = 'summary_research_mode'
        ORDER BY "updatedAt" DESC, id DESC
        LIMIT 1
        """
    )
    if encrypted is None:
        return "OFF"
    try:
        value = decrypt(str(encrypted), get_master_key()).strip().upper()
    except Exception:
        return "OFF"
    return value if value in {"OFF", "MANUAL", "AUTO"} else "OFF"


def _truncate(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    return value[:limit]


async def queue_auto_transcript_enrichment(user_id: str, transcript_id: str) -> bool:
    """Queue one research run per source version and effective config revision."""
    import hashlib

    async with connection() as conn:
        async with conn.transaction():
            if await _lock_and_get_summary_research_mode(conn) != "AUTO":
                return False
            source = await conn.fetchrow(
                """
                SELECT t.id, t."sourceVersion", t."sourceChecksum"
                FROM "Transcript" t
                WHERE t.id = $1 AND t."userId" = $2
                  AND t.status = 'ACTIVE'::"ContentStatus"
                FOR UPDATE OF t
                """,
                transcript_id,
                user_id,
            )
            if source is None:
                return False
            revision_id = await conn.fetchval(
                'SELECT id FROM "ConfigRevision" ORDER BY number DESC LIMIT 1'
            )
            run_key = hashlib.sha256(
                ":".join(
                    (
                        "auto",
                        transcript_id,
                        str(source["sourceVersion"]),
                        str(source["sourceChecksum"] or ""),
                        str(revision_id or ""),
                    )
                ).encode()
            ).hexdigest()
            status: str = await conn.execute(
                """
                INSERT INTO "TranscriptEnrichment" (
                    id, "userId", "transcriptId", "configRevisionId", "runKey",
                    type, status, "reviewState", trigger, title, content,
                    citations, queries, "sourceVersion", "sourceChecksum",
                    "createdAt", "updatedAt"
                ) VALUES (
                    $1, $2, $3, $4, $5,
                    'WEB_RESEARCH'::"TranscriptEnrichmentType",
                    'PENDING'::"TranscriptEnrichmentStatus",
                    'SUGGESTED'::"TranscriptEnrichmentReviewState",
                    'AUTO'::"TranscriptEnrichmentTrigger", '', '',
                    '[]'::jsonb, '[]'::jsonb, $6, $7, NOW(), NOW()
                )
                ON CONFLICT ("userId", "transcriptId", "runKey") DO NOTHING
                """,
                generate_cuid(),
                user_id,
                transcript_id,
                revision_id,
                run_key,
                source["sourceVersion"],
                source["sourceChecksum"],
            )
    return status == "INSERT 0 1"


async def reconcile_transcript_enrichment_lifecycle() -> list[dict[str, Any]]:
    """Apply terminal lifecycle transitions and return their sanitized job associations."""
    async with connection() as conn:
        async with conn.transaction():
            policy_mode = await _lock_and_get_summary_research_mode(conn)
            rows = await conn.fetch(
                """
                WITH eligible AS (
                  SELECT e.id,
                    CASE
                      WHEN $1 = 'OFF'
                        OR ($1 = 'MANUAL'
                          AND e.trigger = 'AUTO'::"TranscriptEnrichmentTrigger")
                        THEN 'policy'
                      WHEN e."cancelRequestedAt" IS NOT NULL THEN 'cancel'
                      WHEN t.status <> 'ACTIVE'::"ContentStatus" THEN 'parent'
                      WHEN e."sourceVersion" <> t."sourceVersion"
                        OR e."sourceChecksum" IS DISTINCT FROM t."sourceChecksum"
                        THEN 'source'
                      WHEN e.attempt >= 3 AND (
                        e.status IN (
                          'PENDING'::"TranscriptEnrichmentStatus",
                          'RETRY'::"TranscriptEnrichmentStatus"
                        ) OR (
                          e.status = 'RUNNING'::"TranscriptEnrichmentStatus"
                          AND e."startedAt" < NOW() - INTERVAL '10 minutes'
                        )
                      ) THEN 'failed'
                      ELSE NULL
                    END AS transition
                  FROM "TranscriptEnrichment" e
                  JOIN "Transcript" t
                    ON t.id = e."transcriptId" AND t."userId" = e."userId"
                  WHERE e.type = 'WEB_RESEARCH'::"TranscriptEnrichmentType"
                    AND e.status IN (
                      'PENDING'::"TranscriptEnrichmentStatus",
                      'RETRY'::"TranscriptEnrichmentStatus",
                      'RUNNING'::"TranscriptEnrichmentStatus"
                    )
                    AND NOT EXISTS (
                      SELECT 1 FROM "Job" active_parent
                      WHERE active_parent."transcriptId" = e."transcriptId"
                        AND active_parent."userId" = e."userId"
                        AND active_parent.status NOT IN (
                          'DONE'::"JobStatus", 'COMPLETED_WITH_WARNINGS'::"JobStatus",
                          'FAILED'::"JobStatus", 'CANCELLED'::"JobStatus"
                        )
                    )
                  FOR UPDATE OF e
                ), candidates AS (
                  SELECT id, transition FROM eligible WHERE transition IS NOT NULL
                ), changed AS (
                  UPDATE "TranscriptEnrichment" e
                  SET status = CASE WHEN candidates.transition = 'failed'
                        THEN 'FAILED'::"TranscriptEnrichmentStatus"
                        ELSE 'CANCELLED'::"TranscriptEnrichmentStatus" END,
                      "cancelRequestedAt" = CASE
                        WHEN candidates.transition IN ('policy', 'parent')
                        THEN COALESCE(e."cancelRequestedAt", NOW())
                        ELSE e."cancelRequestedAt" END,
                      "startedAt" = NULL, "nextAttemptAt" = NULL,
                      "staleReason" = CASE candidates.transition
                        WHEN 'policy' THEN 'research-policy-changed'
                        WHEN 'parent' THEN 'parent-inactive'
                        WHEN 'source' THEN 'source-version-changed'
                        ELSE e."staleReason" END,
                      "lastError" = CASE WHEN candidates.transition = 'failed'
                        THEN COALESCE(e."lastError", 'RESEARCH_ATTEMPTS_EXHAUSTED')
                        ELSE e."lastError" END,
                      "updatedAt" = NOW()
                  FROM candidates
                  WHERE e.id = candidates.id
                  RETURNING e.id, e."userId", e."transcriptId",
                    CASE WHEN candidates.transition = 'failed'
                      THEN 'research_failed' ELSE 'research_cancelled' END AS stage
                )
                SELECT changed.*, parent_job.id AS "jobId"
                FROM changed
                LEFT JOIN "Job" parent_job
                  ON parent_job."transcriptId" = changed."transcriptId"
                 AND parent_job."userId" = changed."userId"
                """,
                policy_mode,
            )
    return [dict(row) for row in rows]


async def claim_pending_transcript_enrichments(limit: int = 4) -> list[dict[str, Any]]:
    """Claim work allowed by the current policy after lifecycle reconciliation."""
    limit = max(0, limit)
    async with connection() as conn:
        async with conn.transaction():
            policy_mode = await _lock_and_get_summary_research_mode(conn)
            rows = await conn.fetch(
                """
                WITH candidates AS (
                SELECT e.id
                FROM "TranscriptEnrichment" e
                JOIN "Transcript" t
                  ON t.id = e."transcriptId" AND t."userId" = e."userId"
                LEFT JOIN "Job" parent_job
                  ON parent_job."transcriptId" = e."transcriptId"
                 AND parent_job."userId" = e."userId"
                WHERE e.type = 'WEB_RESEARCH'::"TranscriptEnrichmentType"
                  AND t.status = 'ACTIVE'::"ContentStatus"
                  AND (
                    parent_job.id IS NULL
                    OR parent_job.status IN (
                      'DONE'::"JobStatus",
                      'COMPLETED_WITH_WARNINGS'::"JobStatus",
                      'FAILED'::"JobStatus",
                      'CANCELLED'::"JobStatus"
                    )
                  )
                  AND $2 <> 'OFF'
                  AND (
                    $2 = 'AUTO'
                    OR e.trigger IN (
                      'MANUAL'::"TranscriptEnrichmentTrigger",
                      'MCP'::"TranscriptEnrichmentTrigger"
                    )
                  )
                  AND e.attempt < 3
                  AND e."cancelRequestedAt" IS NULL
                  AND e."sourceVersion" = t."sourceVersion"
                  AND e."sourceChecksum" IS NOT DISTINCT FROM t."sourceChecksum"
                  AND (
                    e.status IN (
                      'PENDING'::"TranscriptEnrichmentStatus",
                      'RETRY'::"TranscriptEnrichmentStatus"
                    ) OR (
                      e.status = 'RUNNING'::"TranscriptEnrichmentStatus"
                      AND e."startedAt" < NOW() - INTERVAL '10 minutes'
                    )
                  )
                  AND (e."nextAttemptAt" IS NULL OR e."nextAttemptAt" <= NOW())
                ORDER BY e."createdAt" ASC
                FOR UPDATE OF e SKIP LOCKED
                LIMIT $1
            )
            UPDATE "TranscriptEnrichment" e
            SET status = 'RUNNING'::"TranscriptEnrichmentStatus",
                attempt = e.attempt + 1, "startedAt" = NOW(),
                "nextAttemptAt" = NULL, "lastError" = NULL, "updatedAt" = NOW()
            FROM candidates, "Transcript" t
            LEFT JOIN "Job" j
              ON j."transcriptId" = t.id AND j."userId" = t."userId"
            WHERE e.id = candidates.id
              AND t.id = e."transcriptId" AND t."userId" = e."userId"
            RETURNING e.id, e."userId", e."transcriptId", e.trigger,
              e.attempt, e."sourceVersion", e."sourceChecksum", e."configRevisionId",
              t.title, t.url AS "sourceUrl", t."plainText", t."summaryMd",
              j.id AS "jobId"
                """,
                limit,
                policy_mode,
            )
    return [dict(row) for row in rows]


async def complete_transcript_enrichment(
    *,
    enrichment_id: str,
    user_id: str,
    attempt: int,
    status: str,
    title: str = "",
    content: str = "",
    citations: list[dict[str, Any]] | None = None,
    queries: list[str] | None = None,
    rationale: str | None = None,
    no_research_reason: str | None = None,
    model: str | None = None,
    cost_usd: Decimal | None = None,
    tokens_in: int = 0,
    tokens_out: int = 0,
    search_call_count: int = 0,
    search_result_count: int = 0,
) -> bool:
    """Persist a terminal result only while the claim and source version are current."""
    async with connection() as conn:
        row = await conn.fetchrow(
            """
            UPDATE "TranscriptEnrichment" e
            SET status = $4::"TranscriptEnrichmentStatus",
                title = $5, content = $6, citations = $7::jsonb, queries = $8::jsonb,
                rationale = $9, "noResearchReason" = $10, model = $11,
                "costUsd" = $12, "tokensIn" = $13, "tokensOut" = $14,
                "searchCallCount" = $15, "searchResultCount" = $16,
                "generatedAt" = NOW(), "checkedAt" = NOW(),
                "expiresAt" = NOW() + INTERVAL '30 days',
                "startedAt" = NULL, "nextAttemptAt" = NULL,
                "lastError" = NULL, "updatedAt" = NOW()
            FROM "Transcript" t
            WHERE e.id = $1 AND e."userId" = $2 AND e.attempt = $3
              AND e.status = 'RUNNING'::"TranscriptEnrichmentStatus"
              AND e."cancelRequestedAt" IS NULL
              AND t.id = e."transcriptId" AND t."userId" = e."userId"
              AND t.status = 'ACTIVE'::"ContentStatus"
              AND t."sourceVersion" = e."sourceVersion"
              AND t."sourceChecksum" IS NOT DISTINCT FROM e."sourceChecksum"
            RETURNING e.id
            """,
            enrichment_id,
            user_id,
            attempt,
            status,
            title[:300],
            content[:200_000],
            json.dumps(citations or [], default=str),
            json.dumps((queries or [])[:5]),
            _truncate(rationale, 4_000),
            _truncate(no_research_reason, 4_000),
            model,
            cost_usd,
            max(0, tokens_in),
            max(0, tokens_out),
            max(0, search_call_count),
            max(0, search_result_count),
        )
    return row is not None


async def fail_transcript_enrichment(
    *,
    enrichment_id: str,
    user_id: str,
    attempt: int,
    retry: bool,
    error: str,
) -> str | None:
    async with connection() as conn:
        row = await conn.fetchrow(
            """
            UPDATE "TranscriptEnrichment"
            SET status = CASE
                  WHEN "cancelRequestedAt" IS NOT NULL
                  THEN 'CANCELLED'::"TranscriptEnrichmentStatus"
                  WHEN $4::boolean AND attempt < 3
                  THEN 'RETRY'::"TranscriptEnrichmentStatus"
                  ELSE 'FAILED'::"TranscriptEnrichmentStatus"
                END,
                "startedAt" = NULL,
                "nextAttemptAt" = CASE
                  WHEN "cancelRequestedAt" IS NULL AND $4::boolean AND attempt < 3
                  THEN NOW() + (60 * POWER(2, attempt) * INTERVAL '1 second')
                  ELSE NULL
                END,
                "lastError" = $5, "updatedAt" = NOW()
            WHERE id = $1 AND "userId" = $2 AND attempt = $3
              AND status = 'RUNNING'::"TranscriptEnrichmentStatus"
            RETURNING status::text AS status
            """,
            enrichment_id,
            user_id,
            attempt,
            retry,
            error[:500],
        )
    return str(row["status"]) if row is not None else None
