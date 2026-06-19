"""Postgres pool + queries (asyncpg cru) — escopadas por userId."""

from __future__ import annotations

import json
import os
import secrets
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from decimal import Decimal
from typing import Any

import asyncpg

_pool: asyncpg.Pool | None = None


def database_url() -> str:
    v = os.environ.get("DATABASE_URL")
    if not v:
        raise RuntimeError("DATABASE_URL não definido")
    return v


async def get_pool() -> asyncpg.Pool:
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


async def get_setting_enc(key: str) -> str | None:
    async with connection() as conn:
        row = await conn.fetchrow(
            'SELECT "valueEnc" FROM "Setting" '
            "WHERE scope = 'GLOBAL' AND \"userId\" IS NULL AND key = $1",
            key,
        )
        return row["valueEnc"] if row else None


async def list_user_transcripts(
    user_id: str, limit: int = 30, source: str | None = None
) -> list[dict[str, Any]]:
    async with connection() as conn:
        if source:
            rows = await conn.fetch(
                """
                SELECT id, title, channel, "durationSec", source::text AS source, "createdAt"
                FROM "Transcript"
                WHERE "userId" = $1
                  AND status = 'ACTIVE'::"ContentStatus"
                  AND source = $2::"TranscriptSource"
                ORDER BY "createdAt" DESC LIMIT $3
                """,
                user_id,
                source,
                limit,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT id, title, channel, "durationSec", source::text AS source, "createdAt"
                FROM "Transcript"
                WHERE "userId" = $1
                  AND status = 'ACTIVE'::"ContentStatus"
                ORDER BY "createdAt" DESC LIMIT $2
                """,
                user_id,
                limit,
            )
        return [dict(r) for r in rows]


async def search_user_transcripts(
    user_id: str, query: str, limit: int = 10, tsquery_expr: str | None = None
) -> list[dict[str, Any]]:
    """FTS escopado por userId.

    `tsquery_expr` (spec 047): quando informado e não vazio, é uma expressão
    `tsquery` já expandida (OR + prefix + sinônimos, sanitizada pelo chamador)
    usada no MATCH e no ranking via `to_tsquery`, ampliando o recall. Quando
    vazio/None, cai pro `plainto_tsquery` da query crua (comportamento legado).
    O `ts_headline` SEMPRE usa a query crua pra destacar as palavras do usuário.
    O escopo por `userId` é inviolável em ambos os caminhos.
    """
    expr = (tsquery_expr or "").strip()
    async with connection() as conn:
        if expr:
            rows = await conn.fetch(
                """
                SELECT
                  id, title,
                  ts_headline(
                    'portuguese', "plainText",
                    plainto_tsquery('portuguese', $2),
                    'StartSel=«, StopSel=», MaxWords=30, MinWords=10, MaxFragments=1'
                  ) AS snippet,
                  ts_rank("searchVector", to_tsquery('portuguese', $3)) AS rank
                FROM "Transcript"
                WHERE "userId" = $1
                  AND status = 'ACTIVE'::"ContentStatus"
                  AND "searchVector" @@ to_tsquery('portuguese', $3)
                ORDER BY rank DESC, "createdAt" DESC
                LIMIT $4
                """,
                user_id,
                query,
                expr,
                limit,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT
                  id, title,
                  ts_headline(
                    'portuguese', "plainText",
                    plainto_tsquery('portuguese', $2),
                    'StartSel=«, StopSel=», MaxWords=30, MinWords=10, MaxFragments=1'
                  ) AS snippet,
                  ts_rank("searchVector", plainto_tsquery('portuguese', $2)) AS rank
                FROM "Transcript"
                WHERE "userId" = $1
                  AND status = 'ACTIVE'::"ContentStatus"
                  AND "searchVector" @@ plainto_tsquery('portuguese', $2)
                ORDER BY rank DESC, "createdAt" DESC
                LIMIT $3
                """,
                user_id,
                query,
                limit,
            )
        return [dict(r) for r in rows]


