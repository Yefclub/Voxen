"""Postgres pool + queries do worker (asyncpg cru)."""

from __future__ import annotations

import json
import os
import re
import unicodedata
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from hashlib import sha256
from typing import Any

import asyncpg
import structlog

from . import brain_compilation_db, brain_temporal_store
from .entity_resolution import normalize_entity_type
from .graph_index_lease import GraphIndexLease, acquire_graph_index_lease
from .job_lease import JobLeaseLostError, JobLeaseToken, current_job_lease

log = structlog.get_logger(__name__)


class GroundedCompilationLeaseLostError(RuntimeError):
    """Força rollback quando o lease expira durante a escrita de um segmento."""


class GroundedCompilationClaimLostError(RuntimeError):
    """Rejects stale or foreign semantic work before any graph mutation."""


_pool: asyncpg.Pool | None = None

TOPIC_LIMIT = 8
TOPIC_MIN_LEN = 4
BRAIN_TOPIC_INDEX_VERSION = 1
JOB_LEASE_TTL_SEC = 90
JOB_MAX_ATTEMPTS = 3
JOB_CHECKPOINT_EXTRA_ATTEMPTS = 1
WORKER_INTERRUPTED_MESSAGE = (
    "O processamento foi interrompido após reinícios do worker. Tente enviar novamente."
)
TOPIC_STOPWORDS = {
    "ainda",
    "algo",
    "also",
    "apenas",
    "após",
    "apos",
    "cada",
    "como",
    "com",
    "conteudo",
    "conteúdo",
    "conteudos",
    "contra",
    "depois",
    "desde",
    "esta",
    "este",
    "isso",
    "para",
    "pela",
    "pelo",
    "sobre",
    "texto",
    "http",
    "https",
    "www",
    "that",
    "this",
    "with",
    "from",
    "have",
    "will",
    "your",
    "they",
    "their",
    "there",
    "what",
    "when",
    "where",
    "which",
    "would",
    "could",
    "should",
}


def _utcnow_naive() -> datetime:
    """Postgres `TIMESTAMP(3)` (sem tz) gerado pelo Prisma exige datetime
    naive em UTC — asyncpg recusa misturar offset-aware com naive.
    """
    return datetime.now(UTC).replace(tzinfo=None)


def _job_token(job_id: str) -> JobLeaseToken | None:
    token = current_job_lease()
    return token if token is not None and token.job_id == job_id else None


async def assert_job_lease_in_connection(
    conn: asyncpg.Connection,
    *,
    job_id: str,
    user_id: str,
) -> None:
    """Aplica o fence do lease dentro da transação da escrita canônica."""
    token = _job_token(job_id)
    if token is None:
        # Helpers e migrações legadas podem persistir fora do executor. Todo
        # job do worker ativa um token antes de entrar no pipeline.
        return
    owner = await conn.fetchrow(
        """
        SELECT id FROM "Job"
        WHERE id = $1 AND "userId" = $2 AND status = 'RUNNING'
          AND "workerId" = $3 AND attempt = $4
          AND "leaseExpiresAt" >= NOW()
        FOR KEY SHARE
        """,
        job_id,
        user_id,
        token.worker_id,
        token.attempt,
    )
    if owner is None:
        raise JobLeaseLostError("canonical write rejected by lease fence")


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL não definido")
    return url


async def get_pool() -> asyncpg.Pool:
    """Singleton pool. Cria sob demanda."""
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(database_url(), min_size=1, max_size=4)
    assert _pool is not None
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


@asynccontextmanager
async def connection() -> AsyncIterator[asyncpg.Connection]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        yield conn


