"""Voxen Worker — entrypoint asyncio.

Arquitetura (spec 002):
  1. Subscribe Redis pub/sub `jobs:new` (publicado pelo web ao criar Job)
  2. Quando recebe notify, claim job no DB com SKIP LOCKED
  3. Processa em pipeline.process_job
  4. Semáforo limita concorrência (max 2 jobs simultâneos)

Reconciliação: ao iniciar e a cada 60s, recupera leases RUNNING vencidos e
escaneia Job(status=QUEUED) pra pegar jobs perdidos (notify pode ter sumido).
"""

from __future__ import annotations

import asyncio
import os
import signal
import socket
import uuid
from collections.abc import Coroutine
from typing import Any, NoReturn

import structlog

from . import (
    automation,
    brain_compilation,
    db,
    events,
    research_reconciliation,
    summary,
    ytdl,
)
from .cancellation import cancel_subscriber
from .pipeline import _maybe_generate_tags, process_job
from .safe_diagnostics import error_diagnostic

log = structlog.get_logger(__name__)
research_db = research_reconciliation.research_db
research_enrichment = research_reconciliation.research_enrichment

MAX_CONCURRENCY = 2
RECONCILIATION_INTERVAL_SEC = 60
AUTOMATION_SCHEDULER_INTERVAL_SEC = 60
AUTOMATION_MAX_CONCURRENCY = 2
ENRICHMENT_MAX_CONCURRENCY = 2
JOB_SHUTDOWN_GRACE_SEC = 30
_enrichment_queue_cursor = 0


def _track_task(
    tasks: set[asyncio.Task[None]],
    coroutine: Coroutine[Any, Any, None],
) -> None:
    task = asyncio.create_task(coroutine)
    tasks.add(task)
    task.add_done_callback(tasks.discard)


async def _process_with_sem(sem: asyncio.Semaphore, job_id: str, worker_id: str) -> None:
    async with sem:
        try:
            await process_job(job_id, worker_id)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.error(
                "process_job-crashed",
                job_id=job_id,
                **error_diagnostic(exc, "PROCESS_JOB_CRASHED"),
            )


async def _subscriber_loop(
    sem: asyncio.Semaphore,
    stop: asyncio.Event,
    worker_id: str,
    tasks: set[asyncio.Task[None]],
) -> None:
    while not stop.is_set():
        pubsub: Any | None = None
        try:
            client = await events.get_redis()
            pubsub = client.pubsub()
            await pubsub.subscribe(events.JOBS_NEW_CHANNEL)
            log.info("subscribed", channel=events.JOBS_NEW_CHANNEL)
            while not stop.is_set():
                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if msg is None:
                    continue
                job_id = msg.get("data")
                if not isinstance(job_id, str) or not job_id:
                    continue
                log.info("notify-received", job_id=job_id)
                _track_task(tasks, _process_with_sem(sem, job_id, worker_id))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 -- Redis é apenas aceleração
            log.warning(
                "jobs-subscriber-disconnected",
                **error_diagnostic(exc, "JOBS_SUBSCRIBER_DISCONNECTED"),
            )
        finally:
            if pubsub is not None:
                try:
                    await pubsub.aclose()
                except Exception as exc:  # noqa: BLE001 -- reconecta no próximo ciclo
                    log.warning("jobs-subscriber-close-failed", error_type=type(exc).__name__)
        try:
            await asyncio.wait_for(stop.wait(), timeout=1.0)
        except TimeoutError:
            continue


async def _reconciliation_loop(
    sem: asyncio.Semaphore,
    stop: asyncio.Event,
    worker_id: str,
    tasks: set[asyncio.Task[None]],
) -> None:
    """Garante que jobs órfãos em QUEUED são processados mesmo se notify se perdeu."""
    while not stop.is_set():
        try:
            await _reconcile_jobs_once(sem, worker_id, tasks)
        except Exception as exc:  # noqa: BLE001
            log.error(
                "reconciliation-failed",
                **error_diagnostic(exc, "JOB_RECONCILIATION_FAILED"),
            )
        try:
            await asyncio.wait_for(stop.wait(), timeout=RECONCILIATION_INTERVAL_SEC)
        except TimeoutError:
            continue


