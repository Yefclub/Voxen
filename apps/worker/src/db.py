"""Postgres pool + queries do worker (asyncpg cru)."""

from __future__ import annotations

import json
import os
import re
import unicodedata
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import asyncpg
import structlog

from .graph_index_lease import GraphIndexLease, acquire_graph_index_lease

log = structlog.get_logger(__name__)

_pool: asyncpg.Pool | None = None

TOPIC_LIMIT = 8
TOPIC_MIN_LEN = 4
BRAIN_TOPIC_INDEX_VERSION = 1
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


async def claim_job(job_id: str) -> dict[str, Any] | None:
    """Tenta marcar Job como RUNNING. SKIP LOCKED evita race com outros workers.

    Retorna o job se conseguiu claim, None se outro worker já pegou ou se está
    em estado terminal.
    """
    async with connection() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                SELECT id, "userId", "sourceUrl", status, type
                FROM "Job"
                WHERE id = $1 AND status = 'QUEUED'
                FOR UPDATE SKIP LOCKED
                """,
                job_id,
            )
            if not row:
                return None
            await conn.execute(
                """
                UPDATE "Job"
                SET status = 'RUNNING', "startedAt" = $2
                WHERE id = $1
                """,
                job_id,
                _utcnow_naive(),
            )
            return dict(row)


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
    async with connection() as conn:
        async with conn.transaction():
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
            WHERE status = 'QUEUED'
            ORDER BY "queuedAt" ASC
            LIMIT $1
            """,
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
                language=language,
                transcription_method=transcription_method,
                thumbnail_url=thumbnail_url,
                plain_text=plain_text,
            )
        return new_id


