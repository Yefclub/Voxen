from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import asyncpg
import pytest

from src import db

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="PostgreSQL integration test requires DATABASE_URL",
)


@pytest.fixture
async def postgres() -> AsyncIterator[asyncpg.Connection]:
    await db.close_pool()
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    await conn.execute(
        """
        TRUNCATE TABLE
          "TranscriptTag", "Tag", "BrainNode", "Job", "Transcript",
          "LibraryFolder", "User"
        CASCADE
        """
    )
    try:
        yield conn
    finally:
        await db.close_pool()
        await conn.execute(
            """
            TRUNCATE TABLE
              "TranscriptTag", "Tag", "BrainNode", "Job", "Transcript",
              "LibraryFolder", "User"
            CASCADE
            """
        )
        await conn.close()


async def _insert_user(conn: asyncpg.Connection, user_id: str) -> None:
    await conn.execute(
        """
        INSERT INTO "User" (
          id, email, "emailVerified", name, status, role, theme,
          "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, false, $1, 'APPROVED'::"UserStatus", 'USER'::"UserRole",
          'zinc', NOW(), NOW()
        )
        """,
        user_id,
        f"{user_id}@example.test",
    )


async def _insert_transcript(
    conn: asyncpg.Connection,
    *,
    transcript_id: str,
    user_id: str,
    tagging_status: str = "PENDING",
    attempts: int = 0,
    started_at: datetime | None = None,
    next_attempt_at: datetime | None = None,
    updated_at: datetime | None = None,
) -> None:
    await conn.execute(
        """
        INSERT INTO "Transcript" (
          id, "userId", status, source, url, title, "durationSec", language,
          "transcriptionMethod", "mdPath", "plainText", frontmatter,
          "taggingStatus", "taggingAttempts", "taggingStartedAt",
          "taggingNextAttemptAt", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, 'ACTIVE'::"ContentStatus", 'YOUTUBE'::"TranscriptSource",
          $3, $1, 10, 'pt', 'SUBTITLES'::"TranscriptionMethod", $4,
          'Conteúdo suficientemente longo para enriquecimento.', '{}'::jsonb,
          $5::"EnrichmentStatus", $6, $7, $8, NOW(),
          COALESCE($9::timestamp, NOW())
        )
        """,
        transcript_id,
        user_id,
        f"https://example.test/{transcript_id}",
        f"{transcript_id}.md",
        tagging_status,
        attempts,
        started_at,
        next_attempt_at,
        updated_at,
    )


async def test_claims_only_eligible_rows_and_never_exceeds_six_attempts(
    postgres: asyncpg.Connection,
) -> None:
    await _insert_user(postgres, "user-1")
    stale = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=20)
    future = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1)
    past = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=1)

    await _insert_transcript(postgres, transcript_id="pending", user_id="user-1")
    await _insert_transcript(
        postgres,
        transcript_id="retry-due",
        user_id="user-1",
        tagging_status="RETRY",
        attempts=1,
        next_attempt_at=past,
    )
    await _insert_transcript(
        postgres,
        transcript_id="retry-future",
        user_id="user-1",
        tagging_status="RETRY",
        attempts=1,
        next_attempt_at=future,
    )
    await _insert_transcript(
        postgres,
        transcript_id="stale-five",
        user_id="user-1",
        tagging_status="RUNNING",
        attempts=5,
        started_at=stale,
    )
    await _insert_transcript(
        postgres,
        transcript_id="stale-six",
        user_id="user-1",
        tagging_status="RUNNING",
        attempts=6,
        started_at=stale,
    )
    await _insert_transcript(postgres, transcript_id="already-tagged", user_id="user-1")
    await postgres.execute(
        """
        INSERT INTO "Tag" (
          id, "userId", name, slug, "createdAt", "updatedAt"
        ) VALUES ('tag-1', 'user-1', 'Existente', 'existente', NOW(), NOW())
        """
    )
    await postgres.execute(
        """
        INSERT INTO "TranscriptTag" ("transcriptId", "tagId", "createdAt")
        VALUES ('already-tagged', 'tag-1', NOW())
        """
    )

    await _insert_transcript(postgres, transcript_id="locked", user_id="user-1")
    transaction = postgres.transaction()
    await transaction.start()
    await postgres.fetchrow('SELECT id FROM "Transcript" WHERE id = $1 FOR UPDATE', "locked")
    try:
        claimed = await db.claim_pending_tag_enrichments(limit=20)
    finally:
        await transaction.rollback()

    assert {str(row["id"]) for row in claimed} == {"pending", "retry-due", "stale-five"}
    states = {
        str(row["id"]): (str(row["taggingStatus"]), int(row["taggingAttempts"]))
        for row in await postgres.fetch(
            """
            SELECT id, "taggingStatus", "taggingAttempts"
            FROM "Transcript"
            WHERE id IN (
              'pending', 'retry-due', 'retry-future', 'stale-five',
              'stale-six', 'already-tagged', 'locked'
            )
            """
        )
    }
    assert states["pending"] == ("RUNNING", 1)
    assert states["retry-due"] == ("RUNNING", 2)
    assert states["retry-future"] == ("RETRY", 1)
    assert states["stale-five"] == ("RUNNING", 6)
    assert states["stale-six"] == ("SKIPPED", 6)
    assert states["already-tagged"] == ("PENDING", 0)
    assert states["locked"] == ("PENDING", 0)

    await db.finish_tag_enrichment(
        "user-1",
        "stale-five",
        status="RETRY",
        error="sexta tentativa falhou",
    )
    exhausted = await postgres.fetchrow(
        """
        SELECT "taggingStatus", "taggingNextAttemptAt", "taggingError"
        FROM "Transcript"
        WHERE id = 'stale-five'
        """
    )
    assert exhausted["taggingStatus"] == "SKIPPED"
    assert exhausted["taggingNextAttemptAt"] is None
    assert exhausted["taggingError"] == "sexta tentativa falhou"


