from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime
from unittest.mock import Mock

import asyncpg
import pytest

from src import db, knowledge_deletion
from src.graph_index_lease import GraphIndexLease
from src.job_lease import JobLeaseToken, activate_job_lease

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="PostgreSQL integration test requires DATABASE_URL",
)


@pytest.fixture(autouse=True)
async def _reset_db_pool_between_event_loops() -> None:
    await db.close_pool()
    yield
    await db.close_pool()


class _InMemoryLeaseRedis:
    async def set(
        self,
        name: str,
        value: str,
        *,
        px: int,
        nx: bool,
    ) -> object:
        return True

    async def eval(
        self,
        script: str,
        numkeys: int,
        *keys_and_args: str | int,
    ) -> object:
        return 1


async def test_worker_deletes_only_owned_note_and_graph_evidence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert os.environ.get("DATABASE_URL")
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    suffix = uuid.uuid4().hex
    owner_id = f"delete-owner-{suffix}"
    foreign_id = f"delete-foreign-{suffix}"
    note_id = f"delete-note-{suffix}"
    job_id = f"delete-job-{suffix}"
    owner_node = f"delete-owner-node-{suffix}"
    foreign_node = f"delete-foreign-node-{suffix}"
    now = datetime.now(UTC).replace(tzinfo=None)

    async def acquire_test_graph_lease(user_id: str) -> GraphIndexLease:
        return GraphIndexLease(
            key=f"test:graph-lease:{user_id}",
            owner="postgres-integration-test",
            redis=_InMemoryLeaseRedis(),
        )

    monkeypatch.setattr(
        knowledge_deletion,
        "acquire_graph_index_lease",
        acquire_test_graph_lease,
    )
    try:
        await conn.executemany(
            """
            INSERT INTO "User" (id, email, name, status, role, "createdAt", "updatedAt")
            VALUES ($1, $2, $3, 'APPROVED', 'USER', $4, $4)
            """,
            [
                (owner_id, f"delete-owner-{suffix}@example.test", "Delete owner", now),
                (foreign_id, f"delete-foreign-{suffix}@example.test", "Foreign owner", now),
            ],
        )
        await conn.execute(
            """
            INSERT INTO "Note" (id, "userId", kind, title, content, "createdAt", "updatedAt")
            VALUES ($1, $2, 'NOTE', 'Owned note', 'body', $3, $3)
            """,
            note_id,
            owner_id,
            now,
        )
        await conn.executemany(
            """
            INSERT INTO "BrainNode" (
              id, "userId", key, type, label, "sourceType", "sourceId", "createdAt", "updatedAt"
            ) VALUES ($1, $2, $3, 'CONTENT', $4, 'NOTE', $5, $6, $6)
            """,
            [
                (owner_node, owner_id, f"note:{note_id}", "Owned note", note_id, now),
                (
                    foreign_node,
                    foreign_id,
                    f"foreign-note:{note_id}",
                    "Foreign evidence",
                    note_id,
                    now,
                ),
            ],
        )
        await conn.execute(
            """
            INSERT INTO "Job" (
              id, "userId", type, status, "sourceUrl", "deletionTargetType",
              "deletionTargetId", "deletionTargetTitle", "queuedAt"
            ) VALUES (
              $1, $2, 'DELETE_KNOWLEDGE', 'QUEUED', $3, 'NOTE', $4, 'Owned note', $5
            )
            """,
            job_id,
            owner_id,
            f"voxen://delete/note/{note_id}",
            note_id,
            now,
        )

        claimed = await db.claim_job(job_id, "delete-worker")
        assert claimed is not None
        token = JobLeaseToken(job_id, "delete-worker", int(claimed["attempt"]))
        with activate_job_lease(token):
            await knowledge_deletion.run(
                job_id=job_id,
                user_id=owner_id,
                target_type="NOTE",
                target_id=note_id,
                log=Mock(),
            )

        assert await conn.fetchval('SELECT id FROM "Note" WHERE id = $1', note_id) is None
        assert await conn.fetchval('SELECT id FROM "BrainNode" WHERE id = $1', owner_node) is None
        assert (
            await conn.fetchval('SELECT id FROM "BrainNode" WHERE id = $1', foreign_node)
            == foreign_node
        )
        job = await conn.fetchrow(
            'SELECT status, "progressStage", "progressPercent" FROM "Job" WHERE id = $1',
            job_id,
        )
        assert job is not None
        assert dict(job) == {"status": "DONE", "progressStage": "done", "progressPercent": 100}
    finally:
        await conn.execute('DELETE FROM "User" WHERE id = ANY($1::text[])', [owner_id, foreign_id])
        await conn.close()
