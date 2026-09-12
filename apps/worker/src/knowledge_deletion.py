"""Durable, idempotent deletion of user-owned knowledge resources."""

from __future__ import annotations

import asyncio
from collections.abc import Iterable
from typing import Any

from . import db, events, storage
from .graph_index_lease import GraphIndexLease, acquire_graph_index_lease
from .pipeline_errors import DeferredJobError

_GRAPH_SOURCE_TYPE = {
    "TRANSCRIPT": "TRANSCRIPT",
    "NOTE": "NOTE",
    "LIBRARY_FOLDER": "FOLDER",
    "TRANSCRIPT_ENRICHMENT": "EXTERNAL_ENRICHMENT",
}

GRAPH_LEASE_ACQUIRE_ATTEMPTS = 5
GRAPH_LEASE_RETRY_AFTER_SECONDS = 30


async def _acquire_graph_lease(user_id: str) -> GraphIndexLease:
    for attempt in range(GRAPH_LEASE_ACQUIRE_ATTEMPTS):
        lease = await acquire_graph_index_lease(user_id)
        if lease is not None:
            return lease
        await asyncio.sleep(min(0.25 + attempt * 0.05, 1.0))
    raise DeferredJobError(
        "knowledge graph lease is temporarily unavailable",
        retry_after_seconds=GRAPH_LEASE_RETRY_AFTER_SECONDS,
    )


async def _assert_graph_lease(lease: GraphIndexLease) -> None:
    if not await lease.renew():
        raise RuntimeError("knowledge graph deletion lease was lost")


async def _delete_graph_sources(
    conn: Any,
    *,
    user_id: str,
    source_type: str,
    source_ids: Iterable[str],
) -> None:
    ids = list(dict.fromkeys(source_ids))
    if not ids:
        return
    edge_ids = await conn.fetch(
        """
        SELECT DISTINCT "edgeId"
        FROM "BrainSource"
        WHERE "userId" = $1
          AND "sourceType" = $2::"BrainSourceType"
          AND "sourceId" = ANY($3::text[])
          AND "edgeId" IS NOT NULL
        """,
        user_id,
        source_type,
        ids,
    )
    await conn.execute(
        """
        DELETE FROM "BrainSource"
        WHERE "userId" = $1
          AND "sourceType" = $2::"BrainSourceType"
          AND "sourceId" = ANY($3::text[])
        """,
        user_id,
        source_type,
        ids,
    )
    await conn.execute(
        """
        DELETE FROM "BrainEntityAlias"
        WHERE "userId" = $1
          AND "sourceType" = $2::"BrainSourceType"
          AND "sourceId" = ANY($3::text[])
        """,
        user_id,
        source_type,
        ids,
    )
    await conn.execute(
        """
        DELETE FROM "BrainFact" fact
        WHERE fact."userId" = $1
          AND NOT EXISTS (
            SELECT 1 FROM "BrainSource" source WHERE source."factId" = fact.id
          )
        """,
        user_id,
    )
    affected_edge_ids = [str(row["edgeId"]) for row in edge_ids if row["edgeId"]]
    if affected_edge_ids:
        await conn.execute(
            """
            DELETE FROM "BrainEdge" edge
            WHERE edge."userId" = $1
              AND edge.id = ANY($2::text[])
              AND edge.method <> 'manual'
              AND NOT EXISTS (
                SELECT 1 FROM "BrainSource" source WHERE source."edgeId" = edge.id
              )
            """,
            user_id,
            affected_edge_ids,
        )
    await conn.execute(
        """
        DELETE FROM "BrainNode"
        WHERE "userId" = $1
          AND "sourceType" = $2::"BrainSourceType"
          AND "sourceId" = ANY($3::text[])
        """,
        user_id,
        source_type,
        ids,
    )
    await conn.execute(
        """
        DELETE FROM "BrainNode" node
        WHERE node."userId" = $1
          AND node."sourceType" IS NULL
          AND node."updatedAt" < NOW() - INTERVAL '2 minutes'
          AND (
            (node.type = 'TOPIC'::"BrainNodeType" AND node.metadata->>'method' = 'keyword')
            OR (
              node.type = 'ENTITY'::"BrainNodeType"
              AND node.metadata->>'method' IN ('entity-heuristic', 'llm-grounded')
            )
            OR (
              node.type = 'CLAIM'::"BrainNodeType"
              AND node.metadata->>'method' = 'llm-grounded'
            )
          )
          AND NOT EXISTS (
            SELECT 1 FROM "BrainEdge" edge
            WHERE edge."userId" = node."userId"
              AND (edge."fromNodeId" = node.id OR edge."toNodeId" = node.id)
          )
        """,
        user_id,
    )


