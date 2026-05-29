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
    user_id: str, query: str, limit: int = 10
) -> list[dict[str, Any]]:
    async with connection() as conn:
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
              AND status = 'ACTIVE'::"ContentStatus"
            """,
            transcript_id,
            user_id,
        )
        return dict(row) if row else None


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
) -> dict[str, Any]:
    new_id = _generate_note_id()
    async with connection() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                INSERT INTO "Note" (
                    id, "userId", "parentId", kind, title, content,
                    "createdAt", "updatedAt"
                )
                VALUES ($1, $2, $3, $4::"NoteKind", $5, $6, $7, $7)
                RETURNING id, "parentId", kind::text AS kind, title, content, "updatedAt"
                """,
                new_id,
                user_id,
                parent_id,
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
                RETURNING id, "parentId", kind::text AS kind, title, content, "updatedAt"
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
