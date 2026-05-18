"""Voxen Worker — entrypoint asyncio.

Arquitetura (spec 002):
  1. Subscribe Redis pub/sub `jobs:new` (publicado pelo web ao criar Job)
  2. Quando recebe notify, claim job no DB com SKIP LOCKED
  3. Processa em pipeline.process_job
  4. Semáforo limita concorrência (max 2 jobs simultâneos)

Reconciliação: ao iniciar e a cada 60s, escaneia Job(status=QUEUED) pra
pegar jobs perdidos (notify do Redis pode ter sumido).
"""

from __future__ import annotations

import asyncio
import signal
from typing import NoReturn

import structlog

from . import automation, db, events
from .cancellation import cancel_subscriber
from .pipeline import process_job

log = structlog.get_logger(__name__)

MAX_CONCURRENCY = 2
RECONCILIATION_INTERVAL_SEC = 60
AUTOMATION_SCHEDULER_INTERVAL_SEC = 60
AUTOMATION_MAX_CONCURRENCY = 2


async def _process_with_sem(sem: asyncio.Semaphore, job_id: str) -> None:
    async with sem:
        try:
            await process_job(job_id)
        except Exception:  # noqa: BLE001
            log.exception("process_job-crashed", job_id=job_id)


async def _subscriber_loop(sem: asyncio.Semaphore, stop: asyncio.Event) -> None:
    client = await events.get_redis()
    pubsub = client.pubsub()
    await pubsub.subscribe(events.JOBS_NEW_CHANNEL)
    log.info("subscribed", channel=events.JOBS_NEW_CHANNEL)
    try:
        while not stop.is_set():
            msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if msg is None:
                continue
            job_id = msg.get("data")
            if not isinstance(job_id, str) or not job_id:
                continue
            log.info("notify-received", job_id=job_id)
            asyncio.create_task(_process_with_sem(sem, job_id))
    finally:
        await pubsub.unsubscribe(events.JOBS_NEW_CHANNEL)
        await pubsub.aclose()  # type: ignore[no-untyped-call]


async def _reconciliation_loop(sem: asyncio.Semaphore, stop: asyncio.Event) -> None:
    """Garante que jobs órfãos em QUEUED são processados mesmo se notify se perdeu."""
    while not stop.is_set():
        try:
            ids = await db.list_queued_job_ids(limit=10)
            for job_id in ids:
                asyncio.create_task(_process_with_sem(sem, job_id))
        except Exception:  # noqa: BLE001
            log.exception("reconciliation-failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=RECONCILIATION_INTERVAL_SEC)
        except TimeoutError:
            continue


async def _process_automation_run(sem: asyncio.Semaphore, run_id: str) -> None:
    async with sem:
        try:
            await automation.process_run(run_id)
        except Exception:  # noqa: BLE001
            log.exception("process-automation-run-crashed", run_id=run_id)


async def _automation_subscriber_loop(sem: asyncio.Semaphore, stop: asyncio.Event) -> None:
    """Subscribe Redis pub/sub `automations:run` — manual triggers + scheduler."""
    client = await events.get_redis()
    pubsub = client.pubsub()
    await pubsub.subscribe(events.AUTOMATION_RUN_CHANNEL)
    log.info("subscribed-automations", channel=events.AUTOMATION_RUN_CHANNEL)
    try:
        while not stop.is_set():
            msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if msg is None:
                continue
            run_id = msg.get("data")
            if not isinstance(run_id, str) or not run_id:
                continue
            log.info("automation-notify-received", run_id=run_id)
            asyncio.create_task(_process_automation_run(sem, run_id))
    finally:
        await pubsub.unsubscribe(events.AUTOMATION_RUN_CHANNEL)
        await pubsub.aclose()  # type: ignore[no-untyped-call]


async def _automation_scheduler_loop(sem: asyncio.Semaphore, stop: asyncio.Event) -> None:
    """A cada 60s: (a) dispara scheduler_tick que cria runs de automações
    vencidas; (b) faz reconciliation de runs PENDING órfãos."""
    while not stop.is_set():
        try:
            await automation.scheduler_tick()
        except Exception:  # noqa: BLE001
            log.exception("automation-scheduler-failed")
        try:
            pending = await automation.list_pending_run_ids(limit=10)
            for run_id in pending:
                asyncio.create_task(_process_automation_run(sem, run_id))
        except Exception:  # noqa: BLE001
            log.exception("automation-reconciliation-failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=AUTOMATION_SCHEDULER_INTERVAL_SEC)
        except TimeoutError:
            continue


async def amain() -> None:
    sem = asyncio.Semaphore(MAX_CONCURRENCY)
    automation_sem = asyncio.Semaphore(AUTOMATION_MAX_CONCURRENCY)
    stop = asyncio.Event()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    log.info(
        "worker-starting",
        max_concurrency=MAX_CONCURRENCY,
        automation_max_concurrency=AUTOMATION_MAX_CONCURRENCY,
    )
    try:
        await asyncio.gather(
            _subscriber_loop(sem, stop),
            _reconciliation_loop(sem, stop),
            cancel_subscriber(stop),
            _automation_subscriber_loop(automation_sem, stop),
            _automation_scheduler_loop(automation_sem, stop),
        )
    finally:
        await db.close_pool()
        await events.close_redis()
        log.info("worker-stopped")


def main() -> NoReturn:
    asyncio.run(amain())
    raise SystemExit(0)


if __name__ == "__main__":
    main()