async def _delete_storage_keys(keys: Iterable[str | None]) -> None:
    for key in dict.fromkeys(key for key in keys if key):
        await storage.delete_object(key=key)


async def _delete_transcript(job_id: str, user_id: str, target_id: str) -> None:
    async with db.connection() as conn:
        refresh_lock_key = f"voxen:source-refresh:{target_id}"
        await conn.execute("SELECT pg_advisory_lock(hashtext($1))", refresh_lock_key)
        try:
            lease = await _acquire_graph_lease(user_id)
            try:
                async with lease.heartbeat(), conn.transaction():
                    await db.assert_job_lease_in_connection(conn, job_id=job_id, user_id=user_id)
                    await _assert_graph_lease(lease)
                    locked = await conn.fetchrow(
                        """
                        SELECT transcript.id, transcript.status, transcript."mdPath",
                               transcript."originalObjectKey", transcript."previewObjectKey",
                               media.id AS "savedMediaId",
                               media."objectKey" AS "savedMediaObjectKey"
                        FROM "Transcript" transcript
                        LEFT JOIN "SavedMedia" media ON media."transcriptId" = transcript.id
                        WHERE transcript.id = $1 AND transcript."userId" = $2
                        FOR UPDATE OF transcript
                        """,
                        target_id,
                        user_id,
                    )
                    if locked and str(locked["status"]) != "TRASH":
                        raise RuntimeError(
                            "transcript must remain in trash until deletion completes"
                        )
                    versions = await conn.fetch(
                        """
                        SELECT "mdPath" FROM "SourceContentVersion"
                        WHERE "transcriptId" = $1 AND "userId" = $2
                        """,
                        target_id,
                        user_id,
                    )
                    if locked:
                        saved_key = locked["savedMediaObjectKey"]
                        await _delete_storage_keys(
                            [
                                locked["mdPath"],
                                locked["previewObjectKey"],
                                (
                                    None
                                    if locked["originalObjectKey"] == saved_key
                                    else locked["originalObjectKey"]
                                ),
                                *(row["mdPath"] for row in versions),
                            ]
                        )
                    if locked and locked["savedMediaId"]:
                        if locked["savedMediaObjectKey"]:
                            await conn.execute(
                                """
                                UPDATE "SavedMedia"
                                SET status = 'READY'::"SavedMediaStatus", "transcriptId" = NULL,
                                    "processedAt" = NULL, "errorMsg" = NULL, "updatedAt" = NOW()
                                WHERE id = $1 AND "userId" = $2
                                """,
                                locked["savedMediaId"],
                                user_id,
                            )
                        else:
                            await conn.execute(
                                """
                                UPDATE "SavedMedia"
                                SET status = 'FAILED'::"SavedMediaStatus", "transcriptId" = NULL,
                                    "processedAt" = NULL,
                                    "errorMsg" = 'O arquivo original não está mais disponível.',
                                    "updatedAt" = NOW()
                                WHERE id = $1 AND "userId" = $2
                                """,
                                locked["savedMediaId"],
                                user_id,
                            )
                    await _delete_graph_sources(
                        conn,
                        user_id=user_id,
                        source_type="TRANSCRIPT",
                        source_ids=[target_id],
                    )
                    await conn.execute(
                        'DELETE FROM "Transcript" WHERE id = $1 AND "userId" = $2',
                        target_id,
                        user_id,
                    )
            finally:
                await lease.release()
        finally:
            await conn.execute("SELECT pg_advisory_unlock(hashtext($1))", refresh_lock_key)


