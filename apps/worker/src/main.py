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

from . import automation, db, events, ytdl
from .cancellation import cancel_subscriber
from .pipeline import _maybe_generate_tags, process_job
from .safe_diagnostics import error_diagnostic

log = structlog.get_logger(__name__)

MAX_CONCURRENCY = 2
RECONCILIATION_INTERVAL_SEC = 60
AUTOMATION_SCHEDULER_INTERVAL_SEC = 60
AUTOMATION_MAX_CONCURRENCY = 2


async def _process_with_sem(sem: asyncio.Semaphore, job_id: str) -> None:
    async with sem:
        try:
            await process_job(job_id)
        except Exception as exc:  # noqa: BLE001
            log.error(
                "process_job-crashed",
                job_id=job_id,
                **error_diagnostic(exc, "PROCESS_JOB_CRASHED"),
            )


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
        except Exception as exc:  # noqa: BLE001
            log.error(
                "reconciliation-failed",
                **error_diagnostic(exc, "JOB_RECONCILIATION_FAILED"),
            )
        try:
            indexed = await db.reindex_missing_transcript_brain_nodes(limit=50)
            if indexed:
                log.info("brain-reconciliation-indexed", count=indexed)
        except Exception as exc:  # noqa: BLE001
            log.error(
                "brain-reconciliation-failed",
                **error_diagnostic(exc, "BRAIN_RECONCILIATION_FAILED"),
            )
        try:
            pending_tags = await _reconcile_tags_once()
            if pending_tags:
                log.info("tag-reconciliation-processed", count=pending_tags)
        except Exception as exc:  # noqa: BLE001
            log.error(
                "tag-reconciliation-failed",
                **error_diagnostic(exc, "TAG_RECONCILIATION_FAILED"),
            )
        try:
            await asyncio.wait_for(stop.wait(), timeout=RECONCILIATION_INTERVAL_SEC)
        except TimeoutError:
            continue


async def _reconcile_tags_once(limit: int = 10) -> int:
    pending_tags = await db.claim_pending_tag_enrichments(limit=limit)
    for item in pending_tags:
        await _maybe_generate_tags(
            user_id=item["userId"],
            job_id=item.get("jobId"),
            transcript_id=item["id"],
            log=log,
            already_claimed=True,
        )
    return len(pending_tags)


async def _process_automation_run(sem: asyncio.Semaphore, run_id: str) -> None:
    async with sem:
        try:
            await automation.process_run(run_id)
        except Exception as exc:  # noqa: BLE001
            log.error(
                "process-automation-run-crashed",
                run_id=run_id,
                **error_diagnostic(exc, "AUTOMATION_RUN_CRASHED"),
            )


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
    """A cada 60s:
    (a) dispara scheduler_tick que cria runs de automações vencidas;
    (b) faz reconciliation de runs PENDING órfãos;
    (c) reap de RUNNING zumbis (worker crashou entre claim e finish).
    """
    while not stop.is_set():
        try:
            await automation.scheduler_tick()
        except Exception as exc:  # noqa: BLE001
            log.error(
                "automation-scheduler-failed",
                **error_diagnostic(exc, "AUTOMATION_SCHEDULER_FAILED"),
            )
        try:
            pending = await automation.list_pending_run_ids(limit=10)
            for run_id in pending:
                asyncio.create_task(_process_automation_run(sem, run_id))
        except Exception as exc:  # noqa: BLE001
            log.error(
                "automation-reconciliation-failed",
                **error_diagnostic(exc, "AUTOMATION_RECONCILIATION_FAILED"),
            )
        try:
            await automation.reap_stale_running_runs()
        except Exception as exc:  # noqa: BLE001
            log.error(
                "automation-stale-reaper-failed",
                **error_diagnostic(exc, "AUTOMATION_STALE_REAPER_FAILED"),
            )
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
        **ytdl.runtime_versions(),
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
    try:
        asyncio.run(amain())
    except Exception as exc:  # noqa: BLE001 — boundary impede traceback externo no stderr
        log.error(
            "worker-runtime-failed",
            **error_diagnostic(exc, "WORKER_RUNTIME_FAILED"),
        )
        raise SystemExit(1) from None
    raise SystemExit(0)


if __name__ == "__main__":
    main()
