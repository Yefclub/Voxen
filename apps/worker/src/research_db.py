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


async def claim_pending_transcript_enrichments(limit: int = 4) -> list[dict[str, Any]]:
    """Reconcile lifecycle/policy and claim only work allowed by the current mode."""
    limit = max(0, limit)
    async with connection() as conn:
        async with conn.transaction():
            policy_mode = await _lock_and_get_summary_research_mode(conn)
            await conn.execute(
                """
                UPDATE "TranscriptEnrichment"
                SET status = 'CANCELLED'::"TranscriptEnrichmentStatus",
                    "cancelRequestedAt" = COALESCE("cancelRequestedAt", NOW()),
                    "startedAt" = NULL, "nextAttemptAt" = NULL,
                    "staleReason" = 'research-policy-changed', "updatedAt" = NOW()
                WHERE type = 'WEB_RESEARCH'::"TranscriptEnrichmentType"
                  AND status IN (
                    'PENDING'::"TranscriptEnrichmentStatus",
                    'RETRY'::"TranscriptEnrichmentStatus",
                    'RUNNING'::"TranscriptEnrichmentStatus"
                  )
                  AND (
                    $1 = 'OFF'
                    OR ($1 = 'MANUAL' AND trigger = 'AUTO'::"TranscriptEnrichmentTrigger")
                  )
                """,
                policy_mode,
            )
            await conn.execute(
                """
                UPDATE "TranscriptEnrichment"
                SET status = 'CANCELLED'::"TranscriptEnrichmentStatus",
                    "startedAt" = NULL, "nextAttemptAt" = NULL, "updatedAt" = NOW()
                WHERE status IN (
                    'PENDING'::"TranscriptEnrichmentStatus",
                    'RETRY'::"TranscriptEnrichmentStatus",
                    'RUNNING'::"TranscriptEnrichmentStatus"
                  )
                  AND "cancelRequestedAt" IS NOT NULL
                """
            )
            await conn.execute(
                """
                UPDATE "TranscriptEnrichment" e
                SET status = 'CANCELLED'::"TranscriptEnrichmentStatus",
                    "cancelRequestedAt" = COALESCE(e."cancelRequestedAt", NOW()),
                    "startedAt" = NULL, "nextAttemptAt" = NULL,
                    "staleReason" = 'parent-inactive', "updatedAt" = NOW()
                FROM "Transcript" t
                WHERE t.id = e."transcriptId" AND t."userId" = e."userId"
                  AND e.type = 'WEB_RESEARCH'::"TranscriptEnrichmentType"
                  AND e.status IN (
                    'PENDING'::"TranscriptEnrichmentStatus",
                    'RETRY'::"TranscriptEnrichmentStatus",
                    'RUNNING'::"TranscriptEnrichmentStatus"
                  )
                  AND t.status <> 'ACTIVE'::"ContentStatus"
                """
            )
            await conn.execute(
                """
                UPDATE "TranscriptEnrichment" e
                SET status = 'CANCELLED'::"TranscriptEnrichmentStatus",
                    "startedAt" = NULL, "nextAttemptAt" = NULL,
                    "staleReason" = 'source-version-changed', "updatedAt" = NOW()
                FROM "Transcript" t
                WHERE t.id = e."transcriptId" AND t."userId" = e."userId"
                  AND e.status IN (
                    'PENDING'::"TranscriptEnrichmentStatus",
                    'RETRY'::"TranscriptEnrichmentStatus",
                    'RUNNING'::"TranscriptEnrichmentStatus"
                  )
                  AND (
                    e."sourceVersion" <> t."sourceVersion"
                    OR e."sourceChecksum" IS DISTINCT FROM t."sourceChecksum"
                  )
                """
            )
            await conn.execute(
                """
                UPDATE "TranscriptEnrichment"
                SET status = 'FAILED'::"TranscriptEnrichmentStatus",
                    "startedAt" = NULL, "nextAttemptAt" = NULL,
                    "lastError" = COALESCE("lastError", 'RESEARCH_ATTEMPTS_EXHAUSTED'),
                    "updatedAt" = NOW()
                WHERE attempt >= 3
                  AND "cancelRequestedAt" IS NULL
                  AND (
                    status IN (
                      'PENDING'::"TranscriptEnrichmentStatus",
                      'RETRY'::"TranscriptEnrichmentStatus"
                    ) OR (
                      status = 'RUNNING'::"TranscriptEnrichmentStatus"
                      AND "startedAt" < NOW() - INTERVAL '10 minutes'
                    )
                  )
                """
            )
            rows = await conn.fetch(
                """
                WITH candidates AS (
                SELECT e.id
                FROM "TranscriptEnrichment" e
                JOIN "Transcript" t
                  ON t.id = e."transcriptId" AND t."userId" = e."userId"
                WHERE e.type = 'WEB_RESEARCH'::"TranscriptEnrichmentType"
                  AND t.status = 'ACTIVE'::"ContentStatus"
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
            WHERE e.id = candidates.id
              AND t.id = e."transcriptId" AND t."userId" = e."userId"
            RETURNING e.id, e."userId", e."transcriptId", e.trigger,
              e.attempt, e."sourceVersion", e."sourceChecksum", e."configRevisionId",
              t.title, t."plainText", t."summaryMd"
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
) -> bool:
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
            RETURNING id
            """,
            enrichment_id,
            user_id,
            attempt,
            retry,
            error[:500],
        )
    return row is not None
