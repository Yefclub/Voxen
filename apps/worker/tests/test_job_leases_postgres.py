from __future__ import annotations

import asyncio
import os
import uuid
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest

from src import db

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="PostgreSQL integration test requires DATABASE_URL",
)


@pytest.fixture(autouse=True)
async def _reset_db_pool_between_event_loops() -> None:
    await db.close_pool()
    yield
    await db.close_pool()


async def test_multiworker_claim_and_expired_restart_recovery() -> None:
    assert os.environ.get("DATABASE_URL")
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    suffix = uuid.uuid4().hex
    user_id = f"lease-user-{suffix}"
    job_id = f"lease-job-{suffix}"
    now = datetime.now(UTC).replace(tzinfo=None)
    try:
        await conn.execute(
            """
            INSERT INTO "User" (id, email, name, status, role, "createdAt", "updatedAt")
            VALUES ($1, $2, 'Lease Test', 'APPROVED', 'USER', $3, $3)
            """,
            user_id,
            f"lease-{suffix}@example.test",
            now,
        )
        await conn.execute(
            """
            INSERT INTO "Job" (id, "userId", type, status, "sourceUrl", "queuedAt")
            VALUES ($1, $2, 'SCRAPE_WEB', 'QUEUED', 'https://example.test', $3)
            """,
            job_id,
            user_id,
            now,
        )

        claims = await asyncio.gather(
            db.claim_job(job_id, "worker-a"),
            db.claim_job(job_id, "worker-b"),
        )
        winners = [claim for claim in claims if claim is not None]
        assert len(winners) == 1
        assert winners[0]["attempt"] == 1

        await conn.execute(
            'UPDATE "Job" SET "leaseExpiresAt" = $2 WHERE id = $1',
            job_id,
            now - timedelta(seconds=1),
        )
        recovered = await asyncio.gather(
            db.recover_expired_jobs(),
            db.recover_expired_jobs(),
        )
        assert sum(len(batch) for batch in recovered) == 1

        retry = await db.claim_job(job_id, "worker-c")
        assert retry is not None
        assert retry["attempt"] == 2
        row = await conn.fetchrow(
            'SELECT status, "workerId", attempt FROM "Job" WHERE id = $1',
            job_id,
        )
        assert row is not None
        assert dict(row) == {"status": "RUNNING", "workerId": "worker-c", "attempt": 2}
    finally:
        await conn.execute('DELETE FROM "User" WHERE id = $1', user_id)
        await conn.close()


async def test_stale_summary_claim_cannot_overwrite_new_generation() -> None:
    assert os.environ.get("DATABASE_URL")
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    suffix = uuid.uuid4().hex
    user_id = f"summary-user-{suffix}"
    transcript_id = f"summary-transcript-{suffix}"
    now = datetime.now(UTC).replace(tzinfo=None)
    try:
        await conn.execute(
            """
            INSERT INTO "User" (id, email, name, status, role, "createdAt", "updatedAt")
            VALUES ($1, $2, 'Summary Fence Test', 'APPROVED', 'USER', $3, $3)
            """,
            user_id,
            f"summary-{suffix}@example.test",
            now,
        )
        await conn.execute(
            """
            INSERT INTO "Transcript" (
              id, "userId", source, url, title, "durationSec", language,
              "transcriptionMethod", "mdPath", "plainText", frontmatter,
              "summaryStatus", "summaryAttempts", "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, 'WEB', 'https://example.test', 'Summary', 0, 'pt',
              'SCRAPE', 'summary.md', 'body', '{}'::jsonb, 'RUNNING', 2, $3, $3
            )
            """,
            transcript_id,
            user_id,
            now,
        )

        assert not await db.complete_summary_enrichment(
            user_id,
            transcript_id,
            claim_attempt=1,
            summary_md="stale",
        )
        assert await db.complete_summary_enrichment(
            user_id,
            transcript_id,
            claim_attempt=2,
            summary_md="current",
        )
        row = await conn.fetchrow(
            'SELECT "summaryMd", "summaryStatus" FROM "Transcript" WHERE id = $1',
            transcript_id,
        )
        assert row is not None
        assert dict(row) == {"summaryMd": "current", "summaryStatus": "COMPLETE"}
    finally:
        await conn.execute('DELETE FROM "User" WHERE id = $1', user_id)
        await conn.close()
