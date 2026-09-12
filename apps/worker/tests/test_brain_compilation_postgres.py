from __future__ import annotations

import asyncio
import json
import os
import uuid
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest

from src import brain_compilation_db, brain_extract, brain_temporal_store, db

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
            await brain_compilation_db.claim_segments(
                user_id=f"foreign-{suffix}",
                compilation_id=compilation_id,
                segment_keys=[segment_key],
                worker_id="foreign-worker",
                limit=1,
            )
            == []
        )

        first_claims = await asyncio.gather(
            brain_compilation_db.claim_segments(
                user_id=user_id,
                compilation_id=compilation_id,
                segment_keys=[segment_key],
                worker_id="worker-a",
                limit=1,
            ),
            brain_compilation_db.claim_segments(
                user_id=user_id,
                compilation_id=compilation_id,
                segment_keys=[segment_key],
                worker_id="worker-b",
                limit=1,
            ),
        )
        assert sum(len(batch) for batch in first_claims) == 1

        live_claim = await conn.fetchrow(
            'SELECT status, "claimedBy", "leaseExpiresAt" '
            'FROM "BrainCompilationSegment" WHERE id = $1',
            segment_id,
        )
        assert live_claim is not None
        await brain_compilation_db.mark_compilation_skipped(
            user_id=f"foreign-{suffix}", compilation_id=compilation_id
        )
        await brain_compilation_db.mark_compilation_skipped(
            user_id=user_id, compilation_id=compilation_id
        )
        preserved_claim = await conn.fetchrow(
            'SELECT status, "claimedBy", "leaseExpiresAt" '
            'FROM "BrainCompilationSegment" WHERE id = $1',
            segment_id,
        )
        assert preserved_claim == live_claim

        await conn.execute(
            'UPDATE "BrainCompilationSegment" SET "leaseExpiresAt" = $2 WHERE id = $1',
            segment_id,
            now - timedelta(seconds=1),
        )
        recovered_claims = await asyncio.gather(
            brain_compilation_db.claim_segments(
                user_id=user_id,
                compilation_id=compilation_id,
                segment_keys=[segment_key],
                worker_id="worker-c",
                limit=1,
            ),
            brain_compilation_db.claim_segments(
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
        for attempt in range(2, brain_compilation_db.GROUNDED_SEGMENT_MAX_ATTEMPTS + 1):
            await brain_compilation_db.mark_segment_failed(
                user_id=user_id,
                compilation_id=compilation_id,
                segment_key=segment_key,
                error="PROVIDER_UNAVAILABLE",
                worker_id=owner,
            )
            if attempt == brain_compilation_db.GROUNDED_SEGMENT_MAX_ATTEMPTS:
                break
            await conn.execute(
                'UPDATE "BrainCompilationSegment" SET "nextAttemptAt" = $2 WHERE id = $1',
                segment_id,
                now - timedelta(seconds=1),
            )
            claim = await brain_compilation_db.claim_segments(
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
            "attempts": brain_compilation_db.GROUNDED_SEGMENT_MAX_ATTEMPTS,
            "nextAttemptAt": None,
        }
        assert (
            await brain_compilation_db.claim_segments(
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


async def test_temporal_facts_and_entity_aliases_are_idempotent_and_user_scoped() -> None:
    assert os.environ.get("DATABASE_URL")
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    suffix = uuid.uuid4().hex
    user_id = f"temporal-user-{suffix}"
    foreign_user_id = f"temporal-foreign-{suffix}"
    subject_id = f"temporal-subject-{suffix}"
    object_id = f"temporal-object-{suffix}"
    edge_id = f"temporal-edge-{suffix}"
    transcript_id = f"transcript-{suffix}"
    observed_at = datetime.now(UTC)
    now = observed_at.replace(tzinfo=None)
    try:
        await conn.executemany(
            """
            INSERT INTO "User" (id, email, name, status, role, "createdAt", "updatedAt")
            VALUES ($1, $2, $3, 'APPROVED', 'USER', $4, $4)
            """,
            [
                (user_id, f"{user_id}@example.test", "Temporal Owner", now),
                (foreign_user_id, f"{foreign_user_id}@example.test", "Temporal Foreign", now),
            ],
        )
        await conn.execute(
            """
            INSERT INTO "Transcript" (
              id, "userId", source, url, title, "durationSec", language,
              "transcriptionMethod", "mdPath", "plainText", frontmatter,
              "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, 'WEB', $3, 'Temporal source', 0, 'en', 'SCRAPE',
              'temporal.md', 'Ana worked at Acme', '{}'::jsonb, $4, $4
            )
            """,
            transcript_id,
            user_id,
            f"https://example.test/{transcript_id}",
            now,
        )
        await conn.executemany(
            """
            INSERT INTO "BrainNode" (
              id, "userId", key, type, label, status, metadata, "createdAt", "updatedAt"
            ) VALUES ($1, $2, $3, 'ENTITY', $4, 'ACTIVE', $5::jsonb, $6, $6)
            """,
            [
                (
                    subject_id,
                    user_id,
                    f"ENTITY:person:ana:{suffix}",
                    "Ana",
                    '{"entityType":"PERSON"}',
                    now,
                ),
                (
                    object_id,
                    user_id,
                    f"ENTITY:organization:acme:{suffix}",
                    "Acme",
                    '{"entityType":"ORGANIZATION"}',
                    now,
                ),
            ],
        )
        await conn.execute(
            """
            INSERT INTO "BrainEdge" (
              id, "userId", "fromNodeId", "toNodeId", kind, method, "createdAt", "updatedAt"
            ) VALUES ($1, $2, $3, $4, 'RELATED_TO', 'llm-grounded-relation', $5, $5)
            """,
            edge_id,
            user_id,
            subject_id,
            object_id,
            now,
        )

        first_id = await brain_temporal_store.upsert_fact(
            conn,
            user_id=user_id,
            edge_id=edge_id,
            from_node_id=subject_id,
            to_node_id=object_id,
            kind="RELATED_TO",
            predicate="worked_at",
            valid_from="2020-01-01T00:00:00Z",
            valid_to="2022-01-01T00:00:00Z",
            observed_at=observed_at,
            confidence=0.7,
            evidence_version="source:1:correction:0",
        )
        second_id = await brain_temporal_store.upsert_fact(
            conn,
            user_id=user_id,
            edge_id=edge_id,
            from_node_id=subject_id,
            to_node_id=object_id,
            kind="RELATED_TO",
            predicate="worked_at",
            valid_from="2020-01-01T00:00:00Z",
            valid_to="2022-01-01T00:00:00Z",
            observed_at=observed_at + timedelta(hours=1),
            confidence=0.9,
            evidence_version="source:1:correction:0",
        )
        await brain_temporal_store.upsert_entity_aliases(
            conn,
            user_id=user_id,
            transcript_id=transcript_id,
            segment_key="lines:1-10",
            entity_node_id=subject_id,
            label="Ana",
            aliases=("Ana Maria",),
            entity_type="PERSON",
            confidence=0.92,
            evidence_version="source:1:correction:0",
        )

        fact = await conn.fetchrow(
            'SELECT id, confidence::float, "observedAt" FROM "BrainFact" WHERE id = $1',
            first_id,
        )
        assert first_id == second_id
        assert fact is not None
        assert fact["confidence"] == pytest.approx(0.9)
        assert abs(fact["observedAt"] - observed_at) < timedelta(milliseconds=1)
        await conn.execute('UPDATE "BrainFact" SET "invalidatedAt" = NOW() WHERE id = $1', first_id)
        next_version_id = await brain_temporal_store.upsert_fact(
            conn,
            user_id=user_id,
            edge_id=edge_id,
            from_node_id=subject_id,
            to_node_id=object_id,
            kind="RELATED_TO",
            predicate="worked_at",
            valid_from="2020-01-01T00:00:00Z",
            valid_to="2022-01-01T00:00:00Z",
            observed_at=observed_at + timedelta(hours=2),
            confidence=0.8,
            evidence_version="source:2:correction:0",
        )
        assert next_version_id != first_id
        versions = await conn.fetch(
            'SELECT id, "invalidatedAt" FROM "BrainFact" WHERE "userId" = $1 ORDER BY id',
            user_id,
        )
        assert len(versions) == 2
        assert {row["id"] for row in versions if row["invalidatedAt"] is not None} == {first_id}
        assert {row["id"] for row in versions if row["invalidatedAt"] is None} == {next_version_id}
        assert (
            await conn.fetchval('SELECT COUNT(*) FROM "BrainFact" WHERE "userId" = $1', user_id)
            == 2
        )

        owner_candidates = await brain_temporal_store.entity_alias_candidates(
            conn, user_id=user_id, names=("Ana Maria",)
        )
        foreign_candidates = await brain_temporal_store.entity_alias_candidates(
            conn, user_id=foreign_user_id, names=("Ana Maria",)
        )
        assert [(candidate.node_id, candidate.entity_type) for candidate in owner_candidates] == [
            (subject_id, "PERSON")
        ]
        assert foreign_candidates == []
    finally:
        await conn.execute(
            'DELETE FROM "User" WHERE id = ANY($1::text[])', [user_id, foreign_user_id]
        )
        await conn.close()


async def test_concurrent_homonyms_without_strong_alias_evidence_stay_separate() -> None:
    assert os.environ.get("DATABASE_URL")
    suffix = uuid.uuid4().hex
    user_id = f"homonym-user-{suffix}"
    transcript_a = f"homonym-transcript-a-{suffix}"
    transcript_b = f"homonym-transcript-b-{suffix}"
    setup = await asyncpg.connect(os.environ["DATABASE_URL"])
    conn_a = await asyncpg.connect(os.environ["DATABASE_URL"])
    conn_b = await asyncpg.connect(os.environ["DATABASE_URL"])
    now = datetime.now(UTC).replace(tzinfo=None)
    try:
        await setup.execute(
            """
            INSERT INTO "User" (id, email, name, status, role, "createdAt", "updatedAt")
            VALUES ($1, $2, 'Homonym Test', 'APPROVED', 'USER', $3, $3)
            """,
            user_id,
            f"{user_id}@example.test",
            now,
        )
        await setup.executemany(
            """
            INSERT INTO "Transcript" (
              id, "userId", source, url, title, "durationSec", language,
              "transcriptionMethod", "mdPath", "plainText", frontmatter,
              "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, 'WEB', $3, $4, 0, 'pt', 'SCRAPE', $5, $6, '{}'::jsonb, $7, $7
            )
            """,
            [
                (
                    transcript_a,
                    user_id,
                    f"https://example.test/{transcript_a}",
                    "Alex Silva in engineering",
                    f"{transcript_a}.md",
                    "Alex Silva leads an engineering team.",
                    now,
                ),
                (
                    transcript_b,
                    user_id,
                    f"https://example.test/{transcript_b}",
                    "Alex Silva in music",
                    f"{transcript_b}.md",
                    "Alex Silva released an independent album.",
                    now,
                ),
            ],
        )

        first_id, second_id = await asyncio.gather(
            brain_temporal_store.resolve_entity_node(
                conn_a,
                user_id=user_id,
                transcript_id=transcript_a,
                segment_key="lines:1-5",
                label="Alex Silva",
                entity_type="PERSON",
                aliases=(),
                excerpt="Alex Silva leads an engineering team.",
            ),
            brain_temporal_store.resolve_entity_node(
                conn_b,
                user_id=user_id,
                transcript_id=transcript_b,
                segment_key="lines:1-5",
                label="Alex Silva",
                entity_type="PERSON",
                aliases=(),
                excerpt="Alex Silva released an independent album.",
            ),
        )

        assert first_id != second_id
        assert (
            await setup.fetchval(
                'SELECT COUNT(*) FROM "BrainNode" WHERE "userId" = $1 AND label = $2',
                user_id,
                "Alex Silva",
            )
            == 2
        )
    finally:
        await setup.execute('DELETE FROM "User" WHERE id = $1', user_id)
        await conn_a.close()
        await conn_b.close()
        await setup.close()


async def test_parser_local_refs_preserve_same_excerpt_homonyms_in_storage() -> None:
    assert os.environ.get("DATABASE_URL")
    suffix = uuid.uuid4().hex
    user_id = f"local-ref-user-{suffix}"
    transcript_id = f"local-ref-transcript-{suffix}"
    source = "Alex Silva e Alex Silva apresentaram juntos o projeto Atlas."
    raw = json.dumps(
        {
            "entities": [
                {
                    "id": "alex-one",
                    "label": "Alex Silva",
                    "excerpt": "Alex Silva e Alex Silva apresentaram juntos",
                },
                {
                    "id": "alex-two",
                    "label": "Alex Silva",
                    "excerpt": "Alex Silva e Alex Silva apresentaram juntos",
                },
            ]
        }
    )
    items = brain_extract.parse_grounded_payload(raw, source)
    assert [item.local_ref for item in items] == ["alex-one", "alex-two"]

    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        await conn.execute(
            """
            INSERT INTO "User" (id, email, name, status, role, "createdAt", "updatedAt")
            VALUES ($1, $2, 'Local Ref Test', 'APPROVED', 'USER', NOW(), NOW())
            """,
            user_id,
            f"{user_id}@example.test",
        )
        await conn.execute(
            """
            INSERT INTO "Transcript" (
              id, "userId", source, url, title, "durationSec", language,
              "transcriptionMethod", "mdPath", "plainText", frontmatter,
              "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, 'WEB', $3, 'Homonyms', 0, 'pt', 'SCRAPE', $4, $5,
              '{}'::jsonb, NOW(), NOW()
            )
            """,
            transcript_id,
            user_id,
            f"https://example.test/{transcript_id}",
            f"{transcript_id}.md",
            source,
        )

        node_ids: list[str] = []
        for item in items:
            node_ids.append(
                await brain_temporal_store.resolve_entity_node(
                    conn,
                    user_id=user_id,
                    transcript_id=transcript_id,
                    segment_key="segment-1",
                    label=item.label,
                    entity_type=item.entity_type,
                    aliases=item.aliases,
                    excerpt=item.excerpt,
                    local_ref=item.local_ref,
                    excluded_node_ids=set(node_ids),
                )
            )

        assert len(set(node_ids)) == 2
        assert (
            await conn.fetchval(
                'SELECT COUNT(*) FROM "BrainNode" WHERE id = ANY($1::text[])', node_ids
            )
            == 2
        )
    finally:
        await conn.execute('DELETE FROM "User" WHERE id = $1', user_id)
        await conn.close()


async def test_recompilation_withdraws_current_facts_without_deleting_the_ledger() -> None:
    assert os.environ.get("DATABASE_URL")
    suffix = uuid.uuid4().hex
    user_id = f"ledger-user-{suffix}"
    transcript_id = f"ledger-transcript-{suffix}"
    subject_id = f"ledger-subject-{suffix}"
    object_id = f"ledger-object-{suffix}"
    edge_id = f"ledger-edge-{suffix}"
    fact_id = f"ledger-fact-{suffix}"
    source_id = f"ledger-source-{suffix}"
    alias_id = f"ledger-alias-{suffix}"
    compilation_id = f"ledger-compilation-{suffix}"
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        await conn.execute(
            """
            INSERT INTO "User" (id, email, name, status, role, "createdAt", "updatedAt")
            VALUES ($1, $2, 'Ledger Test', 'APPROVED', 'USER', NOW(), NOW())
            """,
            user_id,
            f"{user_id}@example.test",
        )
        await conn.execute(
            """
            INSERT INTO "Transcript" (
              id, "userId", source, url, title, "durationSec", language,
              "transcriptionMethod", "mdPath", "plainText", frontmatter,
              "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, 'WEB', $3, 'Ledger source', 0, 'en', 'SCRAPE',
              'ledger.md', 'Ana worked at Acme', '{}'::jsonb, NOW(), NOW()
            )
            """,
            transcript_id,
            user_id,
            f"https://example.test/{transcript_id}",
        )
        await conn.executemany(
            """
            INSERT INTO "BrainNode" (
              id, "userId", key, type, label, status, metadata, "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3, 'ENTITY', $4, 'ACTIVE',
              '{"method":"llm-grounded","entityType":"PERSON"}'::jsonb, NOW(), NOW()
            )
            """,
            [
                (subject_id, user_id, f"ENTITY:person:ana:{suffix}", "Ana"),
                (object_id, user_id, f"ENTITY:organization:acme:{suffix}", "Acme"),
            ],
        )
        await conn.execute(
            """
            INSERT INTO "BrainEdge" (
              id, "userId", "fromNodeId", "toNodeId", kind, method, status,
              "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3, $4, 'RELATED_TO', 'llm-grounded-relation', 'ACTIVE', NOW(), NOW()
            )
            """,
            edge_id,
            user_id,
            subject_id,
            object_id,
        )
        await conn.execute(
            """
            INSERT INTO "BrainFact" (
              id, "userId", "edgeId", "factKey", predicate, "observedAt", method,
              "createdAt", "updatedAt"
            ) VALUES ($1, $2, $3, $4, 'worked_at', NOW(), 'llm-grounded-temporal', NOW(), NOW())
            """,
            fact_id,
            user_id,
            edge_id,
            f"ledger:{suffix}",
        )
        await conn.execute(
            """
            INSERT INTO "BrainSource" (
              id, "userId", "edgeId", "factId", "sourceType", "sourceId",
              "segmentKey", "evidenceKey", excerpt, "createdAt"
            ) VALUES (
              $1, $2, $3, $4, 'TRANSCRIPT', $5, 'lines:1-5', $6,
              'Ana worked at Acme', NOW()
            )
            """,
            source_id,
            user_id,
            edge_id,
            fact_id,
            transcript_id,
            f"ledger-source:{suffix}",
        )
        await conn.execute(
            """
            INSERT INTO "BrainEntityAlias" (
              id, "userId", "entityNodeId", alias, "normalizedAlias", "entityType",
              confidence, method, "sourceType", "sourceId", "segmentKey", "evidenceKey",
              "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3, 'Ana', 'ana', 'PERSON', 0.9, 'llm-grounded-alias',
              'TRANSCRIPT', $4, 'lines:1-5', $5, NOW(), NOW()
            )
            """,
            alias_id,
            user_id,
            subject_id,
            transcript_id,
            f"ledger-alias:{suffix}",
        )
        await conn.execute(
            """
            INSERT INTO "BrainCompilation" (
              id, "userId", "transcriptId", "contentHash", status,
              "totalSegments", "completedSegments", "createdAt", "updatedAt"
            ) VALUES ($1, $2, $3, 'old-hash', 'COMPLETED', 0, 0, NOW(), NOW())
            """,
            compilation_id,
            user_id,
            transcript_id,
        )

        await db.prepare_grounded_brain_compilation(
            user_id=user_id,
            transcript_id=transcript_id,
            content_hash="new-hash",
            segments=[],
            correction_revision=0,
            source_version=0,
            source_checksum=None,
        )

        assert await conn.fetchval('SELECT COUNT(*) FROM "BrainFact" WHERE id = $1', fact_id) == 1
        assert (
            await conn.fetchval('SELECT "invalidatedAt" FROM "BrainFact" WHERE id = $1', fact_id)
            is not None
        )
        assert (
            await conn.fetchval(
                'SELECT "invalidatedAt" FROM "BrainSource" WHERE id = $1', source_id
            )
            is not None
        )
        assert (
            await conn.fetchval(
                'SELECT "invalidatedAt" FROM "BrainEntityAlias" WHERE id = $1', alias_id
            )
            is not None
        )
        assert (
            await conn.fetchval('SELECT status::text FROM "BrainEdge" WHERE id = $1', edge_id)
            == "ARCHIVED"
        )
        assert (
            await conn.fetchval(
                'SELECT COUNT(*) FROM "BrainNode" WHERE id = ANY($1::text[]) AND status::text = $2',
                [subject_id, object_id],
                "ARCHIVED",
            )
            == 2
        )
    finally:
        await conn.execute('DELETE FROM "User" WHERE id = $1', user_id)
        await conn.close()


async def test_source_refresh_rejects_stale_prepare_and_short_content_completion() -> None:
    assert os.environ.get("DATABASE_URL")
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    suffix = uuid.uuid4().hex
    user_id = f"brain-refresh-user-{suffix}"
    transcript_id = f"brain-refresh-transcript-{suffix}"
    compilation_id = f"brain-refresh-compilation-{suffix}"
    now = datetime.now(UTC).replace(tzinfo=None)
    try:
        await conn.execute(
            """
            INSERT INTO "User" (id, email, name, status, role, "createdAt", "updatedAt")
            VALUES ($1, $2, 'Brain Refresh Test', 'APPROVED', 'USER', $3, $3)
            """,
            user_id,
            f"brain-refresh-{suffix}@example.test",
            now,
        )
        await conn.execute(
            """
            INSERT INTO "Transcript" (
              id, "userId", source, url, title, "durationSec", language,
              "transcriptionMethod", "mdPath", "plainText", frontmatter,
              "sourceVersion", "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, 'WEB', 'https://example.test/refresh', 'Refresh', 0, 'pt',
              'SCRAPE', 'refresh.md', 'old content', '{}'::jsonb, 0, $3, $3
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
            ) VALUES ($1, $2, $3, 'old-placeholder', 'PENDING', 1, 0, $4, $4)
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
            ) VALUES ($1, $2, 'old-placeholder', 'PENDING', 1, 1, 0, $3, $3)
            """,
            f"brain-refresh-segment-{suffix}",
            compilation_id,
            now,
        )
        await conn.execute(
            """
            UPDATE "Transcript"
            SET "sourceVersion" = 1, "sourceChecksum" = 'new-source'
            WHERE id = $1
            """,
            transcript_id,
        )

        assert not await brain_compilation_db.mark_transcript_compilation_skipped(
            user_id=user_id,
            transcript_id=transcript_id,
            correction_revision=0,
            source_version=0,
            source_checksum=None,
        )
        assert (
            await conn.fetchval(
                'SELECT status FROM "BrainCompilationSegment" WHERE "compilationId" = $1',
                compilation_id,
            )
            == "PENDING"
        )
        with pytest.raises(db.GroundedCompilationClaimLostError):
            await db.prepare_grounded_brain_compilation(
                user_id=user_id,
                transcript_id=transcript_id,
                content_hash="stale-content",
                segments=[],
                correction_revision=0,
                source_version=0,
                source_checksum=None,
            )
        assert (
            await conn.fetchval(
                'SELECT "contentHash" FROM "BrainCompilation" WHERE id = $1', compilation_id
            )
            == "old-placeholder"
        )
    finally:
        await conn.execute('DELETE FROM "User" WHERE id = $1', user_id)
        await conn.close()