async def test_tag_operations_enforce_workspace_ownership(
    postgres: asyncpg.Connection,
) -> None:
    await _insert_user(postgres, "user-1")
    await _insert_user(postgres, "user-2")
    await _insert_transcript(postgres, transcript_id="transcript-1", user_id="user-1")
    await _insert_transcript(postgres, transcript_id="transcript-2", user_id="user-2")
    await postgres.execute(
        """
        INSERT INTO "Tag" (
          id, "userId", name, slug, "createdAt", "updatedAt"
        ) VALUES ('tag-2', 'user-2', 'Privada', 'privada', NOW(), NOW())
        """
    )
    await postgres.execute(
        """
        INSERT INTO "TranscriptTag" ("transcriptId", "tagId", "createdAt")
        VALUES ('transcript-2', 'tag-2', NOW())
        """
    )

    assert await db.list_transcript_tag_names("user-1", "transcript-2") == []
    assert await db.get_transcript_title_summary_folder("user-1", "transcript-2") is None
    assert await db.start_tag_enrichment("user-1", "transcript-2") is False
    await db.finish_tag_enrichment(
        "user-1",
        "transcript-2",
        status="COMPLETE",
    )
    assert (
        await db.apply_tags_to_transcript(
            user_id="user-1",
            transcript_id="transcript-2",
            tag_names=["Não deve existir"],
            current_folder_id=None,
        )
        == []
    )

    foreign = await postgres.fetchrow(
        """
        SELECT "taggingStatus", "taggingAttempts"
        FROM "Transcript"
        WHERE id = 'transcript-2'
        """
    )
    assert foreign["taggingStatus"] == "PENDING"
    assert foreign["taggingAttempts"] == 0
    assert (
        await postgres.fetchval(
            """
            SELECT COUNT(*)
            FROM "TranscriptTag" tt
            JOIN "Transcript" tr ON tr.id = tt."transcriptId"
            JOIN "Tag" tag ON tag.id = tt."tagId"
            WHERE tr."userId" <> tag."userId"
            """
        )
        == 0
    )
    assert (
        await postgres.fetchval(
            """
            SELECT COUNT(*)
            FROM "Tag"
            WHERE "userId" = 'user-1'
              AND slug = 'nao-deve-existir'
            """
        )
        == 0
    )

    applied = await db.apply_tags_to_transcript(
        user_id="user-1",
        transcript_id="transcript-1",
        tag_names=["Permitida"],
        current_folder_id=None,
    )
    assert applied == ["Permitida"]
    assert await db.list_transcript_tag_names("user-1", "transcript-1") == ["Permitida"]


async def test_inline_and_reconciler_share_one_atomic_tag_claim(
    postgres: asyncpg.Connection,
) -> None:
    await _insert_user(postgres, "user-1")
    await _insert_transcript(postgres, transcript_id="race", user_id="user-1")

    inline_claimed, reconciler_claims = await asyncio.gather(
        db.start_tag_enrichment("user-1", "race"),
        db.claim_pending_tag_enrichments(limit=1),
    )

    reconciler_owns_row = any(str(row["id"]) == "race" for row in reconciler_claims)
    assert int(inline_claimed) + int(reconciler_owns_row) == 1
    state = await postgres.fetchrow(
        """
        SELECT "taggingStatus", "taggingAttempts"
        FROM "Transcript"
        WHERE id = 'race'
        """
    )
    assert state["taggingStatus"] == "RUNNING"
    assert state["taggingAttempts"] == 1


async def test_changed_transcript_is_delivered_to_brain_reindexer(
    monkeypatch: pytest.MonkeyPatch,
    postgres: asyncpg.Connection,
) -> None:
    await _insert_user(postgres, "user-1")
    transcript_updated = datetime.now(UTC).replace(tzinfo=None)
    await _insert_transcript(
        postgres,
        transcript_id="transcript-1",
        user_id="user-1",
        updated_at=transcript_updated,
    )
    await postgres.execute(
        """
        INSERT INTO "BrainNode" (
          id, "userId", key, type, label, status, metadata,
          "sourceType", "sourceId", "createdAt", "updatedAt"
        ) VALUES (
          'node-1', 'user-1', 'TRANSCRIPT:transcript-1',
          'CONTENT'::"BrainNodeType", 'Antigo', 'ACTIVE'::"ContentStatus",
          '{"topicIndexVersion":"1"}'::jsonb, 'TRANSCRIPT'::"BrainSourceType",
          'transcript-1', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours'
        )
        """
    )
    reindex = AsyncMock(return_value=True)
    monkeypatch.setattr(db, "reindex_transcript_brain_node", reindex)

    assert await db.reindex_missing_transcript_brain_nodes(limit=10) == 1
    reindex.assert_awaited_once_with("user-1", "transcript-1")

    await postgres.execute(
        """
        UPDATE "BrainNode"
        SET "updatedAt" = NOW() + INTERVAL '1 hour'
        WHERE id = 'node-1'
        """
    )
    reindex.reset_mock()
    assert await db.reindex_missing_transcript_brain_nodes(limit=10) == 0
    reindex.assert_not_awaited()
