"""Set de jobs cancelados em memória + subscriber do canal jobs:cancel.

O endpoint POST /api/jobs/:id/cancel publica o job_id no canal Redis
`jobs:cancel`. O worker mantém um set in-memory dos ids recebidos e o
pipeline checa cooperativamente entre etapas.
"""

from __future__ import annotations

import asyncio

import structlog

from .events import JOBS_CANCEL_CHANNEL, get_redis

log = structlog.get_logger(__name__)

_cancelled: set[str] = set()


def is_cancelled(job_id: str) -> bool:
    return job_id in _cancelled


def mark_cancelled(job_id: str) -> None:
    _cancelled.add(job_id)


def clear_cancelled(job_id: str) -> None:
    _cancelled.discard(job_id)


async def cancel_subscriber(stop: asyncio.Event) -> None:
    """Listener do canal jobs:cancel — popula `_cancelled` em tempo real."""
    client = await get_redis()
    pubsub = client.pubsub()
    await pubsub.subscribe(JOBS_CANCEL_CHANNEL)
    log.info("subscribed", channel=JOBS_CANCEL_CHANNEL)
    try:
        while not stop.is_set():
            msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if msg is None:
                continue
            job_id = msg.get("data")
            if isinstance(job_id, str) and job_id:
                _cancelled.add(job_id)
                log.info("cancel-received", job_id=job_id)
    finally:
        await pubsub.unsubscribe(JOBS_CANCEL_CHANNEL)
        await pubsub.aclose()  # type: ignore[no-untyped-call]


class CancelledException(Exception):  # noqa: N818 — nome consagrado, paralelo a asyncio.CancelledError
    """Levantada quando o job é cancelado em pontos de checagem."""
