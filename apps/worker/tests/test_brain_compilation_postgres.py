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


async def test_semantic_claim_is_exclusive_recovers_and_stops_at_attempt_limit() -> None:
    assert os.environ.get("DATABASE_URL")
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    suffix = uuid.uuid4().hex
    user_id = f"brain-user-{suffix}"
    transcript_id = f"brain-transcript-{suffix}"
    compilation_id = f"brain-compilation-{suffix}"
    segment_id = f"brain-segment-{suffix}"
    segment_key = "lines:1-20"
    now = datetime.now(UTC).replace(tzinfo=None)
    try:
        await conn.execute(
            """
            INSERT INTO "User" (id, email, name, status, role, "createdAt", "updatedAt")
            VALUES ($1, $2, 'Brain Claim Test', 'APPROVED', 'USER', $3, $3)
            """,
            user_id,
            f"brain-{suffix}@example.test",
            now,
        )
        await conn.execute(
            """
            INSERT INTO "Transcript" (
              id, "userId", source, url, title, "durationSec", language,
              "transcriptionMethod", "mdPath", "plainText", frontmatter,
              "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, 'WEB', 'https://example.test/brain', 'Brain', 0, 'pt',
              'SCRAPE', 'brain.md', 'semantic content', '{}'::jsonb, $3, $3
            )
            """,
            transcript_id,
            user_id,
            now,
        )
        await conn.execute(
            """
            INSERT INTO "BrainCompilation" (
              id, "userId", "transcriptId", "contentHash", status,
              "totalSegments", "completedSegments", "createdAt", "updatedAt"
            ) VALUES ($1, $2, $3, 'hash-1', 'PENDING', 1, 0, $4, $4)
            """,
            compilation_id,
            user_id,
            transcript_id,
            now,
        )
        await conn.execute(
            """
            INSERT INTO "BrainCompilationSegment" (
              id, "compilationId", "segmentKey", status, "startLine", "endLine",
              attempts, "createdAt", "updatedAt"
            ) VALUES ($1, $2, $3, 'PENDING', 1, 20, 0, $4, $4)
            """,
            segment_id,
            compilation_id,
            segment_key,
            now,
        )

        assert (
            await db.claim_grounded_brain_segments(
                user_id=f"foreign-{suffix}",
                compilation_id=compilation_id,
                segment_keys=[segment_key],
                worker_id="foreign-worker",
                limit=1,
            )
            == []
        )

        first_claims = await asyncio.gather(
            db.claim_grounded_brain_segments(
                user_id=user_id,
                compilation_id=compilation_id,
                segment_keys=[segment_key],
                worker_id="worker-a",
                limit=1,
            ),
            db.claim_grounded_brain_segments(
                user_id=user_id,
                compilation_id=compilation_id,
                segment_keys=[segment_key],
                worker_id="worker-b",
                limit=1,
            ),
        )
        assert sum(len(batch) for batch in first_claims) == 1

        await conn.execute(
            'UPDATE "BrainCompilationSegment" SET "leaseExpiresAt" = $2 WHERE id = $1',
            segment_id,
            now - timedelta(seconds=1),
        )
        recovered_claims = await asyncio.gather(
            db.claim_grounded_brain_segments(
                user_id=user_id,
                compilation_id=compilation_id,
                segment_keys=[segment_key],
                worker_id="worker-c",
                limit=1,
            ),
            db.claim_grounded_brain_segments(
                user_id=user_id,
                compilation_id=compilation_id,
                segment_keys=[segment_key],
                worker_id="worker-d",
                limit=1,
            ),
        )
        winners = [row for batch in recovered_claims for row in batch]
        assert len(winners) == 1
        assert winners[0]["attempts"] == 2

        owner = await conn.fetchval(
            'SELECT "claimedBy" FROM "BrainCompilationSegment" WHERE id = $1', segment_id
        )
        for attempt in range(2, db.GROUNDED_SEGMENT_MAX_ATTEMPTS + 1):
            await db.mark_grounded_segment_failed(
                compilation_id=compilation_id,
                segment_key=segment_key,
                error="PROVIDER_UNAVAILABLE",
                worker_id=owner,
            )
            if attempt == db.GROUNDED_SEGMENT_MAX_ATTEMPTS:
                break
            await conn.execute(
                'UPDATE "BrainCompilationSegment" SET "nextAttemptAt" = $2 WHERE id = $1',
                segment_id,
                now - timedelta(seconds=1),
            )
            claim = await db.claim_grounded_brain_segments(
                user_id=user_id,
                compilation_id=compilation_id,
                segment_keys=[segment_key],
                worker_id=f"worker-{attempt + 1}",
                limit=1,
            )
            assert len(claim) == 1
            assert claim[0]["attempts"] == attempt + 1
            owner = f"worker-{attempt + 1}"

        terminal = await conn.fetchrow(
            'SELECT status, attempts, "nextAttemptAt" FROM "BrainCompilationSegment" WHERE id = $1',
            segment_id,
        )
        assert terminal is not None
        assert dict(terminal) == {
            "status": "FAILED",
            "attempts": db.GROUNDED_SEGMENT_MAX_ATTEMPTS,
            "nextAttemptAt": None,
        }
        assert (
            await db.claim_grounded_brain_segments(
                user_id=user_id,
                compilation_id=compilation_id,
                segment_keys=[segment_key],
                worker_id="worker-after-limit",
                limit=1,
            )
            == []
        )
    finally:
        await conn.execute('DELETE FROM "User" WHERE id = $1', user_id)
        await conn.close()
