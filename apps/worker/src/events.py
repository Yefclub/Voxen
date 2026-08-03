"""Publica eventos de progresso no canal Redis `jobs:<userId>:<jobId>`."""

from __future__ import annotations

import json
import os
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


def user_channel(user_id: str) -> str:
    return f"user:{user_id}:jobs"


def graph_invalidation_channel(user_id: str) -> str:
    return f"voxen:graph:v4:events:{user_id}"


JOBS_NEW_CHANNEL = "jobs:new"
JOBS_CANCEL_CHANNEL = "jobs:cancel"
AUTOMATION_RUN_CHANNEL = "automations:run"


async def publish_graph_invalidation(user_id: str) -> None:
    """Avisa a UI que o snapshot materializado mudou; Redis é best-effort."""
    try:
        client = await get_redis()
        keys = [
            key async for key in client.scan_iter(match=f"voxen:graph:v4:{user_id}:*", count=100)
        ]
        if keys:
            await client.delete(*keys)
        await client.publish(
            graph_invalidation_channel(user_id),
            json.dumps({"type": "invalidated"}),
        )
    except Exception:
        # A persistência do Brain é autoritativa e não pode falhar por causa do canal efêmero.
        return


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
    # Redis é efêmero: persiste primeiro para que quem entrar depois ou
    # reconectar receba um snapshot operacional verdadeiro.
    from . import db

    event_id, created_at = await db.record_job_progress(
        user_id=user_id,
        job_id=job_id,
        stage=stage,
        percent=percent,
        chunk_index=chunk_index,
        transcript_id=transcript_id,
        error_msg=error_msg,
    )
    payload: dict[str, Any] = {
        "id": event_id,
        "jobId": job_id,
        "stage": stage,
        "ts": created_at.isoformat(),
    }
    if percent is not None:
        payload["percent"] = percent
    if chunk_index is not None:
        payload["chunkIndex"] = chunk_index
    if transcript_id is not None:
        payload["transcriptId"] = transcript_id
    if error_msg is not None:
        payload["errorMsg"] = error_msg
    try:
        client = await get_redis()
        body = json.dumps(payload)
        # Redis reduz latência, mas o evento persistido acima é autoritativo.
        await client.publish(job_channel(user_id, job_id), body)
        await client.publish(user_channel(user_id), body)
    except Exception:
        # O reconciliador e o snapshot no Postgres mantêm o job executável e
        # observável mesmo durante indisponibilidade total do Redis.
        return
