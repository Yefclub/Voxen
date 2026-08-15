from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any, cast
from unittest.mock import ANY, AsyncMock

import asyncpg
import pytest

from src import db, events, main, pipeline
from src.job_lease import (
    JobLease,
    JobLeaseLostError,
    JobLeaseToken,
    activate_job_lease,
)


class _RecoveryConnection:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.executed: list[tuple[str, tuple[object, ...]]] = []

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[None]:
        yield

    async def fetch(self, query: str, *_args: object) -> list[dict[str, Any]]:
        assert "FOR UPDATE SKIP LOCKED" in query
        return self.rows

    async def execute(self, query: str, *args: object) -> None:
        self.executed.append((query, args))


async def test_heartbeat_cancels_executor_when_fencing_is_lost() -> None:
    token = JobLeaseToken("job-1", "worker-a", 1)
    renew = AsyncMock(return_value=False)
    lease = JobLease(token, renew, heartbeat_interval_sec=0)

    with pytest.raises(JobLeaseLostError):
        async with lease.heartbeat():
            await asyncio.sleep(1)

    renew.assert_awaited_once_with(token)


async def test_persisted_cancel_is_not_treated_as_owned_terminal_lease(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _CancelledConnection:
        calls = 0

        async def fetchrow(self, query: str, *_args: object) -> None:
            self.calls += 1
            if self.calls == 2:
                assert "'CANCELLED'" not in query
            return None

    @asynccontextmanager
    async def fake_connection() -> AsyncIterator[asyncpg.Connection]:
        yield cast(asyncpg.Connection, _CancelledConnection())

    monkeypatch.setattr(db, "connection", fake_connection)

    owned = await db.renew_job_lease(JobLeaseToken("job-1", "worker-a", 1))

    assert owned is False


async def test_reaper_requeues_before_limit_and_fails_at_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn = _RecoveryConnection(
        [
            {"id": "retry", "userId": "u1", "attempt": 2, "transcriptId": None},
            {"id": "fail", "userId": "u2", "attempt": 3, "transcriptId": None},
        ]
    )

    @asynccontextmanager
    async def fake_connection() -> AsyncIterator[asyncpg.Connection]:
        yield cast(asyncpg.Connection, conn)

    monkeypatch.setattr(db, "connection", fake_connection)
    result = await db.recover_expired_jobs(max_attempts=3)

    assert [(item["id"], item["action"]) for item in result] == [
        ("retry", "requeued"),
        ("fail", "failed"),
    ]
    sql = " ".join(query for query, _ in conn.executed)
    assert "status = 'QUEUED'" in sql
    assert "status = 'FAILED'" in sql
    assert db.WORKER_INTERRUPTED_MESSAGE in repr(conn.executed)


async def test_reaper_restores_saved_media_when_attempts_are_exhausted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn = _RecoveryConnection(
        [
            {
                "id": "download",
                "userId": "u1",
                "type": "DOWNLOAD_MEDIA",
                "attempt": 3,
                "transcriptId": None,
                "savedMediaId": "media-download",
            },
            {
                "id": "process",
                "userId": "u1",
                "type": "UPLOAD_AND_TRANSCRIBE",
                "attempt": 3,
                "transcriptId": None,
                "savedMediaId": "media-process",
            },
        ]
    )

    @asynccontextmanager
    async def fake_connection() -> AsyncIterator[asyncpg.Connection]:
        yield cast(asyncpg.Connection, conn)

    monkeypatch.setattr(db, "connection", fake_connection)

    result = await db.recover_expired_jobs(max_attempts=3)

    assert [item["action"] for item in result] == ["failed", "failed"]
    media_updates = [
        (query, args) for query, args in conn.executed if 'UPDATE "SavedMedia"' in query
    ]
    assert [args[:2] for _, args in media_updates] == [
        ("media-download", "FAILED"),
        ("media-process", "READY"),
    ]
    assert all(args[4] == "u1" for _, args in media_updates)


async def test_checkpoint_gets_only_one_bounded_extra_attempt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn = _RecoveryConnection(
        [
            {"id": "last-chance", "userId": "u1", "attempt": 3, "transcriptId": "t1"},
            {"id": "exhausted", "userId": "u2", "attempt": 4, "transcriptId": "t2"},
        ]
    )

    @asynccontextmanager
    async def fake_connection() -> AsyncIterator[asyncpg.Connection]:
        yield cast(asyncpg.Connection, conn)

    monkeypatch.setattr(db, "connection", fake_connection)
    result = await db.recover_expired_jobs(max_attempts=3)

    assert [(item["id"], item["action"]) for item in result] == [
        ("last-chance", "requeued"),
        ("exhausted", "failed"),
    ]


async def test_old_worker_cannot_finalize_after_lease_changes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _FencedConnection:
        async def fetchrow(self, _query: str, *_args: object) -> None:
            return None

    @asynccontextmanager
    async def fake_connection() -> AsyncIterator[asyncpg.Connection]:
        yield cast(asyncpg.Connection, _FencedConnection())

    monkeypatch.setattr(db, "connection", fake_connection)
    token = JobLeaseToken("job-1", "old-worker", 1)
    with activate_job_lease(token), pytest.raises(JobLeaseLostError):
        await db.mark_job_done("job-1")


async def test_retry_with_transcript_checkpoint_does_not_run_ingestion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        pipeline.db,
        "claim_job",
        AsyncMock(
            return_value={
                "userId": "user-1",
                "sourceUrl": "https://example.test/video",
                "type": "DOWNLOAD_AND_TRANSCRIBE",
                "refreshTranscriptId": None,
                "transcriptId": "transcript-1",
                "attempt": 2,
            }
        ),
    )
    monkeypatch.setattr(pipeline.db, "renew_job_lease", AsyncMock(return_value=True))
    monkeypatch.setattr(pipeline.events, "publish_job_event", AsyncMock())
    complete = AsyncMock()
    monkeypatch.setattr(pipeline, "_complete_persisted_job", complete)
    ingest = AsyncMock()
    monkeypatch.setattr(pipeline, "_run_pipeline", ingest)

    await pipeline.process_job("job-1", "worker-a")

    ingest.assert_not_awaited()
    complete.assert_awaited_once_with(
        user_id="user-1",
        transcript_id="transcript-1",
        job_id="job-1",
        log=ANY,
    )