async def get_user_transcript(user_id: str, transcript_id: str) -> dict[str, Any] | None:
    async with connection() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, title, channel, url, "mdPath", "plainText", frontmatter,
                   "durationSec", language, "transcriptionMethod"::text AS "transcriptionMethod",
                   model, source::text AS source, "thumbnailUrl", "summaryMd"
            FROM "Transcript"
            WHERE id = $1
              AND "userId" = $2
              AND status <> 'TRASH'::"ContentStatus"
            """,
            transcript_id,
            user_id,
        )
        return dict(row) if row else None


async def get_user_job(user_id: str, job_id: str) -> dict[str, Any] | None:
    async with connection() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, status::text AS status, "sourceUrl", "transcriptId", "errorMsg",
                   "queuedAt", "startedAt", "finishedAt"
            FROM "Job"
            WHERE id = $1 AND "userId" = $2
            """,
            job_id,
            user_id,
        )
    return dict(row) if row else None


async def brain_search(
    user_id: str, query: str, limit: int = 8, include_archived: bool = False
) -> list[dict[str, Any]]:
    pattern = f"%{query}%"
    async with connection() as conn:
        rows = await conn.fetch(
            """
            SELECT id, key, type::text AS type, label, description,
                   status::text AS status, "sourceType"::text AS "sourceType",
                   "sourceId", metadata, "updatedAt"
            FROM "BrainNode"
            WHERE "userId" = $1
              AND ($4::boolean OR status = 'ACTIVE'::"ContentStatus")
              AND (label ILIKE $2 OR coalesce(description, '') ILIKE $2 OR key ILIKE $2)
            ORDER BY
              CASE WHEN label ILIKE $3 THEN 0 ELSE 1 END,
              "updatedAt" DESC
            LIMIT $5
            """,
            user_id,
            pattern,
            f"{query}%",
            include_archived,
            limit,
        )
    return [dict(r) for r in rows]


