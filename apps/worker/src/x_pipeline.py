"""Pipeline do Job ANALYZE_X: captura determinística + análise do modelo.

Vive fora do `pipeline.py` pelo mesmo motivo do `scrape_pipeline.py`: é uma
família de job própria. A captura pública do post e o veredito de acesso estão
no contrato de `x_post.py`/`x_analysis.py`.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from urllib.parse import urlsplit

from . import db, events, storage, transcript_metadata, video_url, voxen_settings, x_post, ytdl
from .pipeline import (  # noqa: PLC2701 — helpers do pipeline compartilhados
    _check_cancel,
    _complete_persisted_job,
    _maybe_generate_title,
    _persist,
    _retry_transient_or,
)
from .pipeline_errors import PermanentError
from .pipeline_observability import log_openrouter_route
from .safe_diagnostics import error_diagnostic as _error_diagnostic
from .source_freshness import mark_reviewable_derivatives_stale
from .transcript_md import Segment, TranscriptDoc, render_markdown, render_plain_text
from .x_analysis import analyze_x_url


async def run(
    *,
    job_id: str,
    user_id: str,
    source_url: str,
    refresh_transcript_id: str | None = None,
    log: Any,  # noqa: ANN401
) -> None:
    if video_url.detect_source(source_url) != "X":
        raise PermanentError.public(
            "X_URL_INVALID",
            "Job de análise do X recebeu uma URL que não é do X.",
        )

    config = await voxen_settings.get_openrouter_model_config(
        (
            "default_x_analysis_model",
            "default_grok_model",
            "default_x_model",
            "x_analysis_model",
        )
    )
    if not config.api_key:
        raise PermanentError.public(
            "OPENROUTER_NOT_CONFIGURED",
            "Setup incompleto — chave da OpenRouter ausente.",
        )
    if not config.model:
        raise PermanentError.public(
            "X_MODEL_NOT_CONFIGURED",
            "Setup incompleto — modelo de análise do X ausente.",
        )
    api_key = config.api_key
    model = config.model

    _check_cancel(job_id)
    await events.publish_job_event(user_id, job_id, "analyzing_x", percent=30)

    status_id = urlsplit(source_url).path.rstrip("/").split("/")[-1]
    capture: x_post.XPost | None = None
    try:
        capture = await x_post.fetch_x_post(status_id)
    except Exception as exc:  # noqa: BLE001 — captura é best-effort e nunca derruba o job
        log.warning("x-capture-failed", **_error_diagnostic(exc, "X_CAPTURE_FAILED"))
    if capture is None:
        log.info("x-capture-unavailable", status_id=status_id)
    else:
        log.info("x-capture-ok", status_id=status_id, media_count=len(capture.media))
    post_context = x_post.render_x_post_context(capture) if capture is not None else None

    async def _do_call() -> Any:
        return await analyze_x_url(
            url=source_url,
            api_key=api_key,
            model=model,
            fallback_model=config.fallback_model,
            post_context=post_context,
        )

    analysis: Any | None = None
    try:
        analysis = await _retry_transient_or(_do_call, tries=3)
    except Exception as exc:  # noqa: BLE001 — captura preserva conteúdo já disponível
        if capture is None:
            raise
        log.warning(
            "x-analysis-failed-using-capture",
            **_error_diagnostic(exc, getattr(exc, "code", "X_ANALYSIS_FAILED")),
        )
    if analysis is not None and analysis.verdict_missing:
        log.warning(
            "x-analysis-verdict-missing",
            status_id=status_id,
            accessible=analysis.accessible,
        )

    if analysis is not None:
        log_openrouter_route(log, "x_analysis", model, analysis.model)
        await db.insert_cost_event(
            user_id=user_id,
            kind="X_SEARCH",
            model=analysis.model,
            tokens_in=analysis.tokens_in,
            tokens_out=analysis.tokens_out,
            cost_usd=analysis.cost_usd,
            job_id=job_id,
            meta={
                "source": "x_analysis",
            },
        )

    selection = x_post.select_x_content(
        capture_markdown=x_post.render_x_post_markdown(capture) if capture is not None else None,
        analysis_text=analysis.text if analysis is not None else None,
        analysis_accessible=analysis.accessible if analysis is not None else None,
    )
    if selection.unavailable:
        raise PermanentError.public(
            "X_CONTENT_UNAVAILABLE",
            "Não foi possível recuperar o conteúdo deste post no X. "
            "O post pode estar indisponível ou restrito; reprocesse mais tarde.",
        )
    if selection.source == "capture":
        log.info("x-analysis-capture-fallback", status_id=status_id)

    probe_info = ytdl.VideoProbe(
        video_id=status_id,
        title=(capture.suggested_title if capture is not None else None)
        or f"Post do X {status_id}",
        channel=(capture.channel if capture is not None else None) or "X",
        duration_sec=0,
        published_at=capture.created_at if capture is not None else None,
        thumbnail_url=capture.preview_url if capture is not None else None,
        language_hint=None,
        available_subtitles={},
        automatic_captions={},
        author=capture.author_name if capture is not None else None,
        canonical_url=(
            capture.permalink if capture is not None else f"https://x.com/i/status/{status_id}"
        ),
    )
    generated_title = await _maybe_generate_title(
        user_id=user_id,
        job_id=job_id,
        content=selection.content,
        source_label="Publicação do X",
        fallback_title=probe_info.title,
        fallback_model=model,
        log=log,
    )

    _check_cancel(job_id)
    language = (
        "pt"
        if selection.source == "analysis"
        else (capture.lang if capture is not None and capture.lang else "pt")
    )
    if refresh_transcript_id is not None:
        changed = await _persist_refresh(
            user_id=user_id,
            job_id=job_id,
            transcript_id=refresh_transcript_id,
            source_url=source_url,
            content=selection.content,
            probe_info=probe_info,
            title=generated_title,
            model=analysis.model if analysis is not None else None,
            cost_usd=analysis.cost_usd if analysis is not None else None,
            language=language,
            log=log,
        )
        if not changed:
            await db.mark_job_done(job_id)
            await events.publish_job_event(
                user_id, job_id, "done", percent=100, transcript_id=refresh_transcript_id
            )
            log.info("x-reprocess-unchanged", transcript_id=refresh_transcript_id)
            return
        await events.publish_job_event(user_id, job_id, "indexing", percent=95)
        await _complete_persisted_job(
            user_id=user_id, transcript_id=refresh_transcript_id, job_id=job_id, log=log
        )
        log.info("x-reprocess-done", transcript_id=refresh_transcript_id)
        return

    await events.publish_job_event(user_id, job_id, "uploading", percent=80)
    new_transcript_id = await _persist(
        user_id=user_id,
        job_id=job_id,
        probe_info=probe_info,
        source_url=source_url,
        segments=(Segment(start_sec=0.0, text=selection.content),),
        method="X_SEARCH",
        model=analysis.model if analysis is not None else None,
        cost_usd=analysis.cost_usd if analysis is not None else None,
        language=language,
        title_override=generated_title,
    )

    await events.publish_job_event(user_id, job_id, "indexing", percent=95)
    await db.link_job_transcript(job_id, new_transcript_id)
    await _complete_persisted_job(
        user_id=user_id, transcript_id=new_transcript_id, job_id=job_id, log=log
    )
    log.info("x-analysis-job-done", transcript_id=new_transcript_id)


def _content_checksum(content: str) -> str:
    """Compara conteúdo ignorando diferenças de espaçamento."""
    normalized = " ".join(content.split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _json_object(value: Any) -> dict[str, Any]:  # noqa: ANN401
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except ValueError:
            return {}
        return decoded if isinstance(decoded, dict) else {}
    return {}


async def _persist_refresh(
    *,
    user_id: str,
    job_id: str,
    transcript_id: str,
    source_url: str,
    content: str,
    probe_info: ytdl.VideoProbe,
    title: str | None,
    model: str | None,
    cost_usd: Decimal | None,
    language: str,
    log: Any,  # noqa: ANN401
) -> bool:
    """Substitui o conteúdo canônico do transcript existente.

    Devolve False quando o conteúdo é idêntico ao armazenado (nada é reescrito).
    """
    checksum = _content_checksum(content)
    async with db.connection() as conn:
        lock_key = f"voxen:source-refresh:{transcript_id}"
        await conn.execute("SELECT pg_advisory_lock(hashtext($1))", lock_key)
        try:
            async with conn.transaction():
                await db.assert_job_lease_in_connection(conn, job_id=job_id, user_id=user_id)
                current = await conn.fetchrow(
                    """
                    SELECT id, status, source, title, "plainText", "mdPath",
                           "sourceChecksum", "sourceVersion", "sourceMetadata",
                           "previewObjectKey", "previewMimeType", "thumbnailUrl"
                    FROM "Transcript"
                    WHERE id = $1 AND "userId" = $2
                    """,
                    transcript_id,
                    user_id,
                )
                if not current or current["source"] != "X" or current["status"] == "TRASH":
                    raise PermanentError.public(
                        "SOURCE_REFRESH_MISSING",
                        "A fonte não está mais disponível para reprocessamento.",
                    )
                old_plain_text = current["plainText"] or ""
                current_checksum = current["sourceChecksum"] or _content_checksum(old_plain_text)
                baseline_version = int(current["sourceVersion"] or 0) or 1
                if current_checksum == checksum:
                    await conn.execute(
                        """
                        UPDATE "Transcript"
                        SET "sourceChecksum" = $3,
                            "sourceCollectedAt" = NOW(),
                            "sourceRefreshStatus" = 'CURRENT'::"SourceRefreshStatus",
                            "sourceRefreshError" = NULL,
                            "updatedAt" = NOW()
                        WHERE id = $1 AND "userId" = $2
                        """,
                        transcript_id,
                        user_id,
                        checksum,
                    )
                    await conn.execute(
                        """
                        INSERT INTO "SourceContentVersion" (
                          id, "userId", "transcriptId", version, checksum,
                          "mdPath", "plainText", metadata
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
                        ON CONFLICT ("transcriptId", checksum) DO NOTHING
                        """,
                        db.generate_cuid(),
                        user_id,
                        transcript_id,
                        baseline_version,
                        checksum,
                        current["mdPath"],
                        old_plain_text,
                        json.dumps(_json_object(current["sourceMetadata"])),
                    )
                    return False
                next_version = baseline_version + 1

            resolved_title = (title or "").strip() or current["title"] or probe_info.title
            from . import thumbnail as thumb_mod

            (
                stable_thumb,
                mirrored_key,
                mirrored_mime,
            ) = await thumb_mod.resolve_thumbnail_for_persist(
                remote_url=probe_info.thumbnail_url,
                user_id=user_id,
                transcript_id=transcript_id,
                source_url=source_url,
            )
            thumbnail_url = (
                stable_thumb
                if mirrored_key or probe_info.thumbnail_url
                else (current["thumbnailUrl"] or stable_thumb)
            )
            preview_object_key = mirrored_key or current["previewObjectKey"]
            preview_mime_type = mirrored_mime or current["previewMimeType"]

            doc = TranscriptDoc(
                transcript_id=transcript_id,
                user_id=user_id,
                source="X",
                url=probe_info.canonical_url or source_url,
                video_id=probe_info.video_id,
                title=resolved_title,
                channel=probe_info.channel,
                author=probe_info.author,
                duration_sec=0,
                published_at=probe_info.published_at,
                thumbnail_url=thumbnail_url,
                language=language,
                transcription_method="X_SEARCH",
                model=model,
                cost_usd=cost_usd,
                segments=(Segment(start_sec=0.0, text=content),),
                transcribed_at=datetime.now(UTC),
            )
            md_key = storage.source_version_key(user_id, transcript_id, next_version)
            frontmatter = transcript_metadata.frontmatter_json(
                doc,
                preview_object_key=preview_object_key,
                preview_mime_type=preview_mime_type,
            )
            await storage.put_markdown(key=md_key, content=render_markdown(doc))
            plain_text = render_plain_text(doc)

            async with conn.transaction():
                await db.assert_job_lease_in_connection(conn, job_id=job_id, user_id=user_id)
                await conn.execute(
                    """
                    INSERT INTO "SourceContentVersion" (
                      id, "userId", "transcriptId", version, checksum,
                      "mdPath", "plainText", metadata
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
                    ON CONFLICT ("transcriptId", checksum) DO NOTHING
                    """,
                    db.generate_cuid(),
                    user_id,
                    transcript_id,
                    baseline_version,
                    current_checksum,
                    current["mdPath"],
                    old_plain_text,
                    json.dumps(_json_object(current["sourceMetadata"])),
                )
                await conn.execute(
                    """
                    UPDATE "Transcript"
                    SET title = $3, channel = $4, author = $5, "publishedAt" = $6,
                        "thumbnailUrl" = $7, language = $8, "mdPath" = $9,
                        "plainText" = $10, frontmatter = $11::jsonb, model = $12,
                        "costUsd" = $13,
                        "previewObjectKey" = $14, "previewMimeType" = $15,
                        "summaryMd" = NULL, "flowchartMd" = NULL,
                        "taggingStatus" = 'PENDING'::"EnrichmentStatus",
                        "summaryStatus" = 'PENDING'::"EnrichmentStatus",
                        "summaryAttempts" = 0, "summaryStartedAt" = NULL,
                        "summaryNextAttemptAt" = NULL, "summaryError" = NULL,
                        "taggingAttempts" = 0, "taggingStartedAt" = NULL,
                        "taggingNextAttemptAt" = NULL, "taggingError" = NULL,
                        "sourceChecksum" = $16, "sourceVersion" = $17,
                        "sourceCollectedAt" = NOW(),
                        "sourceRefreshStatus" = 'CURRENT'::"SourceRefreshStatus",
                        "sourceRefreshError" = NULL,
                        "correctionState" = CASE
                          WHEN "correctionRevision" > 0
                          THEN 'STALE'::"TranscriptCorrectionState"
                          ELSE "correctionState"
                        END,
                        "correctionStaleReason" = CASE
                          WHEN "correctionRevision" > 0
                          THEN 'source-version-changed'
                          ELSE NULL
                        END,
                        "updatedAt" = NOW()
                    WHERE id = $1 AND "userId" = $2
                    """,
                    transcript_id,
                    user_id,
                    resolved_title,
                    probe_info.channel,
                    probe_info.author,
                    (
                        probe_info.published_at.replace(tzinfo=None)
                        if probe_info.published_at and probe_info.published_at.tzinfo
                        else probe_info.published_at
                    ),
                    thumbnail_url,
                    language,
                    md_key,
                    plain_text,
                    frontmatter,
                    model,
                    cost_usd,
                    preview_object_key,
                    preview_mime_type,
                    checksum,
                    next_version,
                )
                await conn.execute(
                    'DELETE FROM "TranscriptTag" WHERE "transcriptId" = $1', transcript_id
                )
                await mark_reviewable_derivatives_stale(
                    conn, user_id, transcript_id, next_version, checksum
                )
                await conn.execute(
                    """
                    INSERT INTO "SourceContentVersion" (
                      id, "userId", "transcriptId", version, checksum,
                      "mdPath", "plainText", metadata
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
                    ON CONFLICT DO NOTHING
                    """,
                    db.generate_cuid(),
                    user_id,
                    transcript_id,
                    next_version,
                    checksum,
                    md_key,
                    plain_text,
                    json.dumps({"url": doc.url, "channel": probe_info.channel}),
                )
                await db.upsert_transcript_brain_node(
                    conn,
                    user_id=user_id,
                    transcript_id=transcript_id,
                    source="X",
                    url=doc.url,
                    title=resolved_title,
                    channel=probe_info.channel,
                    language=language,
                    transcription_method="X_SEARCH",
                    thumbnail_url=thumbnail_url,
                    plain_text=plain_text,
                )
            log.info(
                "x-source-version-created",
                transcript_id=transcript_id,
                source_version=next_version,
            )
            return True
        finally:
            await conn.execute("SELECT pg_advisory_unlock(hashtext($1))", lock_key)