async def _owned_tree_ids(conn: Any, table: str, user_id: str, root_id: str) -> list[str]:
    if table == "Note":
        query = """
        WITH RECURSIVE tree AS (
          SELECT id, "userId" FROM "Note" WHERE id = $1
          UNION
          SELECT child.id, child."userId"
          FROM "Note" child
          JOIN tree parent ON child."parentId" = parent.id
        )
        SELECT id, "userId" FROM tree
        """
    elif table == "LibraryFolder":
        query = """
        WITH RECURSIVE tree AS (
          SELECT id, "userId" FROM "LibraryFolder" WHERE id = $1
          UNION
          SELECT child.id, child."userId"
          FROM "LibraryFolder" child
          JOIN tree parent ON child."parentId" = parent.id
        )
        SELECT id, "userId" FROM tree
        """
    else:
        raise ValueError("unsupported tree table")
    rows = await conn.fetch(query, root_id)
    if not rows:
        return []
    if any(str(row["userId"]) != user_id for row in rows):
        raise RuntimeError("cross-workspace tree relation rejected")
    return [str(row["id"]) for row in rows]


async def _owned_library_forest_ids(conn: Any, user_id: str) -> list[str]:
    rows = await conn.fetch(
        """
        WITH RECURSIVE tree AS (
          SELECT id, "userId" FROM "LibraryFolder" WHERE "userId" = $1
          UNION
          SELECT child.id, child."userId"
          FROM "LibraryFolder" child
          JOIN tree parent ON child."parentId" = parent.id
        )
        SELECT id, "userId" FROM tree
        """,
        user_id,
    )
    if any(str(row["userId"]) != user_id for row in rows):
        raise RuntimeError("cross-workspace folder relation rejected")
    return [str(row["id"]) for row in rows]


async def _delete_note(job_id: str, user_id: str, target_id: str) -> None:
    lease = await _acquire_graph_lease(user_id)
    try:
        async with lease.heartbeat(), db.connection() as conn, conn.transaction():
            await db.assert_job_lease_in_connection(conn, job_id=job_id, user_id=user_id)
            await _assert_graph_lease(lease)
            ids = await _owned_tree_ids(conn, "Note", user_id, target_id)
            await _delete_graph_sources(
                conn, user_id=user_id, source_type="NOTE", source_ids=ids or [target_id]
            )
            await conn.execute(
                'DELETE FROM "Note" WHERE id = $1 AND "userId" = $2', target_id, user_id
            )
    finally:
        await lease.release()


async def _delete_saved_media(job_id: str, user_id: str, target_id: str) -> None:
    async with db.connection() as conn:
        media = await conn.fetchrow(
            """
            SELECT id, "objectKey", status, "transcriptId"
            FROM "SavedMedia" WHERE id = $1 AND "userId" = $2
            """,
            target_id,
            user_id,
        )
    if media:
        if media["transcriptId"] or str(media["status"]) == "PROCESSED":
            raise RuntimeError("processed saved media remains linked to its transcript")
        if str(media["status"]) in {"QUEUED", "DOWNLOADING", "PROCESSING"}:
            raise RuntimeError("saved media is still being processed")
        await _delete_storage_keys([media["objectKey"]])
    async with db.connection() as conn, conn.transaction():
        await db.assert_job_lease_in_connection(conn, job_id=job_id, user_id=user_id)
        await conn.execute(
            'DELETE FROM "SavedMedia" WHERE id = $1 AND "userId" = $2 AND "transcriptId" IS NULL',
            target_id,
            user_id,
        )