async def brain_get_node(user_id: str, node_ref: str) -> dict[str, Any] | None:
    async with connection() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, key, type::text AS type, label, description,
                   status::text AS status, "sourceType"::text AS "sourceType",
                   "sourceId", metadata, "updatedAt"
            FROM "BrainNode"
            WHERE "userId" = $1 AND (id = $2 OR key = $2)
            """,
            user_id,
            node_ref,
        )
    return dict(row) if row else None


async def brain_neighbors(
    user_id: str, node_ref: str, limit: int = 30, include_archived: bool = False
) -> dict[str, Any] | None:
    node = await brain_get_node(user_id, node_ref)
    if not node:
        return None
    async with connection() as conn:
        rows = await conn.fetch(
            """
            SELECT
              e.id AS "edgeId",
              e.kind::text AS kind,
              e.method,
              e.confidence::text AS confidence,
              e.status::text AS "edgeStatus",
              e."fromNodeId",
              e."toNodeId",
              n.id, n.key, n.type::text AS type, n.label, n.description,
              n.status::text AS status, n."sourceType"::text AS "sourceType",
              n."sourceId", n.metadata
            FROM "BrainEdge" e
            JOIN "BrainNode" n
              ON n.id = CASE WHEN e."fromNodeId" = $2 THEN e."toNodeId" ELSE e."fromNodeId" END
            WHERE e."userId" = $1
              AND (e."fromNodeId" = $2 OR e."toNodeId" = $2)
              AND (
                $3::boolean
                OR (
                  e.status = 'ACTIVE'::"ContentStatus"
                  AND n.status = 'ACTIVE'::"ContentStatus"
                )
              )
            ORDER BY e."updatedAt" DESC
            LIMIT $4
            """,
            user_id,
            node["id"],
            include_archived,
            limit,
        )
    return {"node": node, "neighbors": [dict(r) for r in rows]}


async def brain_sources(
    user_id: str, node_or_edge_ref: str, limit: int = 20
) -> list[dict[str, Any]]:
    async with connection() as conn:
        rows = await conn.fetch(
            """
            SELECT s.id, s."nodeId", s."edgeId", s."sourceType"::text AS "sourceType",
                   s."sourceId", s."chunkId", s."startSec", s."endSec", s.excerpt,
                   n.key AS "nodeKey", n.label AS "nodeLabel",
                   e.kind::text AS "edgeKind", e.method AS "edgeMethod"
            FROM "BrainSource" s
            LEFT JOIN "BrainNode" n ON n.id = s."nodeId"
            LEFT JOIN "BrainEdge" e ON e.id = s."edgeId"
            WHERE s."userId" = $1
              AND (
                s."nodeId" = $2 OR s."edgeId" = $2 OR
                n.key = $2 OR s."sourceId" = $2
              )
            ORDER BY s."createdAt" DESC
            LIMIT $3
            """,
            user_id,
            node_or_edge_ref,
            limit,
        )
    return [dict(r) for r in rows]


async def brain_path(user_id: str, from_ref: str, to_ref: str) -> list[dict[str, Any]]:
    async with connection() as conn:
        rows = await conn.fetch(
            """
            WITH endpoints AS (
              SELECT
                (SELECT id FROM "BrainNode"
                 WHERE "userId" = $1 AND status = 'ACTIVE'::"ContentStatus"
                   AND (id = $2 OR key = $2)
                 LIMIT 1) AS from_id,
                (SELECT id FROM "BrainNode"
                 WHERE "userId" = $1 AND status = 'ACTIVE'::"ContentStatus"
                   AND (id = $3 OR key = $3)
                 LIMIT 1) AS to_id
            ),
            active_edges AS (
              SELECT e.*
              FROM "BrainEdge" e
              JOIN "BrainNode" f ON f.id = e."fromNodeId"
              JOIN "BrainNode" t ON t.id = e."toNodeId"
              WHERE e."userId" = $1
                AND e.status = 'ACTIVE'::"ContentStatus"
                AND f.status = 'ACTIVE'::"ContentStatus"
                AND t.status = 'ACTIVE'::"ContentStatus"
            ),
            direct AS (
              SELECT e.id, e.kind::text AS kind, e.method, e."fromNodeId", e."toNodeId",
                     NULL::text AS "viaNodeId", NULL::text AS "viaLabel", 1 AS depth
              FROM active_edges e, endpoints ep
              WHERE ep.from_id IS NOT NULL
                AND ep.to_id IS NOT NULL
                AND ((e."fromNodeId" = ep.from_id AND e."toNodeId" = ep.to_id)
                  OR (e."fromNodeId" = ep.to_id AND e."toNodeId" = ep.from_id))
            ),
            two_hop AS (
              SELECT e1.id || ':' || e2.id AS id,
                     e1.kind::text || ' -> ' || e2.kind::text AS kind,
                     e1.method || ' -> ' || e2.method AS method,
                     e1."fromNodeId",
                     e2."toNodeId",
                     via.id AS "viaNodeId",
                     via.label AS "viaLabel",
                     2 AS depth
              FROM active_edges e1
              JOIN active_edges e2 ON e1.id <> e2.id
              JOIN endpoints ep ON TRUE
              JOIN "BrainNode" via
                ON via.id = CASE
                  WHEN e1."fromNodeId" = ep.from_id THEN e1."toNodeId"
                  ELSE e1."fromNodeId"
                END
              WHERE ep.from_id IS NOT NULL
                AND ep.to_id IS NOT NULL
                AND (e1."fromNodeId" = ep.from_id OR e1."toNodeId" = ep.from_id)
                AND (e2."fromNodeId" = ep.to_id OR e2."toNodeId" = ep.to_id)
                AND via.id = CASE
                  WHEN e2."fromNodeId" = ep.to_id THEN e2."toNodeId"
                  ELSE e2."fromNodeId"
                END
              LIMIT 5
            )
            SELECT * FROM direct
            UNION ALL
            SELECT * FROM two_hop
            ORDER BY depth ASC
            LIMIT 10
            """,
            user_id,
            from_ref,
            to_ref,
        )
    return [dict(r) for r in rows]


def _utcnow_naive() -> Any:
    from datetime import UTC, datetime

    return datetime.now(UTC).replace(tzinfo=None)


async def create_scrape_job(user_id: str, source_url: str) -> dict[str, Any]:
    """Cria Job SCRAPE_WEB QUEUED. Dedup igual ao transcribe."""
    return await _create_job(user_id, source_url, "SCRAPE_WEB")


async def create_transcribe_job(user_id: str, source_url: str) -> dict[str, Any]:
    """Cria Job DOWNLOAD_AND_TRANSCRIBE QUEUED. Dedup contra transcript e job ativo."""
    return await _create_job(user_id, source_url, "DOWNLOAD_AND_TRANSCRIBE")


async def create_x_analysis_job(user_id: str, source_url: str) -> dict[str, Any]:
    """Cria Job ANALYZE_X QUEUED para análise via Grok/OpenRouter search."""
    return await _create_job(user_id, source_url, "ANALYZE_X")


async def create_upload_job(user_id: str, source_url: str, job_type: str) -> dict[str, Any]:
    """Cria Job de upload QUEUED para o worker processar."""
    return await _create_job(user_id, source_url, job_type)


async def _create_job(user_id: str, source_url: str, job_type: str) -> dict[str, Any]:
    """Cria Job QUEUED pra worker processar.

    Retorna: { id, status, sourceUrl, duplicate?: 'transcript'|'job', transcript_id? }
    """
    import secrets
    import time

    async with connection() as conn:
        existing_t = await conn.fetchrow(
            """
            SELECT id FROM "Transcript"
            WHERE "userId" = $1
              AND url = $2
              AND status <> 'TRASH'::"ContentStatus"
            """,
            user_id,
            source_url,
        )
        if existing_t:
            return {"duplicate": "transcript", "transcript_id": existing_t["id"]}

        existing_j = await conn.fetchrow(
            'SELECT id, status::text AS status FROM "Job" '
            "WHERE \"userId\" = $1 AND \"sourceUrl\" = $2 AND status IN ('QUEUED', 'RUNNING')",
            user_id,
            source_url,
        )
        if existing_j:
            return {
                "duplicate": "job",
                "id": existing_j["id"],
                "status": existing_j["status"],
                "sourceUrl": source_url,
            }

        new_id = f"c{format(int(time.time() * 1000), 'x')[-8:]}{secrets.token_hex(8)}"
        await conn.execute(
            """
            INSERT INTO "Job" (
                id, "userId", type, status, "sourceUrl", "queuedAt"
            ) VALUES (
                $1, $2, $3::"JobType",
                'QUEUED'::"JobStatus", $4, $5
            )
            """,
            new_id,
            user_id,
            job_type,
            source_url,
            _utcnow_naive(),
        )
        return {"id": new_id, "status": "QUEUED", "sourceUrl": source_url}


# ============================================================================
# Notes — KB manual (NOTE/FOLDER em árvore)
# ============================================================================


async def list_user_notes(
    user_id: str, limit: int = 50, kind: str | None = None
) -> list[dict[str, Any]]:
    async with connection() as conn:
        if kind:
            rows = await conn.fetch(
                """
                SELECT id, "parentId", kind::text AS kind, title, "createdAt", "updatedAt"
                FROM "Note"
                WHERE "userId" = $1 AND kind = $2::"NoteKind"
                ORDER BY "updatedAt" DESC
                LIMIT $3
                """,
                user_id,
                kind,
                limit,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT id, "parentId", kind::text AS kind, title, "createdAt", "updatedAt"
                FROM "Note"
                WHERE "userId" = $1
                ORDER BY "updatedAt" DESC
                LIMIT $2
                """,
                user_id,
                limit,
            )
    return [dict(r) for r in rows]


