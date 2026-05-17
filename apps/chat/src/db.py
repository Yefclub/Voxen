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
                   model, source::text AS source, "thumbnailUrl"
            FROM "Transcript"
            WHERE id = $1 AND "userId" = $2
            """,
            transcript_id, user_id,
        )
        return dict(row) if row else None


def _utcnow_naive() -> Any:
    from datetime import UTC, datetime

    return datetime.now(UTC).replace(tzinfo=None)


async def insert_cost_event(
    *,
    user_id: str,
    model: str,
    tokens_in: int,
    tokens_out: int,
    cost_usd: Decimal,
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
                $1, $2, $3, 'CHAT'::"CostEventKind", $4, $5, $6, $7, $8::jsonb
            )
            """,
            new_id, user_id, _utcnow_naive(), model, tokens_in, tokens_out, cost_usd,
            json.dumps(meta or {}, default=str),
        )
