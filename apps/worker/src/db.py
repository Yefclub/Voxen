"""Postgres pool + queries do worker (asyncpg cru)."""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import asyncpg

_pool: asyncpg.Pool | None = None


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
        return new_id


async def link_job_done(job_id: str, transcript_id: str) -> None:
    async with connection() as conn:
        await conn.execute(
            """
            UPDATE "Job"
            SET status = 'DONE', "transcriptId" = $2, "finishedAt" = $3
            WHERE id = $1
            """,
            job_id,
            transcript_id,
            _utcnow_naive(),
        )


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