async def _delete_library_folders(job_id: str, user_id: str, target_id: str) -> None:
    lease = await _acquire_graph_lease(user_id)
    try:
        async with lease.heartbeat(), db.connection() as conn, conn.transaction():
            await db.assert_job_lease_in_connection(conn, job_id=job_id, user_id=user_id)
            await _assert_graph_lease(lease)
            if target_id == "*":
                ids = await _owned_library_forest_ids(conn, user_id)
                transcript_rows = await conn.fetch(
                    'SELECT id FROM "Transcript" WHERE "userId" = $1 '
                    'AND "folderId" = ANY($2::text[])',
                    user_id,
                    ids,
                )
                await _delete_graph_sources(
                    conn, user_id=user_id, source_type="FOLDER", source_ids=ids
                )
                await conn.execute('DELETE FROM "LibraryFolder" WHERE "userId" = $1', user_id)
            else:
                ids = await _owned_tree_ids(conn, "LibraryFolder", user_id, target_id)
                transcript_rows = await conn.fetch(
                    'SELECT id FROM "Transcript" WHERE "userId" = $1 '
                    'AND "folderId" = ANY($2::text[])',
                    user_id,
                    ids,
                )
                await _delete_graph_sources(
                    conn,
                    user_id=user_id,
                    source_type="FOLDER",
                    source_ids=ids or [target_id],
                )
                await conn.execute(
                    'DELETE FROM "LibraryFolder" WHERE id = $1 AND "userId" = $2',
                    target_id,
                    user_id,
                )
            transcript_ids = [str(row["id"]) for row in transcript_rows]
            if transcript_ids:
                await conn.execute(
                    """
                    UPDATE "BrainNode"
                    SET metadata = COALESCE(metadata, '{}'::jsonb) - 'folderId',
                        "updatedAt" = NOW()
                    WHERE "userId" = $1
                      AND "sourceType" = 'TRANSCRIPT'::"BrainSourceType"
                      AND "sourceId" = ANY($2::text[])
                    """,
                    user_id,
                    transcript_ids,
                )
    finally:
        await lease.release()


async def _delete_transcript_enrichment(job_id: str, user_id: str, target_id: str) -> None:
    lease = await _acquire_graph_lease(user_id)
    try:
        async with lease.heartbeat(), db.connection() as conn, conn.transaction():
            await db.assert_job_lease_in_connection(conn, job_id=job_id, user_id=user_id)
            await _assert_graph_lease(lease)
            await _delete_graph_sources(
                conn,
                user_id=user_id,
                source_type="EXTERNAL_ENRICHMENT",
                source_ids=[target_id],
            )
            await conn.execute(
                'DELETE FROM "TranscriptEnrichment" WHERE id = $1 AND "userId" = $2',
                target_id,
                user_id,
            )
    finally:
        await lease.release()


async def run(
    *,
    job_id: str,
    user_id: str,
    target_type: str,
    target_id: str,
    log: Any,
) -> None:
    if target_type not in {
        "TRANSCRIPT",
        "NOTE",
        "SAVED_MEDIA",
        "LIBRARY_FOLDER",
        "TRANSCRIPT_ENRICHMENT",
    }:
        raise ValueError("unsupported knowledge deletion target")

    log.info("knowledge-deletion-started", target_type=target_type, target_id=target_id)
    await events.publish_job_event(user_id, job_id, "deleting_content", percent=15)
    if target_type == "TRANSCRIPT":
        await events.publish_job_event(user_id, job_id, "deleting_storage", percent=30)
        await _delete_transcript(job_id, user_id, target_id)
    elif target_type == "NOTE":
        await _delete_note(job_id, user_id, target_id)
    elif target_type == "SAVED_MEDIA":
        await events.publish_job_event(user_id, job_id, "deleting_storage", percent=30)
        await _delete_saved_media(job_id, user_id, target_id)
    elif target_type == "LIBRARY_FOLDER":
        await _delete_library_folders(job_id, user_id, target_id)
    else:
        await _delete_transcript_enrichment(job_id, user_id, target_id)

    if target_type in _GRAPH_SOURCE_TYPE:
        await events.publish_job_event(user_id, job_id, "updating_graph", percent=85)
        await events.publish_graph_invalidation(user_id)
    await db.mark_job_done(job_id)
    await events.publish_job_event(user_id, job_id, "done", percent=100)
    log.info("knowledge-deletion-done", target_type=target_type, target_id=target_id)
