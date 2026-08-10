from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from src import main


async def test_reconcile_tags_processes_claimed_batch(monkeypatch: pytest.MonkeyPatch) -> None:
    claim = AsyncMock(
        return_value=[
            {
                "id": "transcript-1",
                "userId": "user-1",
                "jobId": "job-1",
                "taggingAttempt": 1,
                "correctionRevision": 2,
                "sourceVersion": 5,
                "sourceChecksum": "source-5",
            },
            {
                "id": "transcript-2",
                "userId": "user-2",
                "jobId": None,
                "taggingAttempt": 3,
                "correctionRevision": 4,
                "sourceVersion": 6,
                "sourceChecksum": None,
            },
        ]
    )
    generate = AsyncMock(return_value=None)
    monkeypatch.setattr(main.db, "claim_pending_tag_enrichments", claim)
    monkeypatch.setattr(main, "_maybe_generate_tags", generate)

    tasks: set[asyncio.Task[None]] = set()
    count = await main._reconcile_tags_once(asyncio.Semaphore(1), tasks, limit=2)
    await asyncio.gather(*tasks)

    assert count == 2
    claim.assert_awaited_once_with(limit=2)
    assert generate.await_count == 2
    generate.assert_any_await(
        user_id="user-1",
        job_id="job-1",
        transcript_id="transcript-1",
        log=main.log,
        already_claimed=True,
        claim_attempt=1,
        correction_revision=2,
        source_version=5,
        source_checksum="source-5",
    )
    generate.assert_any_await(
        user_id="user-2",
        job_id=None,
        transcript_id="transcript-2",
        log=main.log,
        already_claimed=True,
        claim_attempt=3,
        correction_revision=4,
        source_version=6,
        source_checksum=None,
    )
