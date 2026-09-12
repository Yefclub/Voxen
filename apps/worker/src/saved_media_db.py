"""Database state machine for user-owned saved media."""

from __future__ import annotations

from typing import Any

import asyncpg

from . import db
from .job_lease import JobLeaseLostError


async def link_job_transcript_in_connection(
    conn: asyncpg.Connection,
    job_id: str,
    transcript_id: str,
) -> None:
    token = db._job_token(job_id)
    if token:
        row = await conn.fetchrow(
            """
            UPDATE "Job" SET "transcriptId" = $2
            WHERE id = $1 AND status = 'RUNNING'
              AND "workerId" = $3 AND attempt = $4
              AND "leaseExpiresAt" >= NOW()
            RETURNING id, "savedMediaId"
            """,
            job_id,
            transcript_id,
            token.worker_id,
            token.attempt,
        )
        if row is None:
            raise JobLeaseLostError("job transcript link rejected by lease fence")
        saved_media_id = row["savedMediaId"]
    else:
        await conn.execute(
            'UPDATE "Job" SET "transcriptId" = $2 WHERE id = $1',
            job_id,
            transcript_id,
        )
        saved_media_id = None
    if saved_media_id:
        await conn.execute(
            """
            UPDATE "SavedMedia"
            SET status = 'PROCESSED', "transcriptId" = $2,
                "processedAt" = NOW(), "updatedAt" = NOW(), "errorMsg" = NULL
            WHERE id = $1
            """,
            saved_media_id,
            transcript_id,
        )


async def get(user_id: str, media_id: str) -> dict[str, Any] | None:
    async with db.connection() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, "sourceUrl", "canonicalUrl", status, title, channel, author,
                   "durationSec", "thumbnailUrl", "objectKey", filename, "mimeType"
            FROM "SavedMedia"
            WHERE id = $1 AND "userId" = $2
            """,
            media_id,
            user_id,
        )
    return dict(row) if row else None


async def mark_downloading(user_id: str, media_id: str) -> bool:
    async with db.connection() as conn:
        row = await conn.fetchrow(
            """
            UPDATE "SavedMedia"
            SET status = 'DOWNLOADING', "errorMsg" = NULL, "updatedAt" = NOW()
            WHERE id = $1 AND "userId" = $2
              AND status IN ('QUEUED', 'FAILED', 'DOWNLOADING')
            RETURNING id
            """,
            media_id,
            user_id,
        )
    return row is not None


async def complete_download(
    *,
    job_id: str,
    user_id: str,
    media_id: str,
    title: str,
    channel: str | None,
    author: str | None,
    duration_sec: int,
    thumbnail_url: str | None,
    object_key: str,
    filename: str,
    mime_type: str,
    byte_size: int,
    canonical_url: str,
) -> None:
    token = db._job_token(job_id)
    async with db.connection() as conn:
        async with conn.transaction():
            now = db._utcnow_naive()
            if token:
                job_row = await conn.fetchrow(
                    """
                    UPDATE "Job"
                    SET status = 'DONE', "finishedAt" = $2,
                        "heartbeatAt" = NULL, "leaseExpiresAt" = NULL
                    WHERE id = $1 AND status = 'RUNNING'
                      AND "workerId" = $3 AND attempt = $4
                      AND "leaseExpiresAt" >= $2
                    RETURNING id
                    """,
                    job_id,
                    now,
                    token.worker_id,
                    token.attempt,
                )
                if job_row is None:
                    raise JobLeaseLostError("saved media completion rejected by lease fence")
            else:
                await conn.execute(
                    'UPDATE "Job" SET status = \'DONE\', "finishedAt" = $2 WHERE id = $1',
                    job_id,
                    now,
                )
            media_row = await conn.fetchrow(
                """
                UPDATE "SavedMedia"
                SET status = 'READY', title = $3, channel = $4, author = $5,
                    "durationSec" = $6, "thumbnailUrl" = $7, "objectKey" = $8,
                    filename = $9, "mimeType" = $10, "byteSize" = $11,
                    "canonicalUrl" = $12, "readyAt" = NOW(), "updatedAt" = NOW(),
                    "errorMsg" = NULL
                WHERE id = $1 AND "userId" = $2 AND status = 'DOWNLOADING'
                RETURNING id
                """,
                media_id,
                user_id,
                title,
                channel,
                author,
                duration_sec,
                thumbnail_url,
                object_key,
                filename,
                mime_type,
                byte_size,
                canonical_url,
            )
            if media_row is None:
                raise JobLeaseLostError("saved media state changed before completion")


async def fail_job_and_media(
    job_id: str,
    user_id: str,
    media_id: str,
    error_msg: str,
) -> None:
    """Fail one leased attempt and restore its media in the same transaction."""
    token = db._job_token(job_id)
    if token is None:
        raise JobLeaseLostError("saved media failure requires an active job lease")
    now = db._utcnow_naive()
    async with db.connection() as conn:
        async with conn.transaction():
            job = await conn.fetchrow(
                """
                UPDATE "Job"
                SET status = 'FAILED', "errorMsg" = $2, "finishedAt" = $3,
                    "heartbeatAt" = NULL, "leaseExpiresAt" = NULL
                WHERE id = $1 AND "userId" = $4 AND "savedMediaId" = $5
                  AND status = 'RUNNING' AND "workerId" = $6 AND attempt = $7
                  AND "leaseExpiresAt" >= $3
                RETURNING type
                """,
                job_id,
                error_msg[:1000],
                now,
                user_id,
                media_id,
                token.worker_id,
                token.attempt,
            )
            if job is None or job["type"] not in {"DOWNLOAD_MEDIA", "UPLOAD_AND_TRANSCRIBE"}:
                raise JobLeaseLostError("saved media job failure rejected by lease fence")
            failed_status = "FAILED" if job["type"] == "DOWNLOAD_MEDIA" else "READY"
            expected_status = "DOWNLOADING" if job["type"] == "DOWNLOAD_MEDIA" else "PROCESSING"
            media = await conn.fetchrow(
                """
                UPDATE "SavedMedia"
                SET status = $3::"SavedMediaStatus", "errorMsg" = $4, "updatedAt" = $5
                WHERE id = $1 AND "userId" = $2 AND "transcriptId" IS NULL
                  AND status = $6::"SavedMediaStatus"
                RETURNING id
                """,
                media_id,
                user_id,
                failed_status,
                error_msg[:1000],
                now,
                expected_status,
            )
            if media is None:
                raise JobLeaseLostError("saved media failure rejected by state fence")