async def search_user_notes(user_id: str, query: str, limit: int = 8) -> list[dict[str, Any]]:
    """FTS sobre title+content. Retorna trechos com headline."""
    async with connection() as conn:
        rows = await conn.fetch(
            """
            SELECT
              id, title, "parentId",
              ts_headline(
                'portuguese',
                coalesce(content, ''),
                plainto_tsquery('portuguese', $2),
                'StartSel=«, StopSel=», MaxWords=22, MinWords=8, MaxFragments=1'
              ) AS snippet,
              ts_rank("searchVector", plainto_tsquery('portuguese', $2)) AS rank
            FROM "Note"
            WHERE "userId" = $1
              AND kind = 'NOTE'
              AND "searchVector" @@ plainto_tsquery('portuguese', $2)
            ORDER BY rank DESC, "updatedAt" DESC
            LIMIT $3
            """,
            user_id,
            query,
            limit,
        )
    return [dict(r) for r in rows]


async def get_user_note(user_id: str, note_id: str) -> dict[str, Any] | None:
    async with connection() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, "parentId", kind::text AS kind, title, content, "createdAt", "updatedAt"
            FROM "Note"
            WHERE id = $1 AND "userId" = $2
            """,
            note_id,
            user_id,
        )
    return dict(row) if row else None


async def create_user_note(
    user_id: str,
    *,
    title: str,
    content: str = "",
    parent_id: str | None = None,
    kind: str = "NOTE",
    source_type: str | None = None,
    source_id: str | None = None,
) -> dict[str, Any]:
    new_id = _generate_note_id()
    async with connection() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                INSERT INTO "Note" (
                    id, "userId", "parentId", "sourceType", "sourceId", kind, title, content,
                    "createdAt", "updatedAt"
                )
                VALUES ($1, $2, $3, $4::"BrainSourceType", $5, $6::"NoteKind", $7, $8, $9, $9)
                RETURNING id, "parentId", "sourceType"::text AS "sourceType",
                          "sourceId", kind::text AS kind, title, content, "updatedAt"
                """,
                new_id,
                user_id,
                parent_id,
                source_type,
                source_id,
                kind,
                title,
                content,
                _utcnow_naive(),
            )
            if row:
                await upsert_note_brain_node(conn, user_id=user_id, note=dict(row))
    return dict(row) if row else {"id": new_id}


