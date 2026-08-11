from __future__ import annotations

import asyncio
import os
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock

import asyncpg
import pytest

from src import db, job_defer_db, knowledge_deletion, pipeline
from src.job_lease import JobLeaseLostError, JobLeaseToken, activate_job_lease
from src.pipeline_errors import DeferredJobError

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


async def test_deferred_job_is_not_claimable_before_its_queue_time(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert os.environ.get("DATABASE_URL")
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    suffix = uuid.uuid4().hex
    user_id = f"deferred-user-{suffix}"
    job_id = f"deferred-job-{suffix}"
    now = datetime.now(UTC).replace(tzinfo=None)
    try:
        await conn.execute(
            """
            INSERT INTO "User" (id, email, name, status, role, "createdAt", "updatedAt")
            VALUES ($1, $2, 'Deferred Test', 'APPROVED', 'USER', $3, $3)
            """,
            user_id,
            f"deferred-{suffix}@example.test",
            now,
        )
        await conn.execute(
            """
            INSERT INTO "Job" (
              id, "userId", type, status, "sourceUrl", "queuedAt",
              "deletionTargetType", "deletionTargetId", "deletionTargetTitle"
            ) VALUES ($1, $2, 'DELETE_KNOWLEDGE', 'QUEUED', $3, $4, 'NOTE', $5, 'Note')
            """,
            job_id,
            user_id,
            f"voxen://delete/note/{suffix}",
            now,
            f"note-{suffix}",
        )

        monkeypatch.setattr(pipeline, "is_cancelled", lambda _job_id: False)
        monkeypatch.setattr(
            knowledge_deletion,
            "run",
            AsyncMock(side_effect=DeferredJobError("graph busy", retry_after_seconds=30)),
        )
        publish = AsyncMock(return_value=None)
        monkeypatch.setattr(pipeline.events, "publish_recorded_job_event", publish)

        await pipeline.process_job(job_id, "worker-a")

        row = await conn.fetchrow(
            'SELECT status, "queuedAt", "workerId", "leaseExpiresAt" FROM "Job" WHERE id = $1',
            job_id,
        )
        assert row is not None
        assert row["status"] == "QUEUED"
        assert row["queuedAt"] >= now + timedelta(seconds=25)
        assert row["workerId"] is None
        assert row["leaseExpiresAt"] is None
        progress = await conn.fetch(
            'SELECT stage, percent, "userId" FROM "JobProgressEvent" '
            'WHERE "jobId" = $1 ORDER BY "createdAt", id',
            job_id,
        )
        assert [dict(event) for event in progress] == [
            {"stage": "running", "percent": 0, "userId": user_id},
            {"stage": "queued", "percent": 0, "userId": user_id},
        ]
        assert [call.args[2] for call in publish.await_args_list] == ["running", "queued"]
        stale_token = JobLeaseToken(job_id, "worker-a", 1)
        with activate_job_lease(stale_token), pytest.raises(JobLeaseLostError):
            await job_defer_db.defer_job_lease(job_id, user_id, delay_seconds=30)
        assert await db.claim_job(job_id, "worker-early") is None
        assert job_id not in await db.list_queued_job_ids()

        await conn.execute(
            'UPDATE "Job" SET "queuedAt" = $2 WHERE id = $1',
            job_id,
            now - timedelta(seconds=1),
        )
        retry = await db.claim_job(job_id, "worker-b")
        assert retry is not None
        assert retry["attempt"] == 2
    finally:
        await conn.execute('DELETE FROM "User" WHERE id = $1', user_id)
        await conn.close()


async def test_stale_summary_claim_cannot_overwrite_new_content_identity() -> None:
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
            correction_revision=0,
            source_version=0,
            source_checksum=None,
            summary_md="stale",
        )
        await conn.execute(
            'UPDATE "Transcript" SET "sourceVersion" = 1, "sourceChecksum" = $2 WHERE id = $1',
            transcript_id,
            "source-1",
        )
        assert not await db.complete_summary_enrichment(
            user_id,
            transcript_id,
            claim_attempt=2,
            correction_revision=0,
            source_version=0,
            source_checksum=None,
            summary_md="stale-source",
        )
        await conn.execute(
            'UPDATE "Transcript" SET "correctionRevision" = 1 WHERE id = $1',
            transcript_id,
        )
        assert not await db.complete_summary_enrichment(
            user_id,
            transcript_id,
            claim_attempt=2,
            correction_revision=0,
            source_version=1,
            source_checksum="source-1",
            summary_md="stale-revision",
        )
        assert await db.complete_summary_enrichment(
            user_id,
            transcript_id,
            claim_attempt=2,
            correction_revision=1,
            source_version=1,
            source_checksum="source-1",
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


async def test_migration_reapply_preserves_active_future_lease() -> None:
    assert os.environ.get("DATABASE_URL")
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    suffix = uuid.uuid4().hex
    user_id = f"migration-user-{suffix}"
    job_id = f"migration-job-{suffix}"
    now = datetime.now(UTC).replace(tzinfo=None)
    future_lease = now + timedelta(minutes=10)
    migration = (
        Path(__file__).parents[3]
        / "prisma/migrations/20260802210000_worker_job_leases/migration.sql"
    ).read_text()
    try:
        await conn.execute(
            """
            INSERT INTO "User" (id, email, name, status, role, "createdAt", "updatedAt")
            VALUES ($1, $2, 'Migration Test', 'APPROVED', 'USER', $3, $3)
            """,
            user_id,
            f"migration-{suffix}@example.test",
            now,
        )
        await conn.execute(
            """
            INSERT INTO "Job" (
              id, "userId", type, status, "sourceUrl", "queuedAt", "workerId",
              attempt, "heartbeatAt", "leaseExpiresAt"
            ) VALUES (
              $1, $2, 'SCRAPE_WEB', 'RUNNING', 'https://example.test', $3,
              'worker-live', 1, $3, $4
            )
            """,
            job_id,
            user_id,
            now,
            future_lease,
        )
        stored_future_lease = await conn.fetchval(
            'SELECT "leaseExpiresAt" FROM "Job" WHERE id = $1', job_id
        )

        await conn.execute(migration)
        await conn.execute(migration)

        lease_after = await conn.fetchval(
            'SELECT "leaseExpiresAt" FROM "Job" WHERE id = $1', job_id
        )
        assert lease_after == stored_future_lease
    finally:
        await conn.execute('DELETE FROM "User" WHERE id = $1', user_id)
        await conn.close()