async def test_cancelled_executor_releases_lease_for_immediate_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        pipeline.db,
        "claim_job",
        AsyncMock(
            return_value={
                "userId": "user-1",
                "sourceUrl": "https://example.test/video",
                "type": "DOWNLOAD_AND_TRANSCRIBE",
                "refreshTranscriptId": None,
                "transcriptId": None,
                "attempt": 1,
            }
        ),
    )
    monkeypatch.setattr(pipeline.db, "renew_job_lease", AsyncMock(return_value=True))
    release = AsyncMock(return_value=True)
    monkeypatch.setattr(pipeline.db, "release_job_lease", release)
    monkeypatch.setattr(pipeline.events, "publish_job_event", AsyncMock())
    monkeypatch.setattr(pipeline, "is_cancelled", lambda _job_id: False)
    monkeypatch.setattr(pipeline, "clear_cancelled", lambda _job_id: None)
    started = asyncio.Event()

    async def ingest(**_kwargs: object) -> None:
        started.set()
        await asyncio.Future()

    monkeypatch.setattr(pipeline, "_run_pipeline", ingest)
    task = asyncio.create_task(pipeline.process_job("job-1", "worker-a"))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    release.assert_awaited_once_with(JobLeaseToken("job-1", "worker-a", 1))


async def test_reconciliation_processes_queued_job_without_redis_notification(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(main.db, "recover_expired_jobs", AsyncMock(return_value=[]))
    monkeypatch.setattr(main.db, "list_queued_job_ids", AsyncMock(return_value=["lost-notify"]))
    process = AsyncMock()
    monkeypatch.setattr(main, "_process_with_sem", process)
    tasks: set[asyncio.Task[None]] = set()

    await main._reconcile_jobs_once(asyncio.Semaphore(1), "worker-a", tasks)
    await asyncio.gather(*tasks)

    process.assert_awaited_once_with(
        ANY,
        "lost-notify",
        "worker-a",
    )


async def test_summary_enrichment_is_reclaimed_independently_from_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        main.db,
        "claim_pending_summary_enrichments",
        AsyncMock(
            return_value=[
                {
                    "id": "t1",
                    "userId": "u1",
                    "jobId": "j1",
                    "summaryAttempt": 2,
                    "correctionRevision": 3,
                    "sourceVersion": 2,
                    "sourceChecksum": "source-2",
                }
            ]
        ),
    )
    generate = AsyncMock()
    monkeypatch.setattr(main.summary, "maybe_generate", generate)

    tasks: set[asyncio.Task[None]] = set()
    assert await main._reconcile_summaries_once(asyncio.Semaphore(1), tasks) == 1
    await asyncio.gather(*tasks)
    generate.assert_awaited_once_with(
        user_id="u1",
        job_id="j1",
        transcript_id="t1",
        log=main.log,
        already_claimed=True,
        claim_attempt=2,
        correction_revision=3,
        source_version=2,
        source_checksum="source-2",
    )