async def update_user_note(
    user_id: str, note_id: str, *, title: str | None = None, content: str | None = None
) -> dict[str, Any] | None:
    async with connection() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                UPDATE "Note"
                SET title = COALESCE($3, title),
                    content = COALESCE($4, content),
                    "updatedAt" = NOW()
                WHERE id = $1 AND "userId" = $2
                RETURNING id, "parentId", "sourceType"::text AS "sourceType",
                          "sourceId", kind::text AS kind, title, content, "updatedAt"
                """,
                note_id,
                user_id,
                title,
                content,
            )
            if row:
                await upsert_note_brain_node(conn, user_id=user_id, note=dict(row))
    return dict(row) if row else None


async def delete_user_note(user_id: str, note_id: str) -> bool:
    async with connection() as conn:
        async with conn.transaction():
            result = await conn.execute(
                'DELETE FROM "Note" WHERE id = $1 AND "userId" = $2',
                note_id,
                user_id,
            )
            await delete_note_brain_node(conn, user_id=user_id, note_id=note_id)
    # asyncpg retorna "DELETE N" — parse pra inteiro
    try:
        n = int(result.split()[-1])
    except (ValueError, IndexError):
        n = 0
    return n > 0


async def upsert_note_brain_node(
    conn: asyncpg.Connection, *, user_id: str, note: dict[str, Any]
) -> None:
    await conn.execute(
        """
        DELETE FROM "BrainSource"
        WHERE "userId" = $1
          AND "sourceType" = 'NOTE'::"BrainSourceType"
          AND "sourceId" = $2
          AND "nodeId" IS NOT NULL
        """,
        user_id,
        note["id"],
    )
    node_type = "FOLDER" if note.get("kind") == "FOLDER" else "CONTENT"
    node_id = _generate_cuid()
    key = f"NOTE:{note['id']}"
    updated_at = note.get("updatedAt")
    metadata = {
        "kind": note.get("kind"),
        "parentId": note.get("parentId"),
        "linkedSourceType": note.get("sourceType"),
        "linkedSourceId": note.get("sourceId"),
        "updatedAt": updated_at.isoformat() if updated_at is not None else None,
    }
    row = await conn.fetchrow(
        """
        INSERT INTO "BrainNode" (
            id, "userId", key, type, label, description, status, metadata,
            "sourceType", "sourceId", "createdAt", "updatedAt"
        ) VALUES (
            $1, $2, $3, $4::"BrainNodeType", $5, $6, 'ACTIVE'::"ContentStatus",
            $7::jsonb, 'NOTE'::"BrainSourceType", $8, NOW(), NOW()
        )
        ON CONFLICT ("userId", key) DO UPDATE SET
            type = EXCLUDED.type,
            label = EXCLUDED.label,
            description = EXCLUDED.description,
            status = EXCLUDED.status,
            metadata = EXCLUDED.metadata,
            "sourceType" = EXCLUDED."sourceType",
            "sourceId" = EXCLUDED."sourceId",
            "updatedAt" = NOW()
        RETURNING id
        """,
        node_id,
        user_id,
        key,
        node_type,
        note["title"],
        _truncate(note.get("content") if note.get("kind") == "NOTE" else None, 800),
        json.dumps(metadata, default=str),
        note["id"],
    )
    brain_node_id = row["id"] if row else node_id
    await conn.execute(
        """
        INSERT INTO "BrainSource" (
            id, "userId", "nodeId", "sourceType", "sourceId", excerpt, "createdAt"
        ) VALUES (
            $1, $2, $3, 'NOTE'::"BrainSourceType", $4, $5, NOW()
        )
        """,
        _generate_cuid(),
        user_id,
        brain_node_id,
        note["id"],
        _truncate(note["title"], 600),
    )


async def delete_note_brain_node(conn: asyncpg.Connection, *, user_id: str, note_id: str) -> None:
    await conn.execute(
        """
        DELETE FROM "BrainNode"
        WHERE "userId" = $1 AND "sourceType" = 'NOTE'::"BrainSourceType" AND "sourceId" = $2
        """,
        user_id,
        note_id,
    )
    await conn.execute(
        """
        DELETE FROM "BrainSource"
        WHERE "userId" = $1 AND "sourceType" = 'NOTE'::"BrainSourceType" AND "sourceId" = $2
        """,
        user_id,
        note_id,
    )


async def list_user_automation_runs(
    user_id: str,
    *,
    automation_id: str | None = None,
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Lista runs recentes de automação do user. Escopado por userId."""
    async with connection() as conn:
        if automation_id:
            rows = await conn.fetch(
                """
                SELECT r.id, r."automationId", r.status, r."startedAt",
                       r."finishedAt", r."outputMd", r."noteId", r."createdAt",
                       a.name AS automation_name
                FROM "AutomationRun" r
                JOIN "Automation" a ON a.id = r."automationId"
                WHERE r."userId" = $1 AND r."automationId" = $2
                ORDER BY r."createdAt" DESC
                LIMIT $3
                """,
                user_id,
                automation_id,
                limit,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT r.id, r."automationId", r.status, r."startedAt",
                       r."finishedAt", r."outputMd", r."noteId", r."createdAt",
                       a.name AS automation_name
                FROM "AutomationRun" r
                JOIN "Automation" a ON a.id = r."automationId"
                WHERE r."userId" = $1
                ORDER BY r."createdAt" DESC
                LIMIT $2
                """,
                user_id,
                limit,
            )
    return [dict(r) for r in rows]


async def insert_cost_event(
    *,
    user_id: str,
    model: str,
    tokens_in: int,
    tokens_out: int,
    cost_usd: Decimal,
    kind: str = "CHAT",
    meta: dict[str, Any] | None = None,
) -> None:
    new_id = _generate_cuid()
    async with connection() as conn:
        await conn.execute(
            """
            INSERT INTO "CostEvent" (
                id, "userId", ts, kind, model, "tokensIn", "tokensOut",
                "costUsd", meta
            ) VALUES (
                $1, $2, $3, $4::"CostEventKind", $5, $6, $7, $8, $9::jsonb
            )
            """,
            new_id,
            user_id,
            _utcnow_naive(),
            kind,
            model,
            tokens_in,
            tokens_out,
            cost_usd,
            json.dumps(meta or {}, default=str),
        )


def _generate_note_id() -> str:
    return f"n{format(int(time.time() * 1000), 'x')[-8:]}{secrets.token_hex(8)}"


def _generate_cuid() -> str:
    return f"c{format(int(time.time() * 1000), 'x')[-8:]}{secrets.token_hex(8)}"


def _truncate(value: str | None, limit: int) -> str | None:
    normalized = " ".join((value or "").split())
    if not normalized:
        return None
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 3] + "..."
