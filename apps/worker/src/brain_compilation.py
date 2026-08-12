"""Durable orchestration for grounded semantic graph compilation."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Callable, Coroutine
from hashlib import sha256
from typing import Any

from . import brain_compilation_db, brain_extract, db, storage, voxen_settings
from .graph_index_lease import acquire_graph_index_lease
from .pipeline_observability import log_openrouter_route
from .safe_diagnostics import error_diagnostic


async def extract_grounded_brain(
    *,
    user_id: str,
    transcript_id: str,
    log: Any,  # noqa: ANN401
    worker_id: str | None = None,
    refresh_embedding: bool = False,
) -> None:
    """Compile grounded entities and claims without failing content ingestion."""
    try:
        row = await db.get_transcript_title_content_md_path(user_id, transcript_id)
        if not row:
            return
        (
            title,
            fallback_content,
            md_path,
            correction_revision,
            source_version,
            source_checksum,
        ) = row
        if refresh_embedding:
            from .pipeline import _maybe_store_embedding

            await _maybe_store_embedding(user_id=user_id, transcript_id=transcript_id, log=log)
        content = fallback_content
        if md_path:
            try:
                content = await storage.get_markdown(key=md_path)
            except Exception as exc:  # noqa: BLE001 -- fallback has no temporal locations
                log.warning(
                    "brain-extract-markdown-unavailable",
                    transcript_id=transcript_id,
                    **error_diagnostic(exc, "BRAIN_MARKDOWN_UNAVAILABLE"),
                )
        if len((content or "").strip()) < 80:
            await brain_compilation_db.mark_transcript_compilation_skipped(
                user_id=user_id,
                transcript_id=transcript_id,
                correction_revision=correction_revision,
                source_version=source_version,
                source_checksum=source_checksum,
            )
            return
        segments = brain_extract.segment_content(content)
        if not segments:
            await brain_compilation_db.mark_transcript_compilation_skipped(
                user_id=user_id,
                transcript_id=transcript_id,
                correction_revision=correction_revision,
                source_version=source_version,
                source_checksum=source_checksum,
            )
            return
        segment_payload: list[dict[str, Any]] = [
            {
                "key": segment.key,
                "text": segment.text,
                "start_line": segment.start_line,
                "end_line": segment.end_line,
                "start_sec": segment.start_sec,
                "end_sec": segment.end_sec,
            }
            for segment in segments
        ]
        content_hash = sha256(
            f"v{brain_extract.BRAIN_GROUNDED_EXTRACT_VERSION}\0{title}\0{content}".encode()
        ).hexdigest()
        try:
            compilation_id, pending_rows = await db.prepare_grounded_brain_compilation(
                user_id=user_id,
                transcript_id=transcript_id,
                content_hash=content_hash,
                segments=segment_payload,
                correction_revision=correction_revision,
                source_version=source_version,
                source_checksum=source_checksum,
            )
        except db.GroundedCompilationClaimLostError:
            log.info("brain-extract-stale-content", transcript_id=transcript_id)
            return
        due_keys = {str(row["segmentKey"]) for row in pending_rows}
        if not due_keys:
            log.info("brain-extract-already-complete", transcript_id=transcript_id)
            return
        config = await voxen_settings.get_openrouter_model_config(("default_chat_model",))
        if not config.api_key or not config.model:
            await brain_compilation_db.mark_transcript_compilation_skipped(
                user_id=user_id,
                transcript_id=transcript_id,
                correction_revision=correction_revision,
                source_version=source_version,
                source_checksum=source_checksum,
            )
            log.info("brain-extract-skipped-missing-config", transcript_id=transcript_id)
            return
        claim_owner = f"{worker_id or 'brain'}:{uuid.uuid4()}"
        language = await voxen_settings.get_app_language()
        claimed_any = False
        total_items = 0
        total_edges = 0
        for segment in segment_payload:
            if segment["key"] not in due_keys:
                continue
            claimed_rows = await brain_compilation_db.claim_segments(
                user_id=user_id,
                compilation_id=compilation_id,
                segment_keys=[segment["key"]],
                worker_id=claim_owner,
                limit=1,
            )
            if not claimed_rows:
                continue
            claimed_any = True
            lease = None
            try:
                # Network-bound extraction intentionally runs without the graph write lease.
                result = await brain_extract.extract_grounded_concepts(
                    title=title,
                    content=segment["text"],
                    api_key=config.api_key,
                    model=config.model,
                    fallback_model=config.fallback_model,
                    language=language,
                )
                log_openrouter_route(log, "brain_extract", config.model, result.model)
                await db.insert_cost_event(
                    user_id=user_id,
                    kind="CHAT",
                    model=result.model,
                    tokens_in=result.tokens_in,
                    tokens_out=result.tokens_out,
                    cost_usd=result.cost_usd,
                    meta={
                        "source": "brain_grounded_extract",
                        "transcript_id": transcript_id,
                        "segment_key": segment["key"],
                    },
                )
                payload = [
                    {
                        "kind": item.kind,
                        "label": item.label,
                        "excerpt": item.excerpt,
                        "confidence": item.confidence,
                        "slug": brain_extract.slugify_label(item.label),
                        "entity_type": item.entity_type,
                        "aliases": list(item.aliases),
                        "local_ref": item.local_ref,
                    }
                    for item in result.items
                ]
                relations = [
                    {
                        "subject_ref": relation.subject_ref,
                        "predicate": relation.predicate,
                        "object_ref": relation.object_ref,
                        "kind": relation.kind,
                        "excerpt": relation.excerpt,
                        "confidence": relation.confidence,
                        "valid_from": relation.valid_from,
                        "valid_to": relation.valid_to,
                    }
                    for relation in result.relations
                ]
                lease = await acquire_graph_index_lease(user_id)
                if lease is None:
                    await brain_compilation_db.mark_segment_failed(
                        user_id=user_id,
                        compilation_id=compilation_id,
                        segment_key=segment["key"],
                        error="GRAPH_WRITE_LEASE_UNAVAILABLE",
                        worker_id=claim_owner,
                    )
                    log.info("brain-extract-deferred-lease", transcript_id=transcript_id)
                    continue
                async with lease.heartbeat():
                    total_edges += await db.upsert_grounded_brain_items(
                        user_id=user_id,
                        transcript_id=transcript_id,
                        compilation_id=compilation_id,
                        segment=segment,
                        items=payload,
                        relations=relations,
                        lease=lease,
                        worker_id=claim_owner,
                        content_hash=content_hash,
                        correction_revision=correction_revision,
                        source_version=source_version,
                        source_checksum=source_checksum,
                    )
                    total_items += len(payload)
            except Exception as exc:  # noqa: BLE001 -- one segment cannot invalidate others
                await brain_compilation_db.mark_segment_failed(
                    user_id=user_id,
                    compilation_id=compilation_id,
                    segment_key=segment["key"],
                    error=type(exc).__name__,
                    worker_id=claim_owner,
                )
                log.warning(
                    "brain-extract-segment-failed",
                    transcript_id=transcript_id,
                    segment_key=segment["key"],
                    **error_diagnostic(exc, "BRAIN_EXTRACTION_SEGMENT_FAILED"),
                )
            finally:
                if lease is not None:
                    await lease.release()
        if not claimed_any:
            log.info("brain-extract-already-claimed", transcript_id=transcript_id)
            return
        log.info(
            "brain-extract-done",
            transcript_id=transcript_id,
            items=total_items,
            edges=total_edges,
        )
    except Exception as exc:  # noqa: BLE001 -- best effort
        log.warning(
            "brain-extract-failed",
            transcript_id=transcript_id,
            **error_diagnostic(exc, "BRAIN_EXTRACTION_FAILED"),
        )


async def _run_with_sem(
    sem: asyncio.Semaphore,
    item: dict[str, Any],
    worker_id: str,
    log: Any,  # noqa: ANN401
) -> None:
    async with sem:
        try:
            await extract_grounded_brain(
                user_id=item["userId"],
                transcript_id=item["transcriptId"],
                log=log,
                worker_id=f"{worker_id}:brain:{item['transcriptId']}",
                refresh_embedding=True,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.error(
                "brain-compilation-reconciliation-task-failed",
                transcript_id=item["transcriptId"],
                **error_diagnostic(exc, "BRAIN_COMPILATION_RECONCILIATION_FAILED"),
            )


async def dispatch_due(
    sem: asyncio.Semaphore,
    tasks: set[asyncio.Task[None]],
    *,
    worker_id: str,
    track_task: Callable[[set[asyncio.Task[None]], Coroutine[Any, Any, None]], None],
    log: Any,  # noqa: ANN401
    limit: int = 4,
    max_in_flight: int = 2,
) -> int:
    """Dispatch due compilations without exceeding the shared enrichment budget."""
    capacity = min(limit, max(0, max_in_flight - len(tasks)))
    pending = await brain_compilation_db.list_due_compilations(limit=capacity) if capacity else []
    for item in pending:
        track_task(tasks, _run_with_sem(sem, item, worker_id, log))
    return len(pending)