async def _enrichment_reconciliation_loop(
    sem: asyncio.Semaphore,
    stop: asyncio.Event,
    tasks: set[asyncio.Task[None]],
    worker_id: str = "reconciliation-worker",
) -> None:
    """Reconcilia melhorias em loop independente do reaper de jobs."""
    while not stop.is_set():
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
            (
                pending_summaries,
                pending_tags,
                pending_research,
                pending_brain,
            ) = await _reconcile_enrichments_once(sem, tasks, worker_id=worker_id)
            if pending_summaries:
                log.info("summary-reconciliation-dispatched", count=pending_summaries)
            if pending_tags:
                log.info("tag-reconciliation-dispatched", count=pending_tags)
            if pending_research:
                log.info("research-reconciliation-dispatched", count=pending_research)
            if pending_brain:
                log.info("brain-compilation-reconciliation-dispatched", count=pending_brain)
        except Exception as exc:  # noqa: BLE001
            log.error(
                "enrichment-reconciliation-failed",
                **error_diagnostic(exc, "SUMMARY_RECONCILIATION_FAILED"),
            )
        try:
            await asyncio.wait_for(stop.wait(), timeout=RECONCILIATION_INTERVAL_SEC)
        except TimeoutError:
            continue


async def _reconcile_jobs_once(
    sem: asyncio.Semaphore,
    worker_id: str,
    tasks: set[asyncio.Task[None]],
) -> None:
    recovered = await db.recover_expired_jobs()
    for item in recovered:
        if item["action"] == "failed":
            await events.publish_job_event(
                item["userId"],
                item["id"],
                "failed",
                error_msg=db.WORKER_INTERRUPTED_MESSAGE,
            )
    if recovered:
        log.info(
            "job-leases-recovered",
            requeued=sum(item["action"] == "requeued" for item in recovered),
            failed=sum(item["action"] == "failed" for item in recovered),
        )
    ids = await db.list_queued_job_ids(limit=10)
    for job_id in ids:
        _track_task(tasks, _process_with_sem(sem, job_id, worker_id))


