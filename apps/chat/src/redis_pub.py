"""Publisher Redis — usado pela tool transcribe_video pra notificar o worker."""

from __future__ import annotations

import os

import redis.asyncio as aredis

_client: aredis.Redis | None = None


def _redis_url() -> str:
    return os.environ.get("REDIS_URL", "redis://localhost:6379")


async def get_redis() -> aredis.Redis:
    global _client
    if _client is None:
        _client = aredis.from_url(_redis_url(), decode_responses=True)
    return _client


async def publish_new_job(job_id: str) -> None:
    """Publica jobId no canal jobs:new — worker consome e processa."""
    client = await get_redis()
    await client.publish("jobs:new", job_id)
