from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import asyncpg
import pytest

from src import db, research_db, voxen_settings
from src.source_freshness import mark_reviewable_derivatives_stale
from src.voxen_crypto import encrypt

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="PostgreSQL integration test requires DATABASE_URL",
)

_TEST_MASTER_KEY = b"0123456789abcdef0123456789abcdef"


@pytest.fixture(autouse=True)
def research_master_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(voxen_settings, "_master_key_cache", _TEST_MASTER_KEY)


@pytest.fixture
async def postgres() -> AsyncIterator[asyncpg.Connection]:
    await db.close_pool()
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    await conn.execute(
        """
        TRUNCATE TABLE
          "TranscriptTag", "Tag", "BrainNode", "Job", "TranscriptEnrichment",
          "Transcript", "ConfigRevision", "Setting", "LibraryFolder", "User"
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
              "TranscriptTag", "Tag", "BrainNode", "Job", "TranscriptEnrichment",
              "Transcript", "ConfigRevision", "Setting", "LibraryFolder", "User"
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


async def _set_research_policy(conn: asyncpg.Connection, mode: str) -> None:
    encrypted = encrypt(mode, _TEST_MASTER_KEY)
    await conn.execute(
        """
        DELETE FROM "Setting"
        WHERE scope = 'GLOBAL'::"SettingScope" AND "userId" IS NULL
          AND key = 'summary_research_mode'
        """
    )
    await conn.execute(
        """
        INSERT INTO "Setting" (
          id, scope, "userId", key, "valueEnc", "createdAt", "updatedAt"
        ) VALUES (
          $1, 'GLOBAL'::"SettingScope", NULL, 'summary_research_mode', $2,
          NOW(), NOW()
        )
        """,
        f"research-policy-{mode.lower()}",
        encrypted,
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
    status: str = "ACTIVE",
) -> None:
    await conn.execute(
        """
        INSERT INTO "Transcript" (
          id, "userId", status, source, url, title, "durationSec", language,
          "transcriptionMethod", "mdPath", "plainText", frontmatter,
          "taggingStatus", "taggingAttempts", "taggingStartedAt",
          "taggingNextAttemptAt", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $10::"ContentStatus", 'YOUTUBE'::"TranscriptSource",
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
        status,
    )


async def _insert_research_enrichment(
    conn: asyncpg.Connection,
    *,
    enrichment_id: str,
    transcript_id: str,
    user_id: str,
    trigger: str,
    status: str = "PENDING",
) -> None:
    await conn.execute(
        """
        INSERT INTO "TranscriptEnrichment" (
          id, "userId", "transcriptId", "runKey", type, status,
          "reviewState", trigger, title, content, citations, queries,
          "sourceVersion", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, $1, 'WEB_RESEARCH'::"TranscriptEnrichmentType",
          $5::"TranscriptEnrichmentStatus",
          'SUGGESTED'::"TranscriptEnrichmentReviewState",
          $4::"TranscriptEnrichmentTrigger", '', '', '[]'::jsonb,
          '[]'::jsonb, 0, NOW(), NOW()
        )
        """,
        enrichment_id,
        user_id,
        transcript_id,
        trigger,
        status,
    )


async def test_research_claim_reconciles_policy_trigger_and_parent_lifecycle(
    postgres: asyncpg.Connection,
) -> None:
    await _set_research_policy(postgres, "MANUAL")
    await _insert_user(postgres, "research-user")
    for transcript_id in ("auto-parent", "manual-parent", "mcp-parent", "running-parent"):
        await _insert_transcript(
            postgres,
            transcript_id=transcript_id,
            user_id="research-user",
        )
    await _insert_transcript(
        postgres,
        transcript_id="archived-parent",
        user_id="research-user",
        status="ARCHIVED",
    )
    await _insert_research_enrichment(
        postgres,
        enrichment_id="auto-research",
        transcript_id="auto-parent",
        user_id="research-user",
        trigger="AUTO",
    )
    await _insert_research_enrichment(
        postgres,
        enrichment_id="manual-research",
        transcript_id="manual-parent",
        user_id="research-user",
        trigger="MANUAL",
    )
    await postgres.execute(
        """
        INSERT INTO "Job" (
          id, "userId", type, status, "sourceUrl", "transcriptId",
          "queuedAt", "finishedAt"
        ) VALUES (
          'manual-job', 'research-user', 'DOWNLOAD_AND_TRANSCRIBE'::"JobType",
          'DONE'::"JobStatus", 'https://example.test/manual-parent',
          'manual-parent', NOW(), NOW()
        )
        """
    )
    await _insert_research_enrichment(
        postgres,
        enrichment_id="mcp-research",
        transcript_id="mcp-parent",
        user_id="research-user",
        trigger="MCP",
    )
    await _insert_research_enrichment(
        postgres,
        enrichment_id="running-parent-research",
        transcript_id="running-parent",
        user_id="research-user",
        trigger="MANUAL",
    )
    await postgres.execute(
        """
        INSERT INTO "Job" (
          id, "userId", type, status, "sourceUrl", "transcriptId", "queuedAt"
        ) VALUES (
          'running-parent-job', 'research-user', 'DOWNLOAD_AND_TRANSCRIBE'::"JobType",
          'RUNNING'::"JobStatus", 'https://example.test/running-parent',
          'running-parent', NOW()
        )
        """
    )
    await _insert_research_enrichment(
        postgres,
        enrichment_id="archived-research",
        transcript_id="archived-parent",
        user_id="research-user",
        trigger="MANUAL",
    )

    transitions = await research_db.reconcile_transcript_enrichment_lifecycle()
    assert {str(row["id"]) for row in transitions} == {
        "auto-research",
        "archived-research",
    }
    assert all(row["stage"] == "research_cancelled" for row in transitions)

    claimed = await research_db.claim_pending_transcript_enrichments(limit=10)
    assert {str(row["id"]) for row in claimed} == {"manual-research", "mcp-research"}
    claimed_by_id = {str(row["id"]): row for row in claimed}
    assert claimed_by_id["manual-research"]["jobId"] == "manual-job"
    assert claimed_by_id["manual-research"]["sourceUrl"] == ("https://example.test/manual-parent")
    assert claimed_by_id["mcp-research"]["jobId"] is None
    assert "running-parent-research" not in claimed_by_id

    states = {
        str(row["id"]): (str(row["status"]), row["staleReason"])
        for row in await postgres.fetch(
            """
            SELECT id, status, "staleReason"
            FROM "TranscriptEnrichment"
            WHERE "userId" = 'research-user'
            """
        )
    }
    assert states["auto-research"] == ("CANCELLED", "research-policy-changed")
    assert states["archived-research"] == ("CANCELLED", "parent-inactive")
    assert states["manual-research"] == ("RUNNING", None)
    assert states["mcp-research"] == ("RUNNING", None)
    assert states["running-parent-research"] == ("PENDING", None)

    await postgres.execute(
        """
        UPDATE "Job"
        SET status = 'DONE'::"JobStatus", "finishedAt" = NOW()
        WHERE id = 'running-parent-job'
        """
    )
    after_parent_done = await research_db.claim_pending_transcript_enrichments(limit=10)
    assert [str(row["id"]) for row in after_parent_done] == ["running-parent-research"]
    assert after_parent_done[0]["jobId"] == "running-parent-job"

    await _set_research_policy(postgres, "OFF")
    off_transitions = await research_db.reconcile_transcript_enrichment_lifecycle()
    assert {str(row["id"]) for row in off_transitions} == {
        "manual-research",
        "mcp-research",
        "running-parent-research",
    }
    assert await research_db.claim_pending_transcript_enrichments(limit=10) == []
    running_after_off = await postgres.fetch(
        """
        SELECT id, status, "staleReason", "cancelRequestedAt"
        FROM "TranscriptEnrichment"
        WHERE id IN ('manual-research', 'mcp-research', 'running-parent-research')
        ORDER BY id
        """
    )
    assert all(row["status"] == "CANCELLED" for row in running_after_off)
    assert all(row["staleReason"] == "research-policy-changed" for row in running_after_off)
    assert all(row["cancelRequestedAt"] is not None for row in running_after_off)

    await postgres.execute(
        """
        UPDATE "Transcript"
        SET status = 'ACTIVE'::"ContentStatus", "archivedAt" = NULL,
            "updatedAt" = NOW()
        WHERE id = 'archived-parent'
        """
    )
    await _set_research_policy(postgres, "AUTO")
    assert await research_db.claim_pending_transcript_enrichments(limit=10) == []
    assert (
        await postgres.fetchval(
            'SELECT status FROM "TranscriptEnrichment" WHERE id = $1',
            "archived-research",
        )
        == "CANCELLED"
    )


async def test_policy_transition_serializes_auto_queue_and_claim(
    postgres: asyncpg.Connection,
) -> None:
    await _set_research_policy(postgres, "AUTO")
    await _insert_user(postgres, "policy-race-user")
    await _insert_transcript(
        postgres,
        transcript_id="policy-race-parent",
        user_id="policy-race-user",
    )
    await _insert_research_enrichment(
        postgres,
        enrichment_id="policy-race-auto",
        transcript_id="policy-race-parent",
        user_id="policy-race-user",
        trigger="AUTO",
    )
    await _insert_research_enrichment(
        postgres,
        enrichment_id="policy-race-manual",
        transcript_id="policy-race-parent",
        user_id="policy-race-user",
        trigger="MANUAL",
    )

    transition = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        async with transition.transaction():
            await transition.execute(
                "SELECT pg_advisory_xact_lock(hashtext('voxen:global-settings'))"
            )
            await _set_research_policy(transition, "MANUAL")
            queue_task = asyncio.create_task(
                research_db.queue_auto_transcript_enrichment(
                    "policy-race-user", "policy-race-parent"
                )
            )
            claim_task = asyncio.create_task(
                research_db.claim_pending_transcript_enrichments(limit=10)
            )
            await asyncio.sleep(0.05)
            assert not queue_task.done()
            assert not claim_task.done()

        assert not await queue_task
        claimed = await claim_task
    finally:
        await transition.close()

    assert {str(row["id"]) for row in claimed} == {"policy-race-manual"}
    transitions = await research_db.reconcile_transcript_enrichment_lifecycle()
    assert [str(row["id"]) for row in transitions] == ["policy-race-auto"]
    states = {
        str(row["id"]): str(row["status"])
        for row in await postgres.fetch(
            """
            SELECT id, status FROM "TranscriptEnrichment"
            WHERE id IN ('policy-race-auto', 'policy-race-manual')
            """
        )
    }
    assert states == {
        "policy-race-auto": "CANCELLED",
        "policy-race-manual": "RUNNING",
    }


async def test_auto_enqueue_serializes_archive_and_immediate_restore(
    postgres: asyncpg.Connection,
) -> None:
    await _set_research_policy(postgres, "AUTO")
    await _insert_user(postgres, "lifecycle-race-user")
    await _insert_transcript(
        postgres,
        transcript_id="lifecycle-race-parent",
        user_id="lifecycle-race-user",
    )
    await postgres.execute(
        """
        CREATE OR REPLACE FUNCTION voxen_test_delay_research_enqueue()
        RETURNS trigger AS $$
        BEGIN
          IF NEW."transcriptId" = 'lifecycle-race-parent' THEN
            PERFORM pg_sleep(0.35);
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )
    await postgres.execute(
        """
        CREATE TRIGGER voxen_test_delay_research_enqueue
        BEFORE INSERT ON "TranscriptEnrichment"
        FOR EACH ROW EXECUTE FUNCTION voxen_test_delay_research_enqueue()
        """
    )

    async def archive_and_restore() -> None:
        lifecycle = await asyncpg.connect(os.environ["DATABASE_URL"])
        try:
            async with lifecycle.transaction():
                await lifecycle.execute(
                    """
                    UPDATE "Transcript"
                    SET status = 'ARCHIVED'::"ContentStatus", "archivedAt" = NOW(),
                        "updatedAt" = NOW()
                    WHERE id = 'lifecycle-race-parent'
                    """
                )
                await lifecycle.execute(
                    """
                    UPDATE "TranscriptEnrichment"
                    SET status = 'CANCELLED'::"TranscriptEnrichmentStatus",
                        "cancelRequestedAt" = NOW(), "startedAt" = NULL,
                        "nextAttemptAt" = NULL, "staleReason" = 'parent-inactive',
                        "updatedAt" = NOW()
                    WHERE "transcriptId" = 'lifecycle-race-parent'
                      AND status IN (
                        'PENDING'::"TranscriptEnrichmentStatus",
                        'RETRY'::"TranscriptEnrichmentStatus",
                        'RUNNING'::"TranscriptEnrichmentStatus"
                      )
                    """
                )
            await lifecycle.execute(
                """
                UPDATE "Transcript"
                SET status = 'ACTIVE'::"ContentStatus", "archivedAt" = NULL,
                    "updatedAt" = NOW()
                WHERE id = 'lifecycle-race-parent'
                """
            )
        finally:
            await lifecycle.close()

    try:
        enqueue_task = asyncio.create_task(
            research_db.queue_auto_transcript_enrichment(
                "lifecycle-race-user", "lifecycle-race-parent"
            )
        )
        await asyncio.sleep(0.05)
        lifecycle_task = asyncio.create_task(archive_and_restore())
        await asyncio.sleep(0.05)
        assert not lifecycle_task.done()
        assert await enqueue_task
        await lifecycle_task
    finally:
        await postgres.execute(
            'DROP TRIGGER IF EXISTS voxen_test_delay_research_enqueue ON "TranscriptEnrichment"'
        )
        await postgres.execute("DROP FUNCTION IF EXISTS voxen_test_delay_research_enqueue()")

    restored = await postgres.fetchrow(
        """
        SELECT t.status AS parent_status, e.status, e."staleReason"
        FROM "Transcript" t
        JOIN "TranscriptEnrichment" e ON e."transcriptId" = t.id
        WHERE t.id = 'lifecycle-race-parent'
        """
    )
    assert restored is not None
    assert restored["parent_status"] == "ACTIVE"
    assert restored["status"] == "CANCELLED"
    assert restored["staleReason"] == "parent-inactive"


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
        claim_attempt=6,
        correction_revision=0,
        source_version=0,
        source_checksum=None,
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
    assert await db.start_tag_enrichment("user-1", "transcript-2") is None
    await db.finish_tag_enrichment(
        "user-1",
        "transcript-2",
        status="COMPLETE",
        claim_attempt=1,
        correction_revision=0,
        source_version=0,
        source_checksum=None,
    )
    assert (
        await db.apply_tags_to_transcript(
            user_id="user-1",
            transcript_id="transcript-2",
            tag_names=["Não deve existir"],
            current_folder_id=None,
            claim_attempt=1,
            correction_revision=0,
            source_version=0,
            source_checksum=None,
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

    claim = await db.start_tag_enrichment("user-1", "transcript-1")
    assert claim is not None
    applied = await db.apply_tags_to_transcript(
        user_id="user-1",
        transcript_id="transcript-1",
        tag_names=["Permitida"],
        current_folder_id=None,
        claim_attempt=int(claim["taggingAttempt"]),
        correction_revision=int(claim["correctionRevision"]),
        source_version=int(claim["sourceVersion"]),
        source_checksum=(str(claim["sourceChecksum"]) if claim["sourceChecksum"] else None),
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
    assert int(bool(inline_claimed)) + int(reconciler_owns_row) == 1
    state = await postgres.fetchrow(
        """
        SELECT "taggingStatus", "taggingAttempts"
        FROM "Transcript"
        WHERE id = 'race'
        """
    )
    assert state["taggingStatus"] == "RUNNING"
    assert state["taggingAttempts"] == 1


async def test_tag_claim_cannot_write_after_a_transcript_correction(
    postgres: asyncpg.Connection,
) -> None:
    await _insert_user(postgres, "user-1")
    await _insert_transcript(postgres, transcript_id="corrected", user_id="user-1")
    claim = await db.start_tag_enrichment("user-1", "corrected")
    assert claim == {
        "taggingAttempt": 1,
        "correctionRevision": 0,
        "sourceVersion": 0,
        "sourceChecksum": None,
    }
    await postgres.execute(
        """
        UPDATE "Transcript"
        SET "correctionRevision" = 1,
            "taggingStatus" = 'PENDING'::"EnrichmentStatus",
            "taggingAttempts" = 0
        WHERE id = 'corrected'
        """
    )

    assert (
        await db.apply_tags_to_transcript(
            user_id="user-1",
            transcript_id="corrected",
            tag_names=["Obsoleta"],
            current_folder_id=None,
            claim_attempt=1,
            correction_revision=0,
            source_version=0,
            source_checksum=None,
        )
        == []
    )
    await db.finish_tag_enrichment(
        "user-1",
        "corrected",
        status="COMPLETE",
        claim_attempt=1,
        correction_revision=0,
        source_version=0,
        source_checksum=None,
    )
    state = await postgres.fetchrow(
        'SELECT "taggingStatus", "correctionRevision" FROM "Transcript" WHERE id = $1',
        "corrected",
    )
    assert state["taggingStatus"] == "PENDING"
    assert state["correctionRevision"] == 1
    assert await db.list_transcript_tag_names("user-1", "corrected") == []


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


async def test_source_refresh_marker_is_durable_until_reconciliation(
    monkeypatch: pytest.MonkeyPatch,
    postgres: asyncpg.Connection,
) -> None:
    await _insert_user(postgres, "refresh-user")
    await _insert_transcript(
        postgres,
        transcript_id="refresh-transcript",
        user_id="refresh-user",
        updated_at=datetime.now(UTC).replace(tzinfo=None),
    )
    await postgres.execute(
        """
        INSERT INTO "BrainNode" (
          id, "userId", key, type, label, description, status, metadata,
          "sourceType", "sourceId", "createdAt", "updatedAt"
        ) VALUES (
          'refresh-node', 'refresh-user', 'TRANSCRIPT:refresh-transcript',
          'CONTENT'::"BrainNodeType", 'Old title', 'Old content',
          'ACTIVE'::"ContentStatus",
          '{"brainIndexVersion":3,"topicIndexVersion":1,"embedding":[0.1]}'::jsonb,
          'TRANSCRIPT'::"BrainSourceType", 'refresh-transcript', NOW(), NOW()
        )
        """
    )

    async with postgres.transaction():
        await mark_reviewable_derivatives_stale(
            postgres, "refresh-user", "refresh-transcript", 2, "checksum-2"
        )

    metadata = await postgres.fetchval(
        'SELECT metadata FROM "BrainNode" WHERE id = $1', "refresh-node"
    )
    assert "brainIndexVersion" not in metadata
    assert "topicIndexVersion" not in metadata
    assert "embedding" not in metadata

    reindex = AsyncMock(return_value=True)
    monkeypatch.setattr(db, "reindex_transcript_brain_node", reindex)
    assert await db.reindex_missing_transcript_brain_nodes(limit=10) == 1
    reindex.assert_awaited_once_with("refresh-user", "refresh-transcript")