async def link_job_transcript(job_id: str, transcript_id: str) -> None:
    async with connection() as conn:
        await conn.execute(
            """
            UPDATE "Job"
            SET "transcriptId" = $2
            WHERE id = $1
            """,
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
                    SELECT source, url, title, channel, language, "transcriptionMethod",
                           "thumbnailUrl", "plainText", "summaryMd", status
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
                    language=row["language"],
                    transcription_method=row["transcriptionMethod"],
                    thumbnail_url=row["thumbnailUrl"],
                    plain_text=row["summaryMd"] or row["plainText"],
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
            OR be.method IN ('keyword', 'llm-grounded')
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
          AND be.method IN ('keyword', 'llm-grounded')
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
              AND method IN ('keyword', 'llm-grounded')
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


async def upsert_grounded_brain_items(
    *,
    user_id: str,
    transcript_id: str,
    items: list[dict[str, Any]],
) -> int:
    """Materializa entidades/claims grounded (method=llm-grounded). Best-effort."""
    if not items:
        return 0
    lease = await acquire_graph_index_lease(user_id)
    if lease is None:
        return 0
    created = 0
    try:
        async with lease.heartbeat():
            async with connection() as conn:
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
                content_node_id = str(content["id"])
                for item in items:
                    if not lease.locally_owned():
                        return created
                    kind = str(item.get("kind") or "entity")
                    label = str(item.get("label") or "").strip()
                    excerpt = str(item.get("excerpt") or "").strip()
                    conf = float(item.get("confidence") or 0.7)
                    slug = str(item.get("slug") or "")
                    if not label or not excerpt or not slug:
                        continue
                    node_type = "CLAIM" if kind == "claim" else "ENTITY"
                    key_prefix = "CLAIM" if kind == "claim" else "ENTITY"
                    concept_id = await _upsert_grounded_concept_node(
                        conn,
                        user_id=user_id,
                        key=f"{key_prefix}:{slug}",
                        node_type=node_type,
                        label=label,
                    )
                    if not lease.locally_owned():
                        return created
                    edge_row = await conn.fetchrow(
                        """
                        INSERT INTO "BrainEdge" (
                            id, "userId", "fromNodeId", "toNodeId", kind, confidence,
                            method, status, metadata, "createdAt", "updatedAt"
                        ) VALUES (
                            $1, $2, $3, $4, 'MENTIONS'::"BrainEdgeKind", $5,
                            'llm-grounded', 'ACTIVE'::"ContentStatus", $6::jsonb, NOW(), NOW()
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
                        conf,
                        json.dumps(
                            {
                                "term": slug,
                                "kind": kind,
                                "extractor": "openrouter-grounded",
                            }
                        ),
                    )
                    if not edge_row:
                        continue
                    if not lease.locally_owned():
                        return created
                    try:
                        await conn.execute(
                            """
                            INSERT INTO "BrainSource" (
                                id, "userId", "edgeId", "sourceType", "sourceId",
                                excerpt, "createdAt"
                            ) VALUES (
                                $1, $2, $3, 'TRANSCRIPT'::"BrainSourceType", $4, $5, NOW()
                            )
                            """,
                            generate_cuid(),
                            user_id,
                            edge_row["id"],
                            transcript_id,
                            _truncate(excerpt, 600),
                        )
                        created += 1
                    except Exception:  # noqa: BLE001
                        log.warning(
                            "brain-grounded-source-skipped",
                            transcript_id=transcript_id,
                            edge_id=edge_row["id"],
                        )
    finally:
        await lease.release()
    return created


async def _upsert_grounded_concept_node(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    key: str,
    node_type: str,
    label: str,
) -> str:
    row = await conn.fetchrow(
        """
        INSERT INTO "BrainNode" (
            id, "userId", key, type, label, description, status, metadata,
            "sourceType", "sourceId", "createdAt", "updatedAt"
        ) VALUES (
            $1, $2, $3, $4::"BrainNodeType", $5, $6, 'ACTIVE'::"ContentStatus",
            $7::jsonb, NULL, NULL, NOW(), NOW()
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
        key,
        node_type,
        label,
        "Conceito extraído com grounding (trecho literal no conteúdo).",
        json.dumps({"method": "llm-grounded"}),
    )
    return str(row["id"])


async def store_content_embedding(
    *,
    user_id: str,
    transcript_id: str,
    model: str,
    vector: list[float],
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
                    """,
                    user_id,
                    f"TRANSCRIPT:{transcript_id}",
                    json.dumps(payload),
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


async def list_transcript_tag_names(transcript_id: str) -> list[str]:
    async with connection() as conn:
        rows = await conn.fetch(
            """
            SELECT t.name
            FROM "TranscriptTag" tt
            JOIN "Tag" t ON t.id = tt."tagId"
            WHERE tt."transcriptId" = $1
            ORDER BY tt."createdAt" ASC
            """,
            transcript_id,
        )
    return [str(row["name"]) for row in rows if row["name"]]


async def get_transcript_title_summary_folder(
    transcript_id: str,
) -> tuple[str, str, str | None] | None:
    """title, content (summaryMd or plainText), folderId — para auto-tags."""
    async with connection() as conn:
        row = await conn.fetchrow(
            """
            SELECT title, "plainText", "summaryMd", "folderId"
            FROM "Transcript"
            WHERE id = $1
            """,
            transcript_id,
        )
    if not row:
        return None
    title = str(row["title"] or "")
    summary = (row["summaryMd"] or "").strip()
    plain = (row["plainText"] or "").strip()
    content = summary or plain
    folder_id = row["folderId"]
    return title, content, (str(folder_id) if folder_id else None)


async def apply_tags_to_transcript(
    *,
    user_id: str,
    transcript_id: str,
    tag_names: list[str],
    current_folder_id: str | None,
) -> list[str]:
    """
    Cria/reutiliza Tag + pasta, liga TranscriptTag, seta folderId só se vazio
    (R-FOLDER, spec 075). Retorna nomes aplicados.
    """
    from .tags import pick_folder_id, slugify_tag

    applied: list[str] = []
    first_folder_id: str | None = None

    async with connection() as conn:
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
                        WHERE id = $1
                        """,
                        tag_id,
                        folder_id,
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

            await conn.execute(
                """
                INSERT INTO "TranscriptTag" ("transcriptId", "tagId", "createdAt")
                VALUES ($1, $2, NOW())
                ON CONFLICT ("transcriptId", "tagId") DO NOTHING
                """,
                transcript_id,
                tag_id,
            )
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
    async with connection() as conn:
        await conn.execute(
            """
            UPDATE "Job"
            SET status = 'DONE', "finishedAt" = $2
            WHERE id = $1
            """,
            job_id,
            _utcnow_naive(),
        )


async def link_job_done(job_id: str, transcript_id: str) -> None:
    await link_job_transcript(job_id, transcript_id)
    await mark_job_done(job_id)


async def mark_job_failed(job_id: str, error_msg: str) -> None:
    async with connection() as conn:
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
