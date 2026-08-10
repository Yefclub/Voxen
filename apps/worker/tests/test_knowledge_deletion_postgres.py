from __future__ import annotations

import asyncio
import os
import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, Mock

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


@pytest.fixture
def in_memory_graph_lease(monkeypatch: pytest.MonkeyPatch) -> None:
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


async def test_worker_deletes_only_owned_note_and_graph_evidence(
    in_memory_graph_lease: None,
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


async def _insert_transcript_deletion_fixture(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    transcript_id: str,
    job_id: str,
    status: str,
    now: datetime,
) -> str:
    md_path = f"workspaces/{user_id}/transcripts/{transcript_id}.md"
    await conn.execute(
        """
        INSERT INTO "User" (id, email, name, status, role, "createdAt", "updatedAt")
        VALUES ($1, $2, 'Delete transcript', 'APPROVED', 'USER', $3, $3)
        """,
        user_id,
        f"{user_id}@example.test",
        now,
    )
    await conn.execute(
        """
        INSERT INTO "Transcript" (
          id, "userId", source, url, title, "durationSec", language,
          "transcriptionMethod", "mdPath", "plainText", frontmatter, status,
          "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, 'WEB', $3, 'Delete transcript', 0, 'en', 'SCRAPE', $4,
          'body', '{}'::jsonb, $5::"ContentStatus", $6, $6
        )
        """,
        transcript_id,
        user_id,
        f"https://example.test/{transcript_id}",
        md_path,
        status,
        now,
    )
    await conn.execute(
        """
        INSERT INTO "Job" (
          id, "userId", type, status, "sourceUrl", "deletionTargetType",
          "deletionTargetId", "deletionTargetTitle", "queuedAt"
        ) VALUES (
          $1, $2, 'DELETE_KNOWLEDGE', 'QUEUED', $3, 'TRANSCRIPT', $4,
          'Delete transcript', $5
        )
        """,
        job_id,
        user_id,
        f"voxen://delete/transcript/{transcript_id}",
        transcript_id,
        now,
    )
    return md_path


async def test_transcript_delete_rejects_active_row_before_storage_side_effects(
    in_memory_graph_lease: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert os.environ.get("DATABASE_URL")
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    suffix = uuid.uuid4().hex
    user_id = f"delete-active-user-{suffix}"
    transcript_id = f"delete-active-transcript-{suffix}"
    job_id = f"delete-active-job-{suffix}"
    now = datetime.now(UTC).replace(tzinfo=None)
    remove = AsyncMock()
    monkeypatch.setattr(knowledge_deletion.storage, "delete_object", remove)
    try:
        await _insert_transcript_deletion_fixture(
            conn,
            user_id=user_id,
            transcript_id=transcript_id,
            job_id=job_id,
            status="ACTIVE",
            now=now,
        )
        claimed = await db.claim_job(job_id, "delete-worker")
        assert claimed is not None
        token = JobLeaseToken(job_id, "delete-worker", int(claimed["attempt"]))
        with activate_job_lease(token):
            with pytest.raises(RuntimeError, match="remain in trash"):
                await knowledge_deletion._delete_transcript(job_id, user_id, transcript_id)

        assert (
            await conn.fetchval('SELECT status FROM "Transcript" WHERE id = $1', transcript_id)
            == "ACTIVE"
        )
        remove.assert_not_awaited()
    finally:
        await conn.execute('DELETE FROM "User" WHERE id = $1', user_id)
        await conn.close()


async def test_transcript_delete_waits_for_source_refresh_lock(
    in_memory_graph_lease: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert os.environ.get("DATABASE_URL")
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    blocker = await asyncpg.connect(os.environ["DATABASE_URL"])
    suffix = uuid.uuid4().hex
    user_id = f"delete-refresh-user-{suffix}"
    transcript_id = f"delete-refresh-transcript-{suffix}"
    job_id = f"delete-refresh-job-{suffix}"
    now = datetime.now(UTC).replace(tzinfo=None)
    remove = AsyncMock()
    monkeypatch.setattr(knowledge_deletion.storage, "delete_object", remove)
    refresh_lock_key = f"voxen:source-refresh:{transcript_id}"
    lock_held = False
    try:
        md_path = await _insert_transcript_deletion_fixture(
            conn,
            user_id=user_id,
            transcript_id=transcript_id,
            job_id=job_id,
            status="TRASH",
            now=now,
        )
        claimed = await db.claim_job(job_id, "delete-worker")
        assert claimed is not None
        token = JobLeaseToken(job_id, "delete-worker", int(claimed["attempt"]))
        await blocker.execute("SELECT pg_advisory_lock(hashtext($1))", refresh_lock_key)
        lock_held = True
        with activate_job_lease(token):
            task = asyncio.create_task(
                knowledge_deletion._delete_transcript(job_id, user_id, transcript_id)
            )
        await asyncio.sleep(0.1)
        assert not task.done()
        remove.assert_not_awaited()

        await blocker.execute("SELECT pg_advisory_unlock(hashtext($1))", refresh_lock_key)
        lock_held = False
        await asyncio.wait_for(task, timeout=5)

        assert (
            await conn.fetchval('SELECT id FROM "Transcript" WHERE id = $1', transcript_id) is None
        )
        remove.assert_awaited_once_with(key=md_path)
    finally:
        if lock_held:
            await blocker.execute("SELECT pg_advisory_unlock(hashtext($1))", refresh_lock_key)
        await conn.execute('DELETE FROM "User" WHERE id = $1', user_id)
        await blocker.close()
        await conn.close()


async def test_clear_all_folders_rejects_cross_workspace_descendant(
    in_memory_graph_lease: None,
) -> None:
    assert os.environ.get("DATABASE_URL")
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    suffix = uuid.uuid4().hex
    owner_id = f"delete-folders-owner-{suffix}"
    foreign_id = f"delete-folders-foreign-{suffix}"
    root_id = f"delete-folders-root-{suffix}"
    foreign_child_id = f"delete-folders-foreign-child-{suffix}"
    job_id = f"delete-folders-job-{suffix}"
    now = datetime.now(UTC).replace(tzinfo=None)
    try:
        await conn.executemany(
            """
            INSERT INTO "User" (id, email, name, status, role, "createdAt", "updatedAt")
            VALUES ($1, $2, $3, 'APPROVED', 'USER', $4, $4)
            """,
            [
                (owner_id, f"{owner_id}@example.test", "Folder owner", now),
                (foreign_id, f"{foreign_id}@example.test", "Foreign folder owner", now),
            ],
        )
        await conn.execute(
            """
            INSERT INTO "LibraryFolder" (id, "userId", name, "createdAt", "updatedAt")
            VALUES ($1, $2, 'Owner root', $3, $3)
            """,
            root_id,
            owner_id,
            now,
        )
        await conn.execute(
            """
            INSERT INTO "LibraryFolder" (
              id, "userId", "parentId", name, "createdAt", "updatedAt"
            ) VALUES ($1, $2, $3, 'Foreign child', $4, $4)
            """,
            foreign_child_id,
            foreign_id,
            root_id,
            now,
        )
        await conn.execute(
            """
            INSERT INTO "Job" (
              id, "userId", type, status, "sourceUrl", "deletionTargetType",
              "deletionTargetId", "deletionTargetTitle", "queuedAt"
            ) VALUES (
              $1, $2, 'DELETE_KNOWLEDGE', 'QUEUED', 'voxen://delete/library_folder/*',
              'LIBRARY_FOLDER', '*', 'All library folders', $3
            )
            """,
            job_id,
            owner_id,
            now,
        )
        claimed = await db.claim_job(job_id, "delete-worker")
        assert claimed is not None
        token = JobLeaseToken(job_id, "delete-worker", int(claimed["attempt"]))
        with activate_job_lease(token):
            with pytest.raises(RuntimeError, match="cross-workspace folder"):
                await knowledge_deletion._delete_library_folders(job_id, owner_id, "*")

        assert (
            await conn.fetchval('SELECT id FROM "LibraryFolder" WHERE id = $1', root_id) == root_id
        )
        assert (
            await conn.fetchval('SELECT id FROM "LibraryFolder" WHERE id = $1', foreign_child_id)
            == foreign_child_id
        )
    finally:
        await conn.execute(
            'UPDATE "LibraryFolder" SET "parentId" = NULL WHERE id = $1', foreign_child_id
        )
        await conn.execute('DELETE FROM "User" WHERE id = ANY($1::text[])', [owner_id, foreign_id])
        await conn.close()
