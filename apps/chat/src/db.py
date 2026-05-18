"""Postgres pool + queries (asyncpg cru) — escopadas por userId."""

from __future__ import annotations

import os
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
                WHERE "userId" = $1 AND source = $2::"TranscriptSource"
                ORDER BY "createdAt" DESC LIMIT $3
                """,
                user_id, source, limit,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT id, title, channel, "durationSec", source::text AS source, "createdAt"
                FROM "Transcript"
                WHERE "userId" = $1
                ORDER BY "createdAt" DESC LIMIT $2
                """,
                user_id, limit,
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
              AND "searchVector" @@ plainto_tsquery('portuguese', $2)
            ORDER BY rank DESC, "createdAt" DESC
            LIMIT $3
            """,
            user_id, query, limit,
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
            WHERE id = $1 AND "userId" = $2
            """,
            transcript_id, user_id,
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


async def _create_job(user_id: str, source_url: str, job_type: str) -> dict[str, Any]:
    """Cria Job QUEUED pra worker processar.

    Retorna: { id, status, sourceUrl, duplicate?: 'transcript'|'job', transcript_id? }
    """
    import secrets
    import time

    async with connection() as conn:
        existing_t = await conn.fetchrow(
            'SELECT id FROM "Transcript" WHERE "userId" = $1 AND url = $2',
            user_id, source_url,
        )
        if existing_t:
            return {"duplicate": "transcript", "transcript_id": existing_t["id"]}

        existing_j = await conn.fetchrow(
            'SELECT id, status::text AS status FROM "Job" '
            'WHERE "userId" = $1 AND "sourceUrl" = $2 AND status IN (\'QUEUED\', \'RUNNING\')',
            user_id, source_url,
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
            new_id, user_id, job_type, source_url, _utcnow_naive(),
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
                user_id, kind, limit,
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
                user_id, limit,
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
            user_id, query, limit,
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
            note_id, user_id,
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
    import secrets
    import time

    new_id = f"n{format(int(time.time() * 1000), 'x')[-8:]}{secrets.token_hex(8)}"
    async with connection() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO "Note" (
                id, "userId", "parentId", kind, title, content,
                "createdAt", "updatedAt"
            )
            VALUES ($1, $2, $3, $4::"NoteKind", $5, $6, $7, $7)
            RETURNING id, "parentId", kind::text AS kind, title, "updatedAt"
            """,
            new_id, user_id, parent_id, kind, title, content, _utcnow_naive(),
        )
    return dict(row) if row else {"id": new_id}


async def update_user_note(
    user_id: str, note_id: str, *, title: str | None = None, content: str | None = None
) -> dict[str, Any] | None:
    async with connection() as conn:
        row = await conn.fetchrow(
            """
            UPDATE "Note"
            SET title = COALESCE($3, title),
                content = COALESCE($4, content),
                "updatedAt" = NOW()
            WHERE id = $1 AND "userId" = $2
            RETURNING id, title, "updatedAt"
            """,
            note_id, user_id, title, content,
        )
    return dict(row) if row else None


async def delete_user_note(user_id: str, note_id: str) -> bool:
    async with connection() as conn:
        result = await conn.execute(
            'DELETE FROM "Note" WHERE id = $1 AND "userId" = $2',
            note_id, user_id,
        )
    # asyncpg retorna "DELETE N" — parse pra inteiro
    try:
        n = int(result.split()[-1])
    except (ValueError, IndexError):
        n = 0
    return n > 0


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
    import json
    import secrets
    import time

    new_id = f"c{format(int(time.time() * 1000), 'x')[-8:]}{secrets.token_hex(8)}"
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
            new_id, user_id, _utcnow_naive(), kind, model, tokens_in, tokens_out, cost_usd,
            json.dumps(meta or {}, default=str),
        )