async def claim_job(job_id: str, worker_id: str) -> dict[str, Any] | None:
    """Tenta marcar Job como RUNNING. SKIP LOCKED evita race com outros workers.

    Retorna o job se conseguiu claim, None se outro worker já pegou ou se está
    em estado terminal.
    """
    async with connection() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                SELECT id, "userId", "sourceUrl", status, type, "refreshTranscriptId",
                       "savedMediaId", "transcriptId", attempt, "progressStage",
                       "deletionTargetType", "deletionTargetId", "deletionTargetTitle"
                FROM "Job"
                WHERE id = $1 AND status = 'QUEUED' AND "queuedAt" <= $2
                FOR UPDATE SKIP LOCKED
                """,
                job_id,
                _utcnow_naive(),
            )
            if not row:
                return None
            # A revisão precisa representar a configuração efetiva no início
            # da execução, não apenas a configuração que existia ao enfileirar.
            await conn.execute("SELECT pg_advisory_xact_lock(hashtext('voxen:global-settings'))")
            revision = await conn.fetchrow(
                'SELECT id FROM "ConfigRevision" ORDER BY number DESC LIMIT 1'
            )
            claimed_at = _utcnow_naive()
            attempt = int(row["attempt"] or 0) + 1
            await conn.execute(
                """
                UPDATE "Job"
                SET status = 'RUNNING', "startedAt" = COALESCE("startedAt", $2),
                    "finishedAt" = NULL, "errorMsg" = NULL,
                    "configRevisionId" = $3, "workerId" = $4, attempt = $5,
                    "heartbeatAt" = $2, "leaseExpiresAt" = $6
                WHERE id = $1
                """,
                job_id,
                claimed_at,
                revision["id"] if revision else None,
                worker_id,
                attempt,
                claimed_at + timedelta(seconds=JOB_LEASE_TTL_SEC),
            )
            return {**dict(row), "workerId": worker_id, "attempt": attempt}


async def renew_job_lease(token: JobLeaseToken) -> bool:
    now = _utcnow_naive()
    async with connection() as conn:
        row = await conn.fetchrow(
            """
            UPDATE "Job"
            SET "heartbeatAt" = $4, "leaseExpiresAt" = $5
            WHERE id = $1 AND status = 'RUNNING'
              AND "workerId" = $2 AND attempt = $3
              AND "leaseExpiresAt" >= $4
            RETURNING id
            """,
            token.job_id,
            token.worker_id,
            token.attempt,
            now,
            now + timedelta(seconds=JOB_LEASE_TTL_SEC),
        )
        if row is not None:
            return True
        terminal = await conn.fetchrow(
            """
            SELECT id FROM "Job"
            WHERE id = $1 AND "workerId" = $2 AND attempt = $3
              AND status IN ('DONE', 'COMPLETED_WITH_WARNINGS', 'FAILED')
            """,
            token.job_id,
            token.worker_id,
            token.attempt,
        )
        return terminal is not None


async def release_job_lease(token: JobLeaseToken) -> bool:
    """Devolve imediatamente ao reconciliador um job cancelado por shutdown."""
    async with connection() as conn:
        row = await conn.fetchrow(
            """
            UPDATE "Job"
            SET status = 'QUEUED', "workerId" = NULL, "heartbeatAt" = NULL,
                "leaseExpiresAt" = NULL, "progressStage" = 'queued',
                "progressPercent" = 0, "progressedAt" = $4
            WHERE id = $1 AND status = 'RUNNING'
              AND "workerId" = $2 AND attempt = $3
            RETURNING id
            """,
            token.job_id,
            token.worker_id,
            token.attempt,
            _utcnow_naive(),
        )
        return row is not None


async def recover_expired_jobs(
    *,
    limit: int = 50,
    max_attempts: int = JOB_MAX_ATTEMPTS,
) -> list[dict[str, Any]]:
    """Requeue/finaliza leases vencidos sob locks incompatíveis entre workers."""
    now = _utcnow_naive()
    recovered: list[dict[str, Any]] = []
    async with connection() as conn:
        async with conn.transaction():
            rows = await conn.fetch(
                """
                SELECT id, "userId", type, attempt, "transcriptId", "refreshTranscriptId",
                       "savedMediaId", "deletionTargetType", "deletionTargetId"
                FROM "Job"
                WHERE status = 'RUNNING'
                  AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < $1)
                ORDER BY "leaseExpiresAt" ASC
                LIMIT $2
                FOR UPDATE SKIP LOCKED
                """,
                now,
                limit,
            )
            for row in rows:
                # Um checkpoint canônico ganha no máximo uma tentativa barata
                # adicional para virar DONE; ele nunca contorna o limite para sempre.
                attempt = int(row["attempt"] or 0)
                allowed_attempts = max_attempts + (
                    JOB_CHECKPOINT_EXTRA_ATTEMPTS if row["transcriptId"] is not None else 0
                )
                retry = attempt < allowed_attempts
                if retry:
                    await conn.execute(
                        """
                        UPDATE "Job"
                        SET status = 'QUEUED', "workerId" = NULL,
                            "heartbeatAt" = NULL, "leaseExpiresAt" = NULL,
                            "progressStage" = 'queued', "progressPercent" = 0,
                            "progressedAt" = $2
                        WHERE id = $1
                        """,
                        row["id"],
                        now,
                    )
                    action = "requeued"
                else:
                    await conn.execute(
                        """
                        UPDATE "Job"
                        SET status = 'FAILED', "workerId" = NULL,
                            "heartbeatAt" = NULL, "leaseExpiresAt" = NULL,
                            "progressStage" = 'failed', "progressedAt" = $2,
                            "errorMsg" = $3, "finishedAt" = $2
                        WHERE id = $1
                        """,
                        row["id"],
                        now,
                        WORKER_INTERRUPTED_MESSAGE,
                    )
                    if row.get("savedMediaId") is not None and row["type"] in {
                        "DOWNLOAD_MEDIA",
                        "UPLOAD_AND_TRANSCRIBE",
                    }:
                        media_status = "FAILED" if row["type"] == "DOWNLOAD_MEDIA" else "READY"
                        await conn.execute(
                            """
                            UPDATE "SavedMedia"
                            SET status = $2::"SavedMediaStatus",
                                "errorMsg" = $3, "updatedAt" = $4
                            WHERE id = $1 AND "userId" = $5 AND "transcriptId" IS NULL
                              AND status IN ('QUEUED', 'DOWNLOADING', 'PROCESSING')
                            """,
                            row["savedMediaId"],
                            media_status,
                            WORKER_INTERRUPTED_MESSAGE,
                            now,
                            row["userId"],
                        )
                    if (
                        row.get("type") == "DELETE_KNOWLEDGE"
                        and row.get("deletionTargetType") == "SAVED_MEDIA"
                    ):
                        await conn.execute(
                            """
                            UPDATE "SavedMedia"
                            SET status = 'FAILED'::"SavedMediaStatus",
                                "errorMsg" = $3, "updatedAt" = $4
                            WHERE id = $1 AND "userId" = $2
                              AND "transcriptId" IS NULL
                              AND status = 'DELETING'::"SavedMediaStatus"
                            """,
                            row["deletionTargetId"],
                            row["userId"],
                            WORKER_INTERRUPTED_MESSAGE,
                            now,
                        )
                    action = "failed"
                recovered.append({**dict(row), "action": action})
    return recovered


async def record_job_progress(
    *,
    user_id: str,
    job_id: str,
    stage: str,
    percent: int | None = None,
    chunk_index: int | None = None,
    transcript_id: str | None = None,
    error_msg: str | None = None,
) -> tuple[str, datetime]:
    """Persiste o estado operacional antes de publicá-lo no Redis.

    O snapshot da UI precisa sobreviver a uma reconexão SSE; por isso o Redis
    continua sendo transporte em tempo real, mas não é a única fonte de verdade.
    """
    event_id = generate_cuid()
    created_at = _utcnow_naive()
    token = _job_token(job_id)
    async with connection() as conn:
        async with conn.transaction():
            # O payload do worker sempre carrega user_id e job_id. Validar a
            # dupla dentro da mesma transação evita que erro de roteamento
            # persista progresso de um job pertencente a outro workspace.
            if token:
                owner = await conn.fetchrow(
                    """
                    SELECT id FROM "Job"
                    WHERE id = $1 AND "userId" = $2
                      AND "workerId" = $3 AND attempt = $4
                      AND (
                        (status = 'RUNNING' AND "leaseExpiresAt" >= $5)
                        OR status IN ('DONE', 'COMPLETED_WITH_WARNINGS', 'FAILED', 'CANCELLED')
                      )
                    FOR KEY SHARE
                    """,
                    job_id,
                    user_id,
                    token.worker_id,
                    token.attempt,
                    created_at,
                )
            else:
                owner = await conn.fetchrow(
                    """
                    SELECT id FROM "Job"
                    WHERE id = $1 AND "userId" = $2
                    FOR KEY SHARE
                    """,
                    job_id,
                    user_id,
                )
            if owner is None:
                if token:
                    raise JobLeaseLostError("job progress rejected by lease fence")
                raise ValueError("job does not belong to the informed workspace")
            await conn.execute(
                """
                INSERT INTO "JobProgressEvent" (
                    id, "jobId", "userId", stage, percent, "chunkIndex",
                    "transcriptId", "errorMsg", "createdAt"
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                """,
                event_id,
                job_id,
                user_id,
                stage,
                percent,
                chunk_index,
                transcript_id,
                error_msg,
                created_at,
            )
            await conn.execute(
                """
                DELETE FROM "JobProgressEvent"
                WHERE id IN (
                    SELECT id
                    FROM "JobProgressEvent"
                    WHERE "jobId" = $1
                    ORDER BY "createdAt" DESC, id DESC
                    OFFSET 120
                )
                """,
                job_id,
            )
            await conn.execute(
                """
                UPDATE "Job"
                SET "progressStage" = $3,
                    "progressPercent" = $4,
                    "progressedAt" = $5
                WHERE id = $1 AND "userId" = $2
                """,
                job_id,
                user_id,
                stage,
                percent,
                created_at,
            )
    return event_id, created_at.replace(tzinfo=UTC)


async def list_queued_job_ids(limit: int = 50) -> list[str]:
    """Para reconciliação no boot do worker (caso Redis pub/sub tenha perdido notify)."""
    async with connection() as conn:
        rows = await conn.fetch(
            """
            SELECT id FROM "Job"
            WHERE status = 'QUEUED' AND "queuedAt" <= $1
            ORDER BY "queuedAt" ASC
            LIMIT $2
            """,
            _utcnow_naive(),
            limit,
        )
        return [r["id"] for r in rows]


async def get_default_transcription_model() -> str | None:
    """Lê Setting(scope=GLOBAL, key=default_transcription_model).valueEnc.
    Decifração fica a cargo do caller (precisa da master key).
    """
    async with connection() as conn:
        row = await conn.fetchrow(
            """
            SELECT "valueEnc" FROM "Setting"
            WHERE scope = 'GLOBAL' AND "userId" IS NULL AND key = 'default_transcription_model'
            """
        )
        return row["valueEnc"] if row else None


async def get_setting_enc(key: str) -> str | None:
    async with connection() as conn:
        row = await conn.fetchrow(
            'SELECT "valueEnc" FROM "Setting" '
            "WHERE scope = 'GLOBAL' AND \"userId\" IS NULL AND key = $1",
            key,
        )
        return row["valueEnc"] if row else None


async def get_user_setting_enc(user_id: str, key: str) -> str | None:
    """Lê segredo pessoal; o user_id sempre vem do Job já reivindicado."""
    async with connection() as conn:
        row = await conn.fetchrow(
            'SELECT "valueEnc" FROM "Setting" '
            "WHERE scope = 'USER' AND \"userId\" = $1 AND key = $2",
            user_id,
            key,
        )
        return row["valueEnc"] if row else None


async def get_settings_enc(keys: tuple[str, ...]) -> dict[str, str]:
    """Lê um snapshot de Settings globais em uma única consulta."""
    if not keys:
        return {}
    async with connection() as conn:
        rows = await conn.fetch(
            """
            SELECT key, "valueEnc"
            FROM "Setting"
            WHERE scope = 'GLOBAL'
              AND "userId" IS NULL
              AND key = ANY($1::text[])
            """,
            list(dict.fromkeys(keys)),
        )
    return {str(row["key"]): str(row["valueEnc"]) for row in rows}


async def write_transcript(
    *,
    user_id: str,
    source: str,
    url: str,
    title: str,
    channel: str | None,
    author: str | None,
    duration_sec: int,
    published_at: datetime | None,
    thumbnail_url: str | None,
    language: str,
    transcription_method: str,
    model: str | None,
    cost_usd: Decimal | None,
    md_path: str,
    plain_text: str,
    frontmatter: dict[str, Any],
) -> str:
    """Insert Transcript. Retorna id."""
    # published_at pode vir tz-aware (yt-dlp UTC) — Postgres aqui é naive
    published_at_naive = (
        published_at.replace(tzinfo=None) if published_at and published_at.tzinfo else published_at
    )
    async with connection() as conn:
        async with conn.transaction():
            # cuid() gerado via random — Prisma não está disponível aqui;
            # geramos um id compatível com cuid pattern (25 chars, starts with c).
            new_id = generate_cuid()
            await conn.execute(
                """
                INSERT INTO "Transcript" (
                    id, "userId", source, url, title, channel, author, "durationSec",
                    "publishedAt", "thumbnailUrl", language, "transcriptionMethod",
                    model, "costUsd", "mdPath", "plainText", frontmatter,
                    "createdAt", "updatedAt"
                ) VALUES (
                    $1, $2, $3::"TranscriptSource", $4, $5, $6, $7, $8, $9, $10, $11,
                    $12::"TranscriptionMethod", $13, $14, $15, $16, $17::jsonb,
                    NOW(), NOW()
                )
                """,
                new_id,
                user_id,
                source,
                url,
                title,
                channel,
                author,
                duration_sec,
                published_at_naive,
                thumbnail_url,
                language,
                transcription_method,
                model,
                cost_usd,
                md_path,
                plain_text,
                json.dumps(frontmatter, default=str),
            )
            await upsert_transcript_brain_node(
                conn,
                user_id=user_id,
                transcript_id=new_id,
                source=source,
                url=url,
                title=title,
                channel=channel,
                author=author,
                language=language,
                transcription_method=transcription_method,
                thumbnail_url=thumbnail_url,
                plain_text=plain_text,
            )
        return new_id


async def link_job_transcript_in_connection(
    conn: asyncpg.Connection,
    job_id: str,
    transcript_id: str,
) -> None:
    from . import saved_media_db

    await saved_media_db.link_job_transcript_in_connection(conn, job_id, transcript_id)


async def link_job_transcript(job_id: str, transcript_id: str) -> None:
    async with connection() as conn:
        await link_job_transcript_in_connection(
            conn,
            job_id,
            transcript_id,
        )


async def upsert_transcript_brain_node(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    transcript_id: str,
    source: str,
    url: str,
    title: str,
    channel: str | None,
    language: str,
    transcription_method: str,
    thumbnail_url: str | None,
    plain_text: str,
    status: str = "ACTIVE",
    author: str | None = None,
) -> bool:
    """Materializa o CONTENT somente sob o lease compartilhado por usuário."""
    lease = await acquire_graph_index_lease(user_id)
    if lease is None:
        return False
    try:
        async with lease.heartbeat():
            return await _upsert_transcript_brain_node_with_lease(
                conn,
                lease=lease,
                user_id=user_id,
                transcript_id=transcript_id,
                source=source,
                url=url,
                title=title,
                channel=channel,
                author=author,
                language=language,
                transcription_method=transcription_method,
                thumbnail_url=thumbnail_url,
                plain_text=plain_text,
                status=status,
            )
    finally:
        await lease.release()


async def _upsert_transcript_brain_node_with_lease(
    conn: asyncpg.Connection,
    *,
    lease: GraphIndexLease,
    user_id: str,
    transcript_id: str,
    source: str,
    url: str,
    title: str,
    channel: str | None,
    author: str | None,
    language: str,
    transcription_method: str,
    thumbnail_url: str | None,
    plain_text: str,
    status: str,
) -> bool:
    """Materializa o CONTENT e confirma ownership antes de cada fase mutável."""
    if not await lease.renew():
        return False
    node_id = generate_cuid()
    key = f"TRANSCRIPT:{transcript_id}"
    metadata = {
        "source": source,
        "url": url,
        "channel": channel,
        "author": author,
        "language": language,
        "transcriptionMethod": transcription_method,
        "thumbnailUrl": thumbnail_url,
    }
    row = await conn.fetchrow(
        """
        INSERT INTO "BrainNode" (
            id, "userId", key, type, label, description, status, metadata,
            "sourceType", "sourceId", "createdAt", "updatedAt"
        ) VALUES (
            $1, $2, $3, 'CONTENT'::"BrainNodeType", $4, $5, $6::"ContentStatus",
            $7::jsonb, 'TRANSCRIPT'::"BrainSourceType", $8, NOW(), NOW()
        )
        ON CONFLICT ("userId", key) DO UPDATE SET
            type = EXCLUDED.type,
            label = EXCLUDED.label,
            description = EXCLUDED.description,
            status = EXCLUDED.status,
            metadata = ("BrainNode".metadata - 'topicIndexVersion') || EXCLUDED.metadata,
            "sourceType" = EXCLUDED."sourceType",
            "sourceId" = EXCLUDED."sourceId",
            "updatedAt" = NOW()
        RETURNING id
        """,
        node_id,
        user_id,
        key,
        title,
        _truncate(plain_text, 800),
        status,
        json.dumps(metadata, default=str),
        transcript_id,
    )
    brain_node_id = row["id"] if row else node_id

    if not await lease.renew():
        return False
    refreshable_sources_removed = await _remove_transcript_brain_refreshable_sources(
        conn,
        lease=lease,
        user_id=user_id,
        transcript_id=transcript_id,
    )
    if not refreshable_sources_removed:
        return False

    if not await lease.renew():
        return False
    await conn.execute(
        """
        INSERT INTO "BrainSource" (
            id, "userId", "nodeId", "sourceType", "sourceId", excerpt, "createdAt"
        ) VALUES (
            $1, $2, $3, 'TRANSCRIPT'::"BrainSourceType", $4, $5, NOW()
        )
        """,
        generate_cuid(),
        user_id,
        brain_node_id,
        transcript_id,
        _truncate(title, 600),
    )

    if not await lease.renew():
        return False
    topic_edges_complete = await _upsert_transcript_topic_edges(
        conn,
        lease=lease,
        user_id=user_id,
        transcript_id=transcript_id,
        content_node_id=brain_node_id,
        title=title,
        text=plain_text,
        status=status,
    )
    if not topic_edges_complete:
        return False

    if not await lease.renew():
        return False
    marker_result = await conn.execute(
        """
        UPDATE "BrainNode"
        SET metadata = metadata || $3::jsonb,
            "updatedAt" = NOW()
        WHERE id = $1
          AND "userId" = $2
        """,
        brain_node_id,
        user_id,
        json.dumps({"topicIndexVersion": BRAIN_TOPIC_INDEX_VERSION}),
    )
    return str(marker_result) == "UPDATE 1"


async def reindex_transcript_brain_node(user_id: str, transcript_id: str) -> bool:
    """Reindexa um Transcript já persistido usando summaryMd quando existir."""
    lease = await acquire_graph_index_lease(user_id)
    if lease is None:
        return False
    try:
        async with lease.heartbeat():
            async with connection() as conn:
                row = await conn.fetchrow(
                    """
                    SELECT source, url, title, channel, author, language, "transcriptionMethod",
                           "thumbnailUrl", "plainText", "correctedPlainText",
                           "correctionState", "summaryMd", status
                    FROM "Transcript"
                    WHERE id = $1 AND "userId" = $2
                    """,
                    transcript_id,
                    user_id,
                )
                if not row:
                    if not await lease.renew():
                        return False
                    await conn.execute(
                        """
                        DELETE FROM "BrainNode"
                        WHERE "userId" = $1
                          AND "sourceType" = 'TRANSCRIPT'::"BrainSourceType"
                          AND "sourceId" = $2
                        """,
                        user_id,
                        transcript_id,
                    )
                    if not await lease.renew():
                        return False
                    await _delete_orphan_keyword_topic_nodes(conn, user_id)
                    return False
                return await _upsert_transcript_brain_node_with_lease(
                    conn,
                    lease=lease,
                    user_id=user_id,
                    transcript_id=transcript_id,
                    source=row["source"],
                    url=row["url"],
                    title=row["title"],
                    channel=row["channel"],
                    author=row["author"],
                    language=row["language"],
                    transcription_method=row["transcriptionMethod"],
                    thumbnail_url=row["thumbnailUrl"],
                    plain_text=row["summaryMd"]
                    or (
                        row["correctedPlainText"]
                        if row["correctionState"] == "ACTIVE" and row["correctedPlainText"]
                        else row["plainText"]
                    ),
                    status=row["status"],
                )
    finally:
        await lease.release()


async def reindex_missing_transcript_brain_nodes(limit: int = 50) -> int:
    """Backfill automático para conteúdos já executados que não entraram no Brain.

    Também cobre transcrições com nó CONTENT antigo, mas sem índice de tópicos v1.
    """
    async with connection() as conn:
        rows = await conn.fetch(
            """
            SELECT t.id, t."userId"
            FROM "Transcript" t
            LEFT JOIN "BrainNode" n
              ON n."userId" = t."userId"
             AND n.key = CONCAT('TRANSCRIPT:', t.id)
            WHERE n.id IS NULL
               OR n."updatedAt" < t."updatedAt"
               OR (
                    t.status = 'ACTIVE'::"ContentStatus"
                AND COALESCE(n.metadata->>'topicIndexVersion', '') <> $1
               )
            ORDER BY t."updatedAt" ASC
            LIMIT $2
            """,
            str(BRAIN_TOPIC_INDEX_VERSION),
            limit,
        )
    count = 0
    for row in rows:
        if await reindex_transcript_brain_node(row["userId"], row["id"]):
            count += 1
    return count


async def _remove_transcript_brain_refreshable_sources(
    conn: asyncpg.Connection,
    *,
    lease: GraphIndexLease,
    user_id: str,
    transcript_id: str,
) -> bool:
    if not lease.locally_owned():
        return False
    rows = await conn.fetch(
        """
        SELECT bs."edgeId"
        FROM "BrainSource" bs
        LEFT JOIN "BrainEdge" be ON be.id = bs."edgeId"
        WHERE bs."userId" = $1
          AND bs."sourceType" = 'TRANSCRIPT'::"BrainSourceType"
          AND bs."sourceId" = $2
          AND (
            bs."edgeId" IS NULL
            OR be.method = 'keyword'
          )
        """,
        user_id,
        transcript_id,
    )
    if not lease.locally_owned():
        return False
    edge_ids = [row["edgeId"] for row in rows if row["edgeId"]]
    await conn.execute(
        """
        DELETE FROM "BrainSource" bs
        USING "BrainEdge" be
        WHERE bs."edgeId" = be.id
          AND bs."userId" = $1
          AND bs."sourceType" = 'TRANSCRIPT'::"BrainSourceType"
          AND bs."sourceId" = $2
          AND be.method = 'keyword'
        """,
        user_id,
        transcript_id,
    )
    if not lease.locally_owned():
        return False
    await conn.execute(
        """
        DELETE FROM "BrainSource"
        WHERE "userId" = $1
          AND "sourceType" = 'TRANSCRIPT'::"BrainSourceType"
          AND "sourceId" = $2
          AND "edgeId" IS NULL
        """,
        user_id,
        transcript_id,
    )
    if not lease.locally_owned():
        return False
    if not edge_ids:
        return True
    remaining = await conn.fetch(
        """
        SELECT DISTINCT "edgeId"
        FROM "BrainSource"
        WHERE "edgeId" = ANY($1::text[])
        """,
        edge_ids,
    )
    if not lease.locally_owned():
        return False
    remaining_ids = {row["edgeId"] for row in remaining}
    orphan_edge_ids = [edge_id for edge_id in edge_ids if edge_id not in remaining_ids]
    if orphan_edge_ids:
        await conn.execute(
            """
            DELETE FROM "BrainEdge"
            WHERE "userId" = $1
              AND id = ANY($2::text[])
              AND method = 'keyword'
            """,
            user_id,
            orphan_edge_ids,
        )
        if not lease.locally_owned():
            return False
        await _delete_orphan_keyword_topic_nodes(conn, user_id)
        if not lease.locally_owned():
            return False
        await _delete_orphan_grounded_concept_nodes(conn, user_id)
        if not lease.locally_owned():
            return False
    return True


async def _delete_orphan_keyword_topic_nodes(conn: asyncpg.Connection, user_id: str) -> None:
    # Grace de 2 min: evita apagar tópico recém-criado no meio do reindex
    # concorrente (upsert node → cleanup → insert edge = FK violation).
    await conn.execute(
        """
        DELETE FROM "BrainNode" n
        WHERE n."userId" = $1
          AND n.type = 'TOPIC'::"BrainNodeType"
          AND n."sourceType" IS NULL
          AND n.metadata->>'method' = 'keyword'
          AND n."updatedAt" < NOW() - INTERVAL '2 minutes'
          AND NOT EXISTS (
            SELECT 1
            FROM "BrainEdge" be
            WHERE be."userId" = n."userId"
              AND (be."fromNodeId" = n.id OR be."toNodeId" = n.id)
          )
        """,
        user_id,
    )


async def _upsert_transcript_topic_edges(
    conn: asyncpg.Connection,
    *,
    lease: GraphIndexLease,
    user_id: str,
    transcript_id: str,
    content_node_id: str,
    title: str,
    text: str,
    status: str,
) -> bool:
    if status != "ACTIVE":
        return True
    complete = True
    for topic in _extract_topics(f"{title}\n{text}"):
        if not lease.locally_owned():
            return False
        topic_node_id = await _upsert_topic_node(conn, user_id, topic["slug"], topic["label"])
        if not lease.locally_owned():
            return False
        edge_row = await conn.fetchrow(
            """
            INSERT INTO "BrainEdge" (
                id, "userId", "fromNodeId", "toNodeId", kind, confidence,
                method, status, metadata, "createdAt", "updatedAt"
            ) VALUES (
                $1, $2, $3, $4, 'MENTIONS'::"BrainEdgeKind", $5,
                'keyword', 'ACTIVE'::"ContentStatus", $6::jsonb, NOW(), NOW()
            )
            ON CONFLICT ("userId", "fromNodeId", "toNodeId", kind, method) DO UPDATE SET
                confidence = EXCLUDED.confidence,
                status = EXCLUDED.status,
                metadata = EXCLUDED.metadata,
                "updatedAt" = NOW()
            RETURNING id
            """,
            generate_cuid(),
            user_id,
            content_node_id,
            topic_node_id,
            topic["confidence"],
            json.dumps({"term": topic["slug"], "count": topic["count"]}),
        )
        if not edge_row:
            complete = False
            continue
        if not lease.locally_owned():
            return False
        try:
            await conn.execute(
                """
                INSERT INTO "BrainSource" (
                    id, "userId", "edgeId", "sourceType", "sourceId", excerpt, "createdAt"
                ) VALUES (
                    $1, $2, $3, 'TRANSCRIPT'::"BrainSourceType", $4, $5, NOW()
                )
                """,
                generate_cuid(),
                user_id,
                edge_row["id"],
                transcript_id,
                topic["excerpt"],
            )
        except Exception:  # noqa: BLE001
            # Aresta pode ter sumido por reindex concorrente (FK edgeId).
            log.warning(
                "brain-source-insert-skipped",
                edge_id=edge_row["id"],
                transcript_id=transcript_id,
            )
            complete = False
    return complete


async def _upsert_topic_node(
    conn: asyncpg.Connection,
    user_id: str,
    slug: str,
    label: str,
) -> str:
    row = await conn.fetchrow(
        """
        INSERT INTO "BrainNode" (
            id, "userId", key, type, label, description, status, metadata,
            "sourceType", "sourceId", "createdAt", "updatedAt"
        ) VALUES (
            $1, $2, $3, 'TOPIC'::"BrainNodeType", $4, $5, 'ACTIVE'::"ContentStatus",
            $6::jsonb, NULL, NULL, NOW(), NOW()
        )
        ON CONFLICT ("userId", key) DO UPDATE SET
            type = EXCLUDED.type,
            label = EXCLUDED.label,
            description = EXCLUDED.description,
            metadata = EXCLUDED.metadata,
            "updatedAt" = NOW()
        RETURNING id
        """,
        generate_cuid(),
        user_id,
        f"TOPIC:{slug}",
        label,
        "Tópico detectado automaticamente nos conteúdos da biblioteca.",
        json.dumps({"method": "keyword"}),
    )
    return str(row["id"])


async def _delete_orphan_grounded_concept_nodes(conn: asyncpg.Connection, user_id: str) -> None:
    await conn.execute(
        """
        DELETE FROM "BrainNode" n
        WHERE n."userId" = $1
          AND n.type IN ('ENTITY'::"BrainNodeType", 'CLAIM'::"BrainNodeType")
          AND n."sourceType" IS NULL
          AND n.metadata->>'method' = 'llm-grounded'
          AND n."updatedAt" < NOW() - INTERVAL '2 minutes'
          AND NOT EXISTS (
            SELECT 1
            FROM "BrainEdge" be
            WHERE be."userId" = n."userId"
              AND (be."fromNodeId" = n.id OR be."toNodeId" = n.id)
          )
        """,
        user_id,
    )


async def prepare_grounded_brain_compilation(
    *,
    user_id: str,
    transcript_id: str,
    content_hash: str,
    segments: list[dict[str, Any]],
    correction_revision: int,
    source_version: int,
    source_checksum: str | None,
) -> tuple[str, list[dict[str, Any]]]:
    """Cria/retoma a cobertura segmentada sem mexer em dados manuais."""
    async with connection() as conn:
        async with conn.transaction():
            transcript = await conn.fetchrow(
                """
                SELECT id FROM "Transcript"
                WHERE "userId" = $1 AND id = $2
                  AND "correctionRevision" = $3 AND "sourceVersion" = $4
                  AND "sourceChecksum" IS NOT DISTINCT FROM $5
                FOR UPDATE
                """,
                user_id,
                transcript_id,
                correction_revision,
                source_version,
                source_checksum,
            )
            if transcript is None:
                raise GroundedCompilationClaimLostError("semantic content identity changed")
            compilation = await conn.fetchrow(
                """
                SELECT id, "contentHash" FROM "BrainCompilation"
                WHERE "userId" = $1 AND "transcriptId" = $2 FOR UPDATE
                """,
                user_id,
                transcript_id,
            )
            if compilation and compilation["contentHash"] != content_hash:
                # Remove só a evidência desta fonte. Relações automáticas podem
                # ter suporte em outras fontes e, nesse caso, permanecem.
                await conn.execute(
                    """
                    DELETE FROM "BrainSource" source
                    USING "BrainEdge" edge
                    WHERE source."userId" = $1
                      AND source."sourceId" = $2
                      AND source."edgeId" = edge.id
                      AND edge."userId" = $1
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
                      AND NOT EXISTS (
                          SELECT 1 FROM "BrainSource" source WHERE source."edgeId" = edge.id
                      )
                    """,
                    user_id,
                )
                await conn.execute(
                    'DELETE FROM "BrainCompilationSegment" WHERE "compilationId" = $1',
                    compilation["id"],
                )
                await conn.execute(
                    """
                    UPDATE "BrainCompilation"
                    SET "contentHash" = $2, status = 'PENDING'::"BrainCompilationStatus",
                        "totalSegments" = 0, "completedSegments" = 0, "lastError" = NULL,
                        "updatedAt" = NOW()
                    WHERE id = $1
                    """,
                    compilation["id"],
                    content_hash,
                )
            elif not compilation:
                compilation = await conn.fetchrow(
                    """
                    INSERT INTO "BrainCompilation" (
                        id, "userId", "transcriptId", "contentHash", status,
                        "totalSegments", "completedSegments", "createdAt", "updatedAt"
                    ) VALUES (
                        $1, $2, $3, $4, 'PENDING'::"BrainCompilationStatus", 0, 0, NOW(), NOW()
                    )
                    RETURNING id, "contentHash"
                    """,
                    generate_cuid(),
                    user_id,
                    transcript_id,
                    content_hash,
                )
            assert compilation is not None
            compilation_id = str(compilation["id"])
            for segment in segments:
                await conn.execute(
                    """
                    INSERT INTO "BrainCompilationSegment" (
                        id, "compilationId", "segmentKey", status, "startLine", "endLine",
                        "startSec", "endSec", "createdAt", "updatedAt"
                    ) VALUES (
                        $1, $2, $3, 'PENDING'::"BrainCompilationStatus", $4, $5, $6, $7,
                        NOW(), NOW()
                    ) ON CONFLICT ("compilationId", "segmentKey") DO NOTHING
                    """,
                    generate_cuid(),
                    compilation_id,
                    segment["key"],
                    segment["start_line"],
                    segment["end_line"],
                    segment.get("start_sec"),
                    segment.get("end_sec"),
                )
            await brain_compilation_db.refresh_compilation(conn, compilation_id, user_id)
            rows = await conn.fetch(
                """
                SELECT "segmentKey", status, "startLine", "endLine", "startSec", "endSec"
                FROM "BrainCompilationSegment"
                WHERE "compilationId" = $1
                  AND attempts < $2
                  AND (
                    status = 'PENDING'::"BrainCompilationStatus"
                    OR status = 'FAILED'::"BrainCompilationStatus"
                    OR (
                      status = 'RETRY'::"BrainCompilationStatus"
                      AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW())
                    )
                    OR (
                      status = 'RUNNING'::"BrainCompilationStatus"
                      AND "leaseExpiresAt" < NOW()
                    )
                  )
                ORDER BY "startLine", "endLine", "segmentKey"
                """,
                compilation_id,
                brain_compilation_db.GROUNDED_SEGMENT_MAX_ATTEMPTS,
            )
    return compilation_id, [dict(row) for row in rows]


def _grounded_evidence_key(
    transcript_id: str,
    segment_key: str,
    slug: str,
    excerpt: str,
) -> str:
    normalized_excerpt = re.sub(r"\s+", " ", excerpt).strip().casefold()
    raw = "\0".join((transcript_id, segment_key, slug, normalized_excerpt))
    return sha256(raw.encode("utf-8")).hexdigest()


def _require_grounded_compilation_lease(lease: GraphIndexLease) -> None:
    if not lease.locally_owned():
        raise GroundedCompilationLeaseLostError("lease de compilação do Brain perdido")


async def upsert_grounded_brain_items(
    *,
    user_id: str,
    transcript_id: str,
    compilation_id: str,
    segment: dict[str, Any],
    items: list[dict[str, Any]],
    relations: list[dict[str, Any]],
    lease: GraphIndexLease,
    worker_id: str,
    content_hash: str,
    correction_revision: int,
    source_version: int,
    source_checksum: str | None,
) -> int:
    """Materializa um segmento atomicamente e marca sua cobertura concluída."""
    created = 0
    async with connection() as conn:
        async with conn.transaction():
            claim = await conn.fetchrow(
                """
                SELECT segment.id,
                       COALESCE(transcript."sourceCollectedAt", transcript."createdAt")
                         AS "observedAt"
                FROM "BrainCompilation" compilation
                JOIN "BrainCompilationSegment" segment
                  ON segment."compilationId" = compilation.id
                JOIN "Transcript" transcript
                  ON transcript.id = compilation."transcriptId"
                 AND transcript."userId" = compilation."userId"
                WHERE compilation.id = $1
                  AND compilation."userId" = $2
                  AND compilation."transcriptId" = $3
                  AND compilation."contentHash" = $4
                  AND segment."segmentKey" = $5
                  AND segment.status = 'RUNNING'::"BrainCompilationStatus"
                  AND segment."claimedBy" = $6
                  AND segment."leaseExpiresAt" > NOW()
                  AND transcript."correctionRevision" = $7
                  AND transcript."sourceVersion" = $8
                  AND transcript."sourceChecksum" IS NOT DISTINCT FROM $9
                FOR UPDATE OF segment
                """,
                compilation_id,
                user_id,
                transcript_id,
                content_hash,
                segment["key"],
                worker_id,
                correction_revision,
                source_version,
                source_checksum,
            )
            if not claim:
                raise GroundedCompilationClaimLostError("semantic segment claim is no longer valid")
            observed_at = claim.get("observedAt") or _utcnow_naive()
            content = await conn.fetchrow(
                """
                SELECT id FROM "BrainNode"
                WHERE "userId" = $1 AND key = $2
                """,
                user_id,
                f"TRANSCRIPT:{transcript_id}",
            )
            if not content:
                return 0
            _require_grounded_compilation_lease(lease)
            content_node_id = str(content["id"])
            # Uma retomada substitui somente a evidência daquele segmento.
            await conn.execute(
                """
                DELETE FROM "BrainSource" source
                USING "BrainEdge" edge
                WHERE source."userId" = $1
                  AND source."sourceId" = $2
                  AND source."segmentKey" = $3
                  AND source."edgeId" = edge.id
                  AND edge.method LIKE 'llm-grounded%'
                """,
                user_id,
                transcript_id,
                segment["key"],
            )
            await conn.execute(
                """
                DELETE FROM "BrainEntityAlias"
                WHERE "userId" = $1
                  AND "sourceType" = 'TRANSCRIPT'::"BrainSourceType"
                  AND "sourceId" = $2
                  AND "segmentKey" = $3
                  AND method = 'llm-grounded-alias'
                """,
                user_id,
                transcript_id,
                segment["key"],
            )
            await conn.execute(
                """
                DELETE FROM "BrainFact" fact
                WHERE fact."userId" = $1
                  AND fact.method = 'llm-grounded-temporal'
                  AND NOT EXISTS (
                    SELECT 1 FROM "BrainSource" source WHERE source."factId" = fact.id
                  )
                """,
                user_id,
            )
            _require_grounded_compilation_lease(lease)
            concepts: dict[str, tuple[str, str]] = {}
            for item in items:
                _require_grounded_compilation_lease(lease)
                kind = str(item.get("kind") or "entity")
                label = str(item.get("label") or "").strip()
                excerpt = str(item.get("excerpt") or "").strip()
                conf = float(item.get("confidence") or 0.7)
                slug = str(item.get("slug") or "")
                entity_type = normalize_entity_type(str(item.get("entity_type") or "OTHER"))
                aliases = tuple(
                    str(alias).strip()
                    for alias in (item.get("aliases") or [])
                    if str(alias).strip()
                )
                if not label or not excerpt or not slug:
                    continue
                node_type = "CLAIM" if kind == "claim" else "ENTITY"
                if kind == "claim":
                    concept_id = await brain_temporal_store.upsert_concept_node(
                        conn,
                        user_id=user_id,
                        key=f"CLAIM:{slug}",
                        node_type=node_type,
                        label=label,
                    )
                else:
                    concept_id = await brain_temporal_store.resolve_entity_node(
                        conn,
                        user_id=user_id,
                        transcript_id=transcript_id,
                        segment_key=segment["key"],
                        label=label,
                        entity_type=entity_type,
                        aliases=aliases,
                        excerpt=excerpt,
                    )
                    await brain_temporal_store.upsert_entity_aliases(
                        conn,
                        user_id=user_id,
                        transcript_id=transcript_id,
                        segment_key=segment["key"],
                        entity_node_id=concept_id,
                        label=label,
                        aliases=aliases,
                        entity_type=entity_type,
                        confidence=conf,
                    )
                concepts[slug] = (concept_id, kind)
                edge_kind = "SUPPORTS" if kind == "claim" else "MENTIONS"
                edge_row = await conn.fetchrow(
                    """
                    INSERT INTO "BrainEdge" (
                        id, "userId", "fromNodeId", "toNodeId", kind, confidence,
                        method, status, metadata, "createdAt", "updatedAt"
                    ) VALUES (
                        $1, $2, $3, $4, $5::"BrainEdgeKind", $6,
                        'llm-grounded', 'ACTIVE'::"ContentStatus", $7::jsonb, NOW(), NOW()
                    )
                    ON CONFLICT ("userId", "fromNodeId", "toNodeId", kind, method) DO UPDATE SET
                        confidence = EXCLUDED.confidence,
                        status = EXCLUDED.status,
                        metadata = EXCLUDED.metadata,
                        "updatedAt" = NOW()
                    RETURNING id
                    """,
                    generate_cuid(),
                    user_id,
                    content_node_id,
                    concept_id,
                    edge_kind,
                    conf,
                    json.dumps(
                        {
                            "term": slug,
                            "kind": kind,
                            "extractor": "openrouter-grounded-segmented",
                        }
                    ),
                )
                if not edge_row:
                    continue
                _require_grounded_compilation_lease(lease)
                await brain_temporal_store.upsert_evidence_source(
                    conn,
                    user_id=user_id,
                    transcript_id=transcript_id,
                    edge_id=edge_row["id"],
                    fact_id=None,
                    segment=segment,
                    evidence_key=_grounded_evidence_key(
                        transcript_id, segment["key"], f"item:{slug}", excerpt
                    ),
                    excerpt=excerpt,
                )
                created += 1
                _require_grounded_compilation_lease(lease)
            for relation in relations:
                subject_slug = str(relation.get("subject_slug") or "")
                object_slug = str(relation.get("object_slug") or "")
                subject = concepts.get(subject_slug)
                obj = concepts.get(object_slug)
                relation_kind = str(relation.get("kind") or "")
                excerpt = str(relation.get("excerpt") or "").strip()
                if (
                    not subject
                    or not obj
                    or not excerpt
                    or relation_kind
                    not in {"SUPPORTS", "CONTRADICTS", "SAME_AS", "RELATED_TO", "PART_OF"}
                ):
                    continue
                _require_grounded_compilation_lease(lease)
                if relation_kind == "CONTRADICTS":
                    support_counts = await conn.fetchrow(
                        """
                        SELECT
                            COUNT(DISTINCT source."sourceId") FILTER (
                                WHERE edge."toNodeId" = $2
                            ) AS subject_sources,
                            COUNT(DISTINCT source."sourceId") FILTER (
                                WHERE edge."toNodeId" = $3
                            ) AS object_sources,
                            COUNT(DISTINCT source."sourceId") AS total_sources
                        FROM "BrainSource" source
                        JOIN "BrainEdge" edge ON edge.id = source."edgeId"
                        WHERE source."userId" = $1
                          AND edge."userId" = $1
                          AND edge.method = 'llm-grounded'
                          AND edge.kind = 'SUPPORTS'::"BrainEdgeKind"
                          AND edge."toNodeId" IN ($2, $3)
                        """,
                        user_id,
                        subject[0],
                        obj[0],
                    )
                    if (
                        not support_counts
                        or int(support_counts["subject_sources"] or 0) < 1
                        or int(support_counts["object_sources"] or 0) < 1
                        or int(support_counts["total_sources"] or 0) < 2
                    ):
                        continue
                edge_row = await conn.fetchrow(
                    """
                    INSERT INTO "BrainEdge" (
                        id, "userId", "fromNodeId", "toNodeId", kind, confidence, method,
                        status, metadata, "createdAt", "updatedAt"
                    ) VALUES (
                        $1, $2, $3, $4, $5::"BrainEdgeKind", $6, 'llm-grounded-relation',
                        'ACTIVE'::"ContentStatus", $7::jsonb, NOW(), NOW()
                    ) ON CONFLICT ("userId", "fromNodeId", "toNodeId", kind, method) DO UPDATE SET
                        confidence = EXCLUDED.confidence, metadata = EXCLUDED.metadata,
                        "updatedAt" = NOW()
                    RETURNING id
                    """,
                    generate_cuid(),
                    user_id,
                    subject[0],
                    obj[0],
                    relation_kind,
                    float(relation.get("confidence") or 0.7),
                    json.dumps(
                        {
                            "predicate": str(relation.get("predicate") or ""),
                            "extractor": "openrouter-grounded-relation",
                        }
                    ),
                )
                if edge_row:
                    predicate = str(relation.get("predicate") or relation_kind).strip()
                    fact_id = await brain_temporal_store.upsert_fact(
                        conn,
                        user_id=user_id,
                        edge_id=str(edge_row["id"]),
                        from_node_id=subject[0],
                        to_node_id=obj[0],
                        kind=relation_kind,
                        predicate=predicate,
                        valid_from=(
                            str(relation["valid_from"]) if relation.get("valid_from") else None
                        ),
                        valid_to=(str(relation["valid_to"]) if relation.get("valid_to") else None),
                        observed_at=observed_at,
                        confidence=float(relation.get("confidence") or 0.7),
                    )
                    relation_evidence_key = _grounded_evidence_key(
                        transcript_id,
                        segment["key"],
                        f"relation:{subject_slug}:{relation_kind}:{object_slug}",
                        excerpt,
                    )
                    await brain_temporal_store.upsert_evidence_source(
                        conn,
                        user_id=user_id,
                        transcript_id=transcript_id,
                        edge_id=edge_row["id"],
                        fact_id=fact_id,
                        segment=segment,
                        evidence_key=relation_evidence_key,
                        excerpt=excerpt,
                    )
                    created += 1
            _require_grounded_compilation_lease(lease)
            await conn.execute(
                """
                DELETE FROM "BrainFact" fact
                WHERE fact."userId" = $1
                  AND fact.method = 'llm-grounded-temporal'
                  AND NOT EXISTS (
                    SELECT 1 FROM "BrainSource" source WHERE source."factId" = fact.id
                  )
                """,
                user_id,
            )
            _require_grounded_compilation_lease(lease)
            await conn.execute(
                """
                DELETE FROM "BrainEdge" edge
                WHERE edge."userId" = $1
                  AND edge.method LIKE 'llm-grounded%'
                  AND NOT EXISTS (
                      SELECT 1 FROM "BrainSource" source WHERE source."edgeId" = edge.id
                  )
                """,
                user_id,
            )
            _require_grounded_compilation_lease(lease)
            await conn.execute(
                """
                UPDATE "BrainCompilationSegment"
                SET status = 'COMPLETED'::"BrainCompilationStatus",
                    "itemCount" = $3, error = NULL,
                    "claimedBy" = NULL, "claimedAt" = NULL, "leaseExpiresAt" = NULL,
                    "nextAttemptAt" = NULL, "updatedAt" = NOW()
                WHERE "compilationId" = $1 AND "segmentKey" = $2
                  AND status = 'RUNNING'::"BrainCompilationStatus"
                  AND "claimedBy" = $4
                """,
                compilation_id,
                segment["key"],
                created,
                worker_id,
            )
            _require_grounded_compilation_lease(lease)
            await brain_compilation_db.refresh_compilation(conn, compilation_id, user_id)
            _require_grounded_compilation_lease(lease)
    return created


async def store_content_embedding(
    *,
    user_id: str,
    transcript_id: str,
    model: str,
    vector: list[float],
    correction_revision: int,
    source_version: int,
    source_checksum: str | None,
) -> bool:
    """Persiste embedding no metadata do nó CONTENT (opt-in, sem pgvector)."""
    if not vector:
        return False
    lease = await acquire_graph_index_lease(user_id)
    if lease is None:
        return False
    payload = {
        "embedding": {
            "model": model,
            "dims": len(vector),
            "vector": vector,
            "updatedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "correctionRevision": correction_revision,
            "sourceVersion": source_version,
            "sourceChecksum": source_checksum,
        }
    }
    try:
        async with lease.heartbeat():
            if not await lease.renew():
                return False
            async with connection() as conn:
                if not lease.locally_owned():
                    return False
                result = await conn.execute(
                    """
                    UPDATE "BrainNode"
                    SET metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
                        "updatedAt" = NOW()
                    WHERE "userId" = $1
                      AND key = $2
                      AND EXISTS (
                        SELECT 1 FROM "Transcript" transcript
                        WHERE transcript.id = $4 AND transcript."userId" = $1
                          AND transcript."correctionRevision" = $5
                          AND transcript."sourceVersion" = $6
                          AND transcript."sourceChecksum" IS NOT DISTINCT FROM $7
                      )
                    """,
                    user_id,
                    f"TRANSCRIPT:{transcript_id}",
                    json.dumps(payload),
                    transcript_id,
                    correction_revision,
                    source_version,
                    source_checksum,
                )
            return str(result) == "UPDATE 1"
    finally:
        await lease.release()


def _extract_topics(value: str) -> list[dict[str, Any]]:
    text = value or ""
    normalized = _normalize_topic_text(text)
    counts: dict[str, int] = {}
    for match in re.findall(r"[a-z0-9][a-z0-9_-]{3,}", normalized):
        token = match.strip("_-")
        if (
            len(token) < TOPIC_MIN_LEN
            or token.isdigit()
            or token in TOPIC_STOPWORDS
            or token.startswith(("http", "www"))
        ):
            continue
        counts[token] = counts.get(token, 0) + 1

    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:TOPIC_LIMIT]
    return [
        {
            "slug": token,
            "label": _topic_label(token),
            "count": count,
            "confidence": round(min(1.0, 0.35 + count * 0.08), 4),
            "excerpt": _topic_excerpt(text, token),
        }
        for token, count in ranked
    ]


def _normalize_topic_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_text = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    return ascii_text.lower()


def _topic_label(slug: str) -> str:
    parts = [part for part in re.split(r"[-_]+", slug) if part]
    if not parts:
        return slug
    return " ".join(part.upper() if len(part) <= 3 else part.capitalize() for part in parts)


def _topic_excerpt(text: str, slug: str) -> str | None:
    if not text.strip():
        return None
    for sentence in re.split(r"(?<=[.!?])\s+|\n+", text):
        if slug in _normalize_topic_text(sentence):
            return _truncate(sentence, 600)
    return _truncate(text, 600)


async def list_library_folder_names(user_id: str) -> list[str]:
    """Nomes das pastas do workspace (raiz e aninhadas) para classificação."""
    async with connection() as conn:
        rows = await conn.fetch(
            """
            SELECT name
            FROM "LibraryFolder"
            WHERE "userId" = $1
            ORDER BY name ASC
            """,
            user_id,
        )
    return [str(row["name"]) for row in rows if row["name"]]


async def list_tag_names(user_id: str) -> list[str]:
    """Nomes de tags do workspace (para reuso no prompt de geração)."""
    async with connection() as conn:
        rows = await conn.fetch(
            """
            SELECT name
            FROM "Tag"
            WHERE "userId" = $1
            ORDER BY name ASC
            """,
            user_id,
        )
    return [str(row["name"]) for row in rows if row["name"]]


async def list_transcript_tag_names(user_id: str, transcript_id: str) -> list[str]:
    async with connection() as conn:
        rows = await conn.fetch(
            """
            SELECT t.name
            FROM "TranscriptTag" tt
            JOIN "Tag" t ON t.id = tt."tagId"
            JOIN "Transcript" tr ON tr.id = tt."transcriptId"
            WHERE tr."userId" = $1
              AND t."userId" = $1
              AND tt."transcriptId" = $2
            ORDER BY tt."createdAt" ASC
            """,
            user_id,
            transcript_id,
        )
    return [str(row["name"]) for row in rows if row["name"]]


async def start_summary_enrichment(user_id: str, transcript_id: str) -> dict[str, Any] | None:
    async with connection() as conn:
        row = await conn.fetchrow(
            """
            UPDATE "Transcript"
            SET "summaryStatus" = 'RUNNING'::"EnrichmentStatus",
                "summaryAttempts" = "summaryAttempts" + 1,
                "summaryStartedAt" = NOW(), "summaryError" = NULL
            WHERE "userId" = $1 AND id = $2 AND "summaryMd" IS NULL
              AND "summaryAttempts" < 6
              AND "summaryStatus" IN (
                'PENDING'::"EnrichmentStatus", 'RETRY'::"EnrichmentStatus"
              )
              AND (
                "summaryNextAttemptAt" IS NULL OR "summaryNextAttemptAt" <= NOW()
              )
            RETURNING "summaryAttempts" AS "summaryAttempt", "correctionRevision",
              "sourceVersion", "sourceChecksum"
            """,
            user_id,
            transcript_id,
        )
    return dict(row) if row is not None else None


async def claim_pending_summary_enrichments(limit: int = 10) -> list[dict[str, Any]]:
    async with connection() as conn:
        rows = await conn.fetch(
            """
            WITH exhausted AS (
                UPDATE "Transcript"
                SET "summaryStatus" = 'SKIPPED'::"EnrichmentStatus",
                    "summaryStartedAt" = NULL, "summaryNextAttemptAt" = NULL,
                    "summaryError" = COALESCE(
                      "summaryError", 'Limite de 6 tentativas de resumo atingido.'
                    )
                WHERE "summaryAttempts" >= 6 AND "summaryMd" IS NULL
                  AND (
                    "summaryStatus" IN (
                      'PENDING'::"EnrichmentStatus", 'RETRY'::"EnrichmentStatus"
                    ) OR (
                      "summaryStatus" = 'RUNNING'::"EnrichmentStatus"
                      AND "summaryStartedAt" < NOW() - INTERVAL '15 minutes'
                    )
                  )
                RETURNING id
            ), candidates AS (
                SELECT id FROM "Transcript"
                WHERE status = 'ACTIVE'::"ContentStatus" AND "summaryMd" IS NULL
                  AND "summaryAttempts" < 6
                  AND (
                    "summaryStatus" IN (
                      'PENDING'::"EnrichmentStatus", 'RETRY'::"EnrichmentStatus"
                    ) OR (
                      "summaryStatus" = 'RUNNING'::"EnrichmentStatus"
                      AND "summaryStartedAt" < NOW() - INTERVAL '15 minutes'
                    )
                  )
                  AND (
                    "summaryNextAttemptAt" IS NULL OR "summaryNextAttemptAt" <= NOW()
                  )
                ORDER BY "createdAt" ASC
                FOR UPDATE SKIP LOCKED
                LIMIT $1
            )
            UPDATE "Transcript" t
            SET "summaryStatus" = 'RUNNING'::"EnrichmentStatus",
                "summaryAttempts" = t."summaryAttempts" + 1,
                "summaryStartedAt" = NOW(), "summaryError" = NULL
            FROM candidates
            WHERE t.id = candidates.id
            RETURNING t.id, t."userId", t."summaryAttempts" AS "summaryAttempt",
              t."correctionRevision", t."sourceVersion", t."sourceChecksum", (
              SELECT j.id FROM "Job" j WHERE j."transcriptId" = t.id LIMIT 1
            ) AS "jobId"
            """,
            limit,
        )
    return [dict(row) for row in rows]


async def finish_summary_enrichment(
    user_id: str,
    transcript_id: str,
    *,
    claim_attempt: int,
    correction_revision: int,
    source_version: int,
    source_checksum: str | None,
    status: str,
    error: str | None = None,
) -> bool:
    async with connection() as conn:
        row = await conn.fetchrow(
            """
            UPDATE "Transcript"
            SET "summaryStatus" = CASE
                  WHEN $3::text = 'RETRY' AND "summaryAttempts" >= 6
                  THEN 'SKIPPED'::"EnrichmentStatus"
                  ELSE $3::"EnrichmentStatus"
                END,
                "summaryStartedAt" = NULL,
                "summaryNextAttemptAt" = CASE
                  WHEN $3::text = 'RETRY' AND "summaryAttempts" < 6
                  THEN NOW() + (
                    LEAST(3600, 60 * POWER(2, LEAST("summaryAttempts", 6)))
                    * INTERVAL '1 second'
                  ) ELSE NULL END,
                "summaryError" = $4
            WHERE "userId" = $1 AND id = $2
              AND "summaryStatus" = 'RUNNING'::"EnrichmentStatus"
              AND "summaryAttempts" = $5
              AND "correctionRevision" = $6
              AND "sourceVersion" = $7
              AND "sourceChecksum" IS NOT DISTINCT FROM $8
            RETURNING id
            """,
            user_id,
            transcript_id,
            status,
            (error or "")[:500] or None,
            claim_attempt,
            correction_revision,
            source_version,
            source_checksum,
        )
    return row is not None


async def complete_summary_enrichment(
    user_id: str,
    transcript_id: str,
    *,
    claim_attempt: int,
    correction_revision: int,
    source_version: int,
    source_checksum: str | None,
    summary_md: str,
) -> bool:
    """Persiste o resumo somente se esta geração ainda possui o claim."""
    async with connection() as conn:
        row = await conn.fetchrow(
            """
            UPDATE "Transcript"
            SET "summaryMd" = $4,
                "summaryStatus" = 'COMPLETE'::"EnrichmentStatus",
                "summaryStartedAt" = NULL, "summaryNextAttemptAt" = NULL,
                "summaryError" = NULL, "updatedAt" = NOW()
            WHERE id = $1 AND "userId" = $2
              AND "summaryStatus" = 'RUNNING'::"EnrichmentStatus"
              AND "summaryAttempts" = $3
              AND "correctionRevision" = $5
              AND "sourceVersion" = $6
              AND "sourceChecksum" IS NOT DISTINCT FROM $7
            RETURNING id
            """,
            transcript_id,
            user_id,
            claim_attempt,
            summary_md,
            correction_revision,
            source_version,
            source_checksum,
        )
    return row is not None


async def get_transcript_title_content_md_path(
    user_id: str,
    transcript_id: str,
) -> tuple[str, str, str | None, int, int, str | None] | None:
    """Título, conteúdo textual e caminho do Markdown canônico para o Brain."""
    async with connection() as conn:
        row = await conn.fetchrow(
            """
            SELECT title, "plainText", "correctedMarkdown", "correctedPlainText",
                   "correctionState", "summaryMd", "mdPath", "correctionRevision",
                   "sourceVersion", "sourceChecksum"
            FROM "Transcript"
            WHERE "userId" = $1 AND id = $2
            """,
            user_id,
            transcript_id,
        )
    if not row:
        return None
    title = str(row["title"] or "")
    identity = (
        int(row["correctionRevision"]),
        int(row["sourceVersion"]),
        str(row["sourceChecksum"]) if row["sourceChecksum"] else None,
    )
    if row["correctionState"] == "ACTIVE" and row["correctedMarkdown"]:
        return title, str(row["correctedMarkdown"]), None, *identity
    content = (row["summaryMd"] or row["plainText"] or "").strip()
    md_path = row["mdPath"]
    return title, content, (str(md_path) if md_path else None), *identity


async def apply_tags_to_transcript(
    *,
    user_id: str,
    transcript_id: str,
    tag_names: list[str],
    current_folder_id: str | None,
    claim_attempt: int,
    correction_revision: int,
    source_version: int,
    source_checksum: str | None,
) -> list[str]:
    """
    Cria/reutiliza Tag + pasta, liga TranscriptTag, seta folderId só se vazio
    (R-FOLDER, spec 075). Retorna nomes aplicados.
    """
    from .tags import pick_folder_id, slugify_tag

    applied: list[str] = []
    first_folder_id: str | None = None

    async with connection() as conn, conn.transaction():
        owns_transcript = await conn.fetchrow(
            """
            SELECT id FROM "Transcript"
            WHERE "userId" = $1 AND id = $2
              AND "taggingStatus" = 'RUNNING'::"EnrichmentStatus"
              AND "taggingAttempts" = $3
              AND "correctionRevision" = $4
              AND "sourceVersion" = $5
              AND "sourceChecksum" IS NOT DISTINCT FROM $6
            FOR UPDATE
            """,
            user_id,
            transcript_id,
            claim_attempt,
            correction_revision,
            source_version,
            source_checksum,
        )
        if not owns_transcript:
            return []

        for raw_name in tag_names:
            name = " ".join((raw_name or "").split()).strip()[:120]
            if not name:
                continue
            slug = slugify_tag(name)
            if not slug:
                continue

            existing = await conn.fetchrow(
                """
                SELECT id, name, "folderId"
                FROM "Tag"
                WHERE "userId" = $1 AND slug = $2
                """,
                user_id,
                slug,
            )
            if existing:
                tag_id = str(existing["id"])
                tag_name = str(existing["name"])
                folder_id = existing["folderId"]
                if not folder_id:
                    folder_id = await _ensure_folder_for_tag_conn(conn, user_id, tag_name)
                    await conn.execute(
                        """
                        UPDATE "Tag" SET "folderId" = $2, "updatedAt" = NOW()
                        WHERE id = $1 AND "userId" = $3
                        """,
                        tag_id,
                        folder_id,
                        user_id,
                    )
                else:
                    folder_id = str(folder_id)
            else:
                folder_id = await _ensure_folder_for_tag_conn(conn, user_id, name)
                tag_id = generate_cuid()
                try:
                    await conn.execute(
                        """
                        INSERT INTO "Tag" (
                            id, "userId", name, slug, "folderId", "createdAt", "updatedAt"
                        ) VALUES (
                            $1, $2, $3, $4, $5, NOW(), NOW()
                        )
                        """,
                        tag_id,
                        user_id,
                        name,
                        slug,
                        folder_id,
                    )
                    tag_name = name
                except Exception:  # noqa: BLE001 — corrida UNIQUE(userId, slug)
                    raced = await conn.fetchrow(
                        """
                        SELECT id, name, "folderId"
                        FROM "Tag"
                        WHERE "userId" = $1 AND slug = $2
                        """,
                        user_id,
                        slug,
                    )
                    if not raced:
                        raise
                    tag_id = str(raced["id"])
                    tag_name = str(raced["name"])
                    folder_id = str(raced["folderId"] or folder_id)

            linked = await conn.fetchval(
                """
                INSERT INTO "TranscriptTag" ("transcriptId", "tagId", "createdAt")
                SELECT tr.id, tag.id, NOW()
                FROM "Transcript" tr
                JOIN "Tag" tag
                  ON tag.id = $3
                 AND tag."userId" = $1
                WHERE tr.id = $2
                  AND tr."userId" = $1
                ON CONFLICT ("transcriptId", "tagId") DO UPDATE
                  SET "createdAt" = "TranscriptTag"."createdAt"
                RETURNING 1
                """,
                user_id,
                transcript_id,
                tag_id,
            )
            if not linked:
                continue
            applied.append(tag_name)
            if first_folder_id is None:
                first_folder_id = folder_id

        target = pick_folder_id(current_folder_id, first_folder_id)
        if target and current_folder_id is None:
            await conn.execute(
                """
                UPDATE "Transcript"
                SET "folderId" = $2, "updatedAt" = NOW()
                WHERE id = $1 AND "folderId" IS NULL AND "userId" = $3
                """,
                transcript_id,
                target,
                user_id,
            )

    return applied


async def _ensure_folder_for_tag_conn(conn: Any, user_id: str, name: str) -> str:
    """Pasta livre (sem Tag.folderId) de mesmo nome, ou cria no root."""
    clean = " ".join(name.split()).strip()[:120]
    free = await conn.fetchrow(
        """
        SELECT f.id
        FROM "LibraryFolder" f
        LEFT JOIN "Tag" t ON t."folderId" = f.id
        WHERE f."userId" = $1 AND lower(f.name) = lower($2) AND t.id IS NULL
        ORDER BY f."createdAt" ASC
        LIMIT 1
        """,
        user_id,
        clean,
    )
    if free:
        return str(free["id"])
    # Reusa pasta existente mesmo com tag (outro caso) — ou cria.
    existing = await conn.fetchrow(
        """
        SELECT id FROM "LibraryFolder"
        WHERE "userId" = $1 AND lower(name) = lower($2)
        ORDER BY "createdAt" ASC
        LIMIT 1
        """,
        user_id,
        clean,
    )
    if existing:
        return str(existing["id"])
    folder_id = generate_cuid()
    await conn.execute(
        """
        INSERT INTO "LibraryFolder" (
            id, "userId", "parentId", name, "createdAt", "updatedAt"
        ) VALUES (
            $1, $2, NULL, $3, NOW(), NOW()
        )
        """,
        folder_id,
        user_id,
        clean,
    )
    return folder_id


async def ensure_library_folder(user_id: str, name: str) -> str:
    """Reusa pasta pelo nome (case-insensitive) ou cria no root. Retorna id."""
    clean = " ".join(name.split()).strip()
    if not clean:
        raise ValueError("nome de pasta vazio")
    async with connection() as conn:
        existing = await conn.fetchrow(
            """
            SELECT id, name
            FROM "LibraryFolder"
            WHERE "userId" = $1 AND lower(name) = lower($2)
            ORDER BY "createdAt" ASC
            LIMIT 1
            """,
            user_id,
            clean,
        )
        if existing:
            return str(existing["id"])
        folder_id = generate_cuid()
        await conn.execute(
            """
            INSERT INTO "LibraryFolder" (
                id, "userId", "parentId", name, "createdAt", "updatedAt"
            ) VALUES (
                $1, $2, NULL, $3, NOW(), NOW()
            )
            """,
            folder_id,
            user_id,
            clean[:120],
        )
        return folder_id


async def set_transcript_folder(transcript_id: str, folder_id: str) -> None:
    async with connection() as conn:
        await conn.execute(
            """
            UPDATE "Transcript"
            SET "folderId" = $2, "updatedAt" = NOW()
            WHERE id = $1
            """,
            transcript_id,
            folder_id,
        )


async def mark_job_done(job_id: str) -> None:
    token = _job_token(job_id)
    async with connection() as conn:
        if token:
            row = await conn.fetchrow(
                """
                UPDATE "Job"
                SET status = 'DONE', "finishedAt" = $2,
                    "heartbeatAt" = NULL, "leaseExpiresAt" = NULL
                WHERE id = $1 AND status = 'RUNNING'
                  AND "workerId" = $3 AND attempt = $4
                  AND "leaseExpiresAt" >= $2
                RETURNING id
                """,
                job_id,
                _utcnow_naive(),
                token.worker_id,
                token.attempt,
            )
            if row is None:
                raise JobLeaseLostError("job completion rejected by lease fence")
        else:
            await conn.execute(
                'UPDATE "Job" SET status = \'DONE\', "finishedAt" = $2 WHERE id = $1',
                job_id,
                _utcnow_naive(),
            )


async def mark_job_completed_with_warnings(job_id: str, warning: str) -> None:
    """Finaliza um job utilizável, porém com enriquecimentos recuperáveis pendentes."""
    token = _job_token(job_id)
    async with connection() as conn:
        if token:
            row = await conn.fetchrow(
                """
                UPDATE "Job"
                SET status = 'COMPLETED_WITH_WARNINGS', "errorMsg" = $2, "finishedAt" = $3,
                    "heartbeatAt" = NULL, "leaseExpiresAt" = NULL
                WHERE id = $1 AND status = 'RUNNING'
                  AND "workerId" = $4 AND attempt = $5 AND "leaseExpiresAt" >= $3
                RETURNING id
                """,
                job_id,
                warning[:1000],
                _utcnow_naive(),
                token.worker_id,
                token.attempt,
            )
            if row is None:
                raise JobLeaseLostError("job completion rejected by lease fence")
        else:
            await conn.execute(
                """
                UPDATE "Job"
                SET status = 'COMPLETED_WITH_WARNINGS', "errorMsg" = $2, "finishedAt" = $3
                WHERE id = $1
                """,
                job_id,
                warning[:1000],
                _utcnow_naive(),
            )


async def get_transcript_enrichment_statuses(
    user_id: str, transcript_id: str
) -> dict[str, str] | None:
    async with connection() as conn:
        row = await conn.fetchrow(
            """
            SELECT "summaryStatus"::text AS summary, "taggingStatus"::text AS tagging
            FROM "Transcript" WHERE id = $1 AND "userId" = $2
            """,
            transcript_id,
            user_id,
        )
    return {"summary": str(row["summary"]), "tagging": str(row["tagging"])} if row else None


async def link_job_done(job_id: str, transcript_id: str) -> None:
    await link_job_transcript(job_id, transcript_id)
    await mark_job_done(job_id)


async def mark_job_failed(job_id: str, error_msg: str) -> None:
    token = _job_token(job_id)
    async with connection() as conn:
        if token:
            row = await conn.fetchrow(
                """
                UPDATE "Job"
                SET status = 'FAILED', "errorMsg" = $2, "finishedAt" = $3,
                    "heartbeatAt" = NULL, "leaseExpiresAt" = NULL
                WHERE id = $1 AND status = 'RUNNING'
                  AND "workerId" = $4 AND attempt = $5
                  AND "leaseExpiresAt" >= $3
                RETURNING id
                """,
                job_id,
                error_msg[:1000],
                _utcnow_naive(),
                token.worker_id,
                token.attempt,
            )
            if row is None:
                raise JobLeaseLostError("job failure rejected by lease fence")
        else:
            await conn.execute(
                """
                UPDATE "Job"
                SET status = 'FAILED', "errorMsg" = $2, "finishedAt" = $3
                WHERE id = $1
                """,
                job_id,
                error_msg[:1000],
                _utcnow_naive(),
            )


async def fail_knowledge_deletion(
    job_id: str,
    user_id: str,
    target_type: str | None,
    target_id: str | None,
    error_msg: str,
) -> None:
    """Fail a deletion under its job lease and release saved media from DELETING."""
    token = _job_token(job_id)
    if token is None:
        raise JobLeaseLostError("knowledge deletion failure has no active lease")
    now = _utcnow_naive()
    async with connection() as conn, conn.transaction():
        row = await conn.fetchrow(
            """
            UPDATE "Job"
            SET status = 'FAILED', "errorMsg" = $2, "finishedAt" = $3,
                "heartbeatAt" = NULL, "leaseExpiresAt" = NULL
            WHERE id = $1 AND "userId" = $4 AND type = 'DELETE_KNOWLEDGE'::"JobType"
              AND status = 'RUNNING' AND "workerId" = $5 AND attempt = $6
              AND "leaseExpiresAt" >= $3
            RETURNING id
            """,
            job_id,
            error_msg[:1000],
            now,
            user_id,
            token.worker_id,
            token.attempt,
        )
        if row is None:
            raise JobLeaseLostError("knowledge deletion failure rejected by lease fence")
        if target_type == "SAVED_MEDIA" and target_id:
            await conn.execute(
                """
                UPDATE "SavedMedia"
                SET status = 'FAILED'::"SavedMediaStatus", "errorMsg" = $3,
                    "updatedAt" = $4
                WHERE id = $1 AND "userId" = $2 AND "transcriptId" IS NULL
                  AND status = 'DELETING'::"SavedMediaStatus"
                """,
                target_id,
                user_id,
                error_msg[:1000],
                now,
            )


async def mark_source_refresh_failed(user_id: str, transcript_id: str, error_msg: str) -> None:
    """Falha de refresh não pode apagar a versão de fonte que já era utilizável."""
    async with connection() as conn:
        await conn.execute(
            """
            UPDATE "Transcript"
            SET "sourceRefreshStatus" = 'FAILED'::"SourceRefreshStatus",
                "sourceRefreshError" = $3,
                "updatedAt" = NOW()
            WHERE id = $1 AND "userId" = $2
            """,
            transcript_id,
            user_id,
            error_msg[:1000],
        )


async def clear_source_refresh_check(user_id: str, transcript_id: str) -> None:
    """Cancelamento encerra a consulta, mas preserva a última versão atual."""
    async with connection() as conn:
        await conn.execute(
            """
            UPDATE "Transcript"
            SET "sourceRefreshStatus" = 'CURRENT'::"SourceRefreshStatus",
                "sourceRefreshError" = NULL,
                "updatedAt" = NOW()
            WHERE id = $1 AND "userId" = $2
            """,
            transcript_id,
            user_id,
        )


async def insert_cost_event(
    *,
    user_id: str,
    kind: str,
    model: str,
    tokens_in: int = 0,
    tokens_out: int = 0,
    cost_usd: Decimal,
    job_id: str | None = None,
    meta: dict[str, Any] | None = None,
) -> None:
    async with connection() as conn:
        await conn.execute(
            """
            INSERT INTO "CostEvent" (
                id, "userId", ts, kind, model, "tokensIn", "tokensOut",
                "costUsd", "jobId", meta
            ) VALUES (
                $1, $2, NOW(), $3::"CostEventKind", $4, $5, $6, $7, $8, $9::jsonb
            )
            """,
            generate_cuid(),
            user_id,
            kind,
            model,
            tokens_in,
            tokens_out,
            cost_usd,
            job_id,
            json.dumps(meta or {}, default=str),
        )


def generate_cuid() -> str:
    """Gera um id estilo cuid (25 chars, começa com 'c').
    Prisma client TS é o gerador canônico; aqui no Python só precisamos
    de ids únicos com mesma cara — Postgres é a fonte da verdade.
    """
    import secrets
    import time

    ts_part = format(int(time.time() * 1000), "x")[-8:]
    rand_part = secrets.token_hex(8)
    return f"c{ts_part}{rand_part}"


def _truncate(value: str | None, limit: int) -> str | None:
    normalized = " ".join((value or "").split())
    if not normalized:
        return None
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 3] + "..."


def truncate_text(value: str | None, limit: int) -> str | None:
    """Bound diagnostic text before persisting it."""
    return _truncate(value, limit)


from . import tag_enrichment_db as _tag_enrichment_db  # noqa: E402

start_tag_enrichment = _tag_enrichment_db.start_tag_enrichment
claim_pending_tag_enrichments = _tag_enrichment_db.claim_pending_tag_enrichments
finish_tag_enrichment = _tag_enrichment_db.finish_tag_enrichment
get_transcript_title_summary_folder = _tag_enrichment_db.get_transcript_title_summary_folder