async def _run_tag_with_sem(sem: asyncio.Semaphore, item: dict[str, Any]) -> None:
    async with sem:
        try:
            await _maybe_generate_tags(
                user_id=item["userId"],
                job_id=item.get("jobId"),
                transcript_id=item["id"],
                log=log,
                already_claimed=True,
                claim_attempt=int(item["taggingAttempt"]),
                correction_revision=int(item["correctionRevision"]),
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.error(
                "tag-reconciliation-task-failed",
                transcript_id=item["id"],
                **error_diagnostic(exc, "TAG_RECONCILIATION_FAILED"),
            )


async def _reconcile_tags_once(
    sem: asyncio.Semaphore,
    tasks: set[asyncio.Task[None]],
    limit: int = 10,
    max_in_flight: int = ENRICHMENT_MAX_CONCURRENCY,
) -> int:
    capacity = min(limit, max(0, max_in_flight - len(tasks)))
    pending_tags = await db.claim_pending_tag_enrichments(limit=capacity) if capacity else []
    for item in pending_tags:
        _track_task(tasks, _run_tag_with_sem(sem, item))
    return len(pending_tags)


async def _run_summary_with_sem(sem: asyncio.Semaphore, item: dict[str, Any]) -> None:
    async with sem:
        try:
            await summary.maybe_generate(
                user_id=item["userId"],
                job_id=item.get("jobId"),
                transcript_id=item["id"],
                log=log,
                already_claimed=True,
                claim_attempt=int(item["summaryAttempt"]),
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.error(
                "summary-reconciliation-task-failed",
                transcript_id=item["id"],
                **error_diagnostic(exc, "SUMMARY_RECONCILIATION_FAILED"),
            )


async def _reconcile_summaries_once(
    sem: asyncio.Semaphore,
    tasks: set[asyncio.Task[None]],
    limit: int = 5,
    max_in_flight: int = ENRICHMENT_MAX_CONCURRENCY,
) -> int:
    capacity = min(limit, max(0, max_in_flight - len(tasks)))
    pending = await db.claim_pending_summary_enrichments(limit=capacity) if capacity else []
    for item in pending:
        _track_task(tasks, _run_summary_with_sem(sem, item))
    return len(pending)


async def _reconcile_grounded_brain_once(
    sem: asyncio.Semaphore,
    tasks: set[asyncio.Task[None]],
    worker_id: str,
    limit: int = 4,
    max_in_flight: int = ENRICHMENT_MAX_CONCURRENCY,
) -> int:
    return await brain_compilation.dispatch_due(
        sem,
        tasks,
        worker_id=worker_id,
        track_task=_track_task,
        log=log,
        limit=limit,
        max_in_flight=max_in_flight,
    )


_reconcile_research_once = research_reconciliation.reconcile_once


async def _reconcile_enrichments_once(
    sem: asyncio.Semaphore,
    tasks: set[asyncio.Task[None]],
    *,
    max_in_flight: int = ENRICHMENT_MAX_CONCURRENCY,
    worker_id: str = "reconciliation-worker",
) -> tuple[int, int, int, int]:
    """Round-robin durable enrichment queues without starving research."""
    global _enrichment_queue_cursor
    if len(tasks) >= max_in_flight:
        return 0, 0, 0, 0

    counts = [0, 0, 0, 0]
    start = _enrichment_queue_cursor
    _enrichment_queue_cursor = (_enrichment_queue_cursor + 1) % 4
    while len(tasks) < max_in_flight:
        dispatched = 0
        for offset in range(4):
            if len(tasks) >= max_in_flight:
                break
            queue = (start + offset) % 4
            if queue == 0:
                claimed = await _reconcile_summaries_once(
                    sem, tasks, limit=1, max_in_flight=max_in_flight
                )
            elif queue == 1:
                claimed = await _reconcile_tags_once(
                    sem, tasks, limit=1, max_in_flight=max_in_flight
                )
            elif queue == 2:
                claimed = await _reconcile_research_once(
                    sem, tasks, limit=1, max_in_flight=max_in_flight
                )
            else:
                claimed = await _reconcile_grounded_brain_once(
                    sem,
                    tasks,
                    worker_id,
                    limit=1,
                    max_in_flight=max_in_flight,
                )
            counts[queue] += claimed
            dispatched += claimed
        if dispatched == 0:
            break
    return counts[0], counts[1], counts[2], counts[3]


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
    while not stop.is_set():
        pubsub: Any | None = None
        try:
            client = await events.get_redis()
            pubsub = client.pubsub()
            await pubsub.subscribe(events.AUTOMATION_RUN_CHANNEL)
            log.info("subscribed-automations", channel=events.AUTOMATION_RUN_CHANNEL)
            while not stop.is_set():
                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if msg is None:
                    continue
                run_id = msg.get("data")
                if not isinstance(run_id, str) or not run_id:
                    continue
                log.info("automation-notify-received", run_id=run_id)
                asyncio.create_task(_process_automation_run(sem, run_id))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 -- scheduler Postgres permanece ativo
            log.warning(
                "automation-subscriber-disconnected",
                **error_diagnostic(exc, "AUTOMATION_SUBSCRIBER_DISCONNECTED"),
            )
        finally:
            if pubsub is not None:
                try:
                    await pubsub.aclose()
                except Exception as exc:  # noqa: BLE001
                    log.warning("automation-subscriber-close-failed", error_type=type(exc).__name__)
        try:
            await asyncio.wait_for(stop.wait(), timeout=1.0)
        except TimeoutError:
            continue


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
    enrichment_sem = asyncio.Semaphore(ENRICHMENT_MAX_CONCURRENCY)
    stop = asyncio.Event()
    job_tasks: set[asyncio.Task[None]] = set()
    enrichment_tasks: set[asyncio.Task[None]] = set()
    worker_id = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:12]}"

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except (NotImplementedError, RuntimeError):
            # Windows e loops embutidos podem não expor signal handlers.
            pass

    log.info(
        "worker-starting",
        max_concurrency=MAX_CONCURRENCY,
        automation_max_concurrency=AUTOMATION_MAX_CONCURRENCY,
        **ytdl.runtime_versions(),
    )
    try:
        # TaskGroup cancela e AGUARDA todos os siblings antes de propagar uma
        # falha. Assim, exceções em finally/cleanup entram no ExceptionGroup e
        # nunca viram "unhandled exception during asyncio.run() shutdown".
        async with asyncio.TaskGroup() as supervisor:
            supervisor.create_task(_subscriber_loop(sem, stop, worker_id, job_tasks))
            supervisor.create_task(_reconciliation_loop(sem, stop, worker_id, job_tasks))
            supervisor.create_task(
                _enrichment_reconciliation_loop(enrichment_sem, stop, enrichment_tasks, worker_id)
            )
            supervisor.create_task(cancel_subscriber(stop))
            supervisor.create_task(_automation_subscriber_loop(automation_sem, stop))
            supervisor.create_task(_automation_scheduler_loop(automation_sem, stop))
        if job_tasks:
            done, pending = await asyncio.wait(job_tasks, timeout=JOB_SHUTDOWN_GRACE_SEC)
            if pending:
                log.info("worker-shutdown-cancelling-jobs", count=len(pending))
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
            # Recupera exceções de tasks que terminaram durante a janela de graça.
            await asyncio.gather(*done, return_exceptions=True)
        if enrichment_tasks:
            for task in enrichment_tasks:
                task.cancel()
            await asyncio.gather(*enrichment_tasks, return_exceptions=True)
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
