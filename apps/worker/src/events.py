"""Publica eventos de progresso no canal Redis `jobs:<userId>:<jobId>`."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from typing import Any

import redis.asyncio as aredis

_client: aredis.Redis | None = None


def redis_url() -> str:
    return os.environ.get("REDIS_URL", "redis://localhost:6379")


async def get_redis() -> aredis.Redis:
    global _client
    if _client is None:
        _client = aredis.from_url(redis_url(), decode_responses=True)  # type: ignore[no-untyped-call]
    return _client


async def close_redis() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def job_channel(user_id: str, job_id: str) -> str:
    return f"jobs:{user_id}:{job_id}"


JOBS_NEW_CHANNEL = "jobs:new"


async def publish_job_event(
    user_id: str,
    job_id: str,
    stage: str,
    *,
    percent: int | None = None,
    chunk_index: int | None = None,
    transcript_id: str | None = None,
    error_msg: str | None = None,
) -> None:
    payload: dict[str, Any] = {
        "jobId": job_id,
        "stage": stage,
        "ts": datetime.now(UTC).isoformat(),
    }
    if percent is not None:
        payload["percent"] = percent
    if chunk_index is not None:
        payload["chunkIndex"] = chunk_index
    if transcript_id is not None:
        payload["transcriptId"] = transcript_id
    if error_msg is not None:
        payload["errorMsg"] = error_msg
    client = await get_redis()
    await client.publish(job_channel(user_id, job_id), json.dumps(payload))