async def test_summary_reconciler_claims_only_available_local_slots(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    claim = AsyncMock(return_value=[])
    monkeypatch.setattr(main.db, "claim_pending_summary_enrichments", claim)
    occupied = asyncio.create_task(asyncio.sleep(0))
    tasks: set[asyncio.Task[None]] = {occupied}

    await main._reconcile_summaries_once(
        asyncio.Semaphore(2),
        tasks,
        limit=5,
        max_in_flight=2,
    )
    await occupied

    claim.assert_awaited_once_with(limit=1)


async def test_enrichment_dispatcher_advances_summary_and_tags_under_backlog(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    summary_queue = [
        {
            "id": "s1",
            "userId": "u1",
            "jobId": None,
            "summaryAttempt": 1,
            "correctionRevision": 0,
            "sourceVersion": 0,
            "sourceChecksum": None,
        },
        {
            "id": "s2",
            "userId": "u1",
            "jobId": None,
            "summaryAttempt": 1,
            "correctionRevision": 0,
            "sourceVersion": 0,
            "sourceChecksum": None,
        },
    ]
    tag_queue = [
        {
            "id": "t1",
            "userId": "u1",
            "jobId": None,
            "taggingAttempt": 1,
            "correctionRevision": 0,
            "sourceVersion": 0,
            "sourceChecksum": None,
        },
        {
            "id": "t2",
            "userId": "u1",
            "jobId": None,
            "taggingAttempt": 1,
            "correctionRevision": 0,
            "sourceVersion": 0,
            "sourceChecksum": None,
        },
    ]

    async def claim_summaries(limit: int) -> list[dict[str, Any]]:
        batch = summary_queue[:limit]
        del summary_queue[:limit]
        return batch

    async def claim_tags(limit: int) -> list[dict[str, Any]]:
        batch = tag_queue[:limit]
        del tag_queue[:limit]
        return batch

    gate = asyncio.Event()

    async def wait_for_gate(**_kwargs: object) -> None:
        await gate.wait()

    monkeypatch.setattr(main.db, "claim_pending_summary_enrichments", claim_summaries)
    monkeypatch.setattr(main.db, "claim_pending_tag_enrichments", claim_tags)
    monkeypatch.setattr(
        main.research_db,
        "claim_pending_transcript_enrichments",
        AsyncMock(return_value=[]),
    )
    monkeypatch.setattr(
        main.research_db,
        "reconcile_transcript_enrichment_lifecycle",
        AsyncMock(return_value=[]),
    )
    monkeypatch.setattr(
        main.brain_compilation.brain_compilation_db,
        "list_due_compilations",
        AsyncMock(return_value=[]),
    )
    monkeypatch.setattr(main.summary, "maybe_generate", wait_for_gate)
    monkeypatch.setattr(main, "_maybe_generate_tags", wait_for_gate)
    tasks: set[asyncio.Task[None]] = set()
    sem = asyncio.Semaphore(2)
    main._enrichment_queue_cursor = 0

    assert await main._reconcile_enrichments_once(sem, tasks) == (1, 1, 0, 0)
    assert len(tasks) == 2
    assert await main._reconcile_enrichments_once(sem, tasks) == (0, 0, 0, 0)

    gate.set()
    await asyncio.gather(*list(tasks))
    await asyncio.sleep(0)
    assert await main._reconcile_enrichments_once(sem, tasks) == (1, 1, 0, 0)
    await asyncio.gather(*list(tasks))

    assert summary_queue == []
    assert tag_queue == []


async def test_enrichment_dispatcher_round_robins_research_without_starvation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    summary_queue = [
        {
            "id": "s1",
            "userId": "u1",
            "jobId": None,
            "summaryAttempt": 1,
            "correctionRevision": 0,
            "sourceVersion": 0,
            "sourceChecksum": None,
        }
    ]
    tag_queue = [
        {
            "id": "t1",
            "userId": "u1",
            "jobId": None,
            "taggingAttempt": 1,
            "correctionRevision": 0,
            "sourceVersion": 0,
            "sourceChecksum": None,
        }
    ]
    research_queue = [{"id": "r1", "userId": "u1", "attempt": 1}]
    brain_queue = [{"userId": "u1", "transcriptId": "b1"}]

    async def claim(queue: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
        batch = queue[:limit]
        del queue[:limit]
        return batch

    monkeypatch.setattr(
        main.db,
        "claim_pending_summary_enrichments",
        lambda limit: claim(summary_queue, limit),
    )
    monkeypatch.setattr(
        main.db,
        "claim_pending_tag_enrichments",
        lambda limit: claim(tag_queue, limit),
    )
    monkeypatch.setattr(
        main.research_db,
        "claim_pending_transcript_enrichments",
        lambda limit: claim(research_queue, limit),
    )
    monkeypatch.setattr(
        main.research_db,
        "reconcile_transcript_enrichment_lifecycle",
        AsyncMock(return_value=[]),
    )
    monkeypatch.setattr(
        main.brain_compilation.brain_compilation_db,
        "list_due_compilations",
        lambda limit: claim(brain_queue, limit),
    )
    monkeypatch.setattr(main.summary, "maybe_generate", AsyncMock())
    monkeypatch.setattr(main, "_maybe_generate_tags", AsyncMock())
    monkeypatch.setattr(main.research_enrichment, "process", AsyncMock())
    monkeypatch.setattr(main.brain_compilation, "extract_grounded_brain", AsyncMock())
    tasks: set[asyncio.Task[None]] = set()
    sem = asyncio.Semaphore(1)
    main._enrichment_queue_cursor = 0

    assert await main._reconcile_enrichments_once(sem, tasks, max_in_flight=1) == (1, 0, 0, 0)
    await asyncio.gather(*list(tasks))
    await asyncio.sleep(0)
    assert await main._reconcile_enrichments_once(sem, tasks, max_in_flight=1) == (0, 1, 0, 0)
    await asyncio.gather(*list(tasks))
    await asyncio.sleep(0)
    assert await main._reconcile_enrichments_once(sem, tasks, max_in_flight=1) == (0, 0, 1, 0)
    await asyncio.gather(*list(tasks))
    await asyncio.sleep(0)
    assert await main._reconcile_enrichments_once(sem, tasks, max_in_flight=1) == (0, 0, 0, 1)
    await asyncio.gather(*list(tasks))

    assert summary_queue == tag_queue == research_queue == brain_queue == []


async def test_research_dispatcher_reconciles_lifecycle_without_mutating_parent_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    claim = AsyncMock(return_value=[])
    reconcile = AsyncMock(
        return_value=[
            {
                "id": "research-1",
                "userId": "user-1",
                "transcriptId": "transcript-1",
                "jobId": "job-1",
                "stage": "research_cancelled",
            }
        ]
    )
    publish = AsyncMock()
    monkeypatch.setattr(main.research_db, "claim_pending_transcript_enrichments", claim)
    monkeypatch.setattr(main.research_db, "reconcile_transcript_enrichment_lifecycle", reconcile)
    monkeypatch.setattr(main.events, "publish_job_event", publish)

    assert await main._reconcile_research_once(asyncio.Semaphore(1), set()) == 0
    claim.assert_awaited_once_with(limit=2)
    publish.assert_not_awaited()


async def test_research_dispatcher_fails_closed_when_atomic_claim_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    claim = AsyncMock(side_effect=RuntimeError("policy unavailable"))
    monkeypatch.setattr(main.research_db, "claim_pending_transcript_enrichments", claim)
    monkeypatch.setattr(
        main.research_db,
        "reconcile_transcript_enrichment_lifecycle",
        AsyncMock(return_value=[]),
    )

    assert await main._reconcile_research_once(asyncio.Semaphore(1), set()) == 0
    claim.assert_awaited_once_with(limit=2)


async def test_brain_warning_reconciler_publishes_atomically_recorded_done_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created_at = datetime(2026, 8, 15, tzinfo=UTC)
    reconcile = AsyncMock(
        return_value=[
            {
                "id": "job-1",
                "userId": "user-1",
                "transcriptId": "transcript-1",
                "eventId": "event-1",
                "createdAt": created_at,
            }
        ]
    )
    publish = AsyncMock()
    monkeypatch.setattr(db, "reconcile_resolved_brain_warning_jobs", reconcile)
    monkeypatch.setattr(events, "publish_recorded_job_event", publish)

    assert await main._reconcile_resolved_brain_warnings_once() == 1
    reconcile.assert_awaited_once_with(limit=50)
    publish.assert_awaited_once_with(
        "user-1",
        "job-1",
        "done",
        event_id="event-1",
        created_at=created_at,
        percent=100,
        transcript_id="transcript-1",
    )


async def test_job_event_survives_redis_outage_after_postgres_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    persisted = AsyncMock(return_value=("event-1", db._utcnow_naive()))
    monkeypatch.setattr(db, "record_job_progress", persisted)
    monkeypatch.setattr(events, "get_redis", AsyncMock(side_effect=ConnectionError("offline")))

    await events.publish_job_event("u1", "j1", "running", percent=0)

    persisted.assert_awaited_once()
