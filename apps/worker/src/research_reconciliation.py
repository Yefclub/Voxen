"""Durable dispatcher for transcript research enrichments."""

from __future__ import annotations

import asyncio
from typing import Any

import structlog

from . import research_db as research_db
from . import research_enrichment as research_enrichment
from .safe_diagnostics import error_diagnostic

log = structlog.get_logger(__name__)


def _track_task(tasks: set[asyncio.Task[None]], coroutine: Any) -> None:  # noqa: ANN401
    task = asyncio.create_task(coroutine)
    tasks.add(task)
    task.add_done_callback(tasks.discard)


async def _run_with_sem(sem: asyncio.Semaphore, item: dict[str, Any]) -> None:
    async with sem:
        try:
            await research_enrichment.process(item, log)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.error(
                "research-reconciliation-task-failed",
                enrichment_id=item["id"],
                **error_diagnostic(exc, "RESEARCH_RECONCILIATION_FAILED"),
            )


async def reconcile_once(
    sem: asyncio.Semaphore,
    tasks: set[asyncio.Task[None]],
    limit: int = 4,
    max_in_flight: int = 2,
) -> int:
    """Claim and dispatch due research while failing closed on reconciliation errors."""
    try:
        await research_db.reconcile_transcript_enrichment_lifecycle()
        capacity = min(limit, max(0, max_in_flight - len(tasks)))
        pending = await research_db.claim_pending_transcript_enrichments(limit=capacity)
    except Exception as exc:  # noqa: BLE001 -- do not starve the other queues
        log.error("research-claim-failed", **error_diagnostic(exc, "RESEARCH_CLAIM_FAILED"))
        return 0
    for item in pending:
        _track_task(tasks, _run_with_sem(sem, item))
    return len(pending)
