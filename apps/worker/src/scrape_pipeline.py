"""Pipeline para Jobs de tipo SCRAPE_WEB (spec 004)."""

from __future__ import annotations

import asyncio
from typing import Any

import structlog

from . import db, events, scraper, storage, summary, voxen_settings
from .cancellation import CancelledException, is_cancelled
from .openrouter import generate_content_title
from .pipeline import (  # noqa: PLC2701
    PermanentError,
    _maybe_assign_folder,
    _maybe_generate_tags,
)

log = structlog.get_logger(__name__)


async def run(*, job_id: str, user_id: str, source_url: str, log: Any) -> None:  # noqa: ANN401
    """Processa um Job SCRAPE_WEB: baixa, extrai, persiste, dispara summary."""
    _check_cancel(job_id)
    await events.publish_job_event(user_id, job_id, "downloading", percent=10)

    try:
        result = await _scrape_with_retry(source_url)
    except scraper.RobotsBlockedError as e:
        raise PermanentError(str(e)) from e
    except scraper.FetchBlockedError as e:
        raise PermanentError(str(e)) from e
    except scraper.EmptyContentError as e:
        raise PermanentError(str(e)) from e

    _check_cancel(job_id)
    await events.publish_job_event(user_id, job_id, "uploading", percent=70)

    new_transcript_id = await _persist(
        user_id=user_id,
        job_id=job_id,
        source_url=source_url,
        result=result,
        log=log,
    )

    await events.publish_job_event(user_id, job_id, "indexing", percent=92)
    await db.link_job_transcript(job_id, new_transcript_id)

    # Resumo via IA — best-effort, delega pro chat service (mesmo padrão do vídeo)
    _check_cancel(job_id)
    await events.publish_job_event(user_id, job_id, "summarizing", percent=98)
    await summary.maybe_generate(
        user_id=user_id, transcript_id=new_transcript_id, job_id=job_id, log=log
    )
    _check_cancel(job_id)
    await events.publish_job_event(user_id, job_id, "tagging", percent=99)
    await _maybe_generate_tags(
        user_id=user_id,
        job_id=job_id,
        transcript_id=new_transcript_id,
        log=log,
    )
    await db.reindex_transcript_brain_node(user_id, new_transcript_id)
    from .pipeline import _maybe_grounded_brain_extract, _maybe_store_embedding

    await _maybe_grounded_brain_extract(
        user_id=user_id,
        transcript_id=new_transcript_id,
        log=log,
    )
    await _maybe_store_embedding(
        user_id=user_id,
        transcript_id=new_transcript_id,
        log=log,
    )

    await db.mark_job_done(job_id)
    await events.publish_job_event(
        user_id, job_id, "done", percent=100, transcript_id=new_transcript_id
    )
    log.info("scrape-done", transcript_id=new_transcript_id)


async def _scrape_with_retry(url: str, tries: int = 3) -> scraper.ScrapeResult:
    """Retry exp backoff só pra erros transientes."""
    last_exc: scraper.FetchTransientError | None = None
    for attempt in range(tries):
        try:
            return await scraper.fetch_and_extract(url)
        except scraper.FetchTransientError as e:
            last_exc = e
            if attempt < tries - 1:
                await asyncio.sleep(2**attempt)
            continue
    assert last_exc is not None
    raise last_exc


async def _persist(
    *,
    user_id: str,
    job_id: str,
    source_url: str,
    result: scraper.ScrapeResult,
    log: Any,  # noqa: ANN401
) -> str:
    """Persiste o resultado como Transcript (source=WEB, method=SCRAPE)."""
    import json

    transcript_id = db.generate_cuid()
    md_key = storage.transcript_key(user_id, transcript_id)
    title = await _maybe_generate_title(
        user_id=user_id,
        job_id=job_id,
        content=result.plain_text,
        fallback_title=result.title,
        log=log,
    )
    from . import thumbnail as thumb_mod

    (
        thumbnail_url,
        preview_object_key,
        preview_mime_type,
    ) = await thumb_mod.resolve_thumbnail_for_persist(
        remote_url=result.thumbnail_url,
        user_id=user_id,
        transcript_id=transcript_id,
        source_url=source_url,
    )

    await storage.put_markdown(key=md_key, content=result.markdown)

    frontmatter = {
        "id": transcript_id,
        "userId": user_id,
        "source": "WEB",
        "url": result.url,
        "title": title,
        "siteName": result.site_name,
        "author": result.author,
        "publishedAt": result.published_at.isoformat() if result.published_at else None,
        "language": result.language,
        "transcriptionMethod": "SCRAPE",
    }
    if preview_object_key:
        frontmatter["preview"] = {"objectKey": preview_object_key, "mimeType": preview_mime_type}

    async with db.connection() as conn:
        await conn.execute(
            """
            INSERT INTO "Transcript" (
                id, "userId", source, url, title, channel, author, "durationSec",
                "publishedAt", "thumbnailUrl", language, "transcriptionMethod",
                model, "costUsd", "mdPath", "plainText", frontmatter,
                "previewObjectKey", "previewMimeType",
                "createdAt", "updatedAt"
            ) VALUES (
                $1, $2, 'WEB'::"TranscriptSource", $3, $4, $5, $6, 0,
                $7, $8, $9, 'SCRAPE'::"TranscriptionMethod",
                NULL, 0, $10, $11, $12::jsonb,
                $13, $14,
                NOW(), NOW()
            )
            """,
            transcript_id,
            user_id,
            result.url,
            title,
            result.site_name,
            result.author,
            (
                result.published_at.replace(tzinfo=None)
                if result.published_at and result.published_at.tzinfo
                else result.published_at
            ),
            thumbnail_url,
            result.language or "und",
            md_key,
            result.plain_text,
            json.dumps(frontmatter, default=str),
            preview_object_key,
            preview_mime_type,
        )
        await db.upsert_transcript_brain_node(
            conn,
            user_id=user_id,
            transcript_id=transcript_id,
            source="WEB",
            url=result.url,
            title=title,
            channel=result.site_name,
            language=result.language or "und",
            transcription_method="SCRAPE",
            thumbnail_url=thumbnail_url,
            plain_text=result.plain_text,
        )
    await _maybe_assign_folder(
        user_id=user_id,
        job_id=job_id,
        transcript_id=transcript_id,
        title=title,
        content=result.plain_text,
        fallback_model=None,
        log=log,
    )
    return transcript_id


async def _maybe_generate_title(
    *,
    user_id: str,
    job_id: str,
    content: str,
    fallback_title: str,
    log: Any,  # noqa: ANN401
) -> str:
    clean_content = content.strip()
    if len(clean_content) < 40:
        return fallback_title
    try:
        api_key = await voxen_settings.get_openrouter_api_key()
        model = await voxen_settings.get_default_chat_model()
        if not api_key or not model:
            return fallback_title
        language = await voxen_settings.get_app_language()
        result = await generate_content_title(
            content=clean_content,
            source_label="Página web",
            fallback_title=fallback_title,
            api_key=api_key,
            model=model,
            language=language,
        )
        await db.insert_cost_event(
            user_id=user_id,
            kind="CHAT",
            model=result.model,
            tokens_in=result.tokens_in,
            tokens_out=result.tokens_out,
            cost_usd=result.cost_usd,
            job_id=job_id,
            meta={"source": "title_generation", "source_label": "Página web"},
        )
        return result.title or fallback_title
    except Exception as e:  # noqa: BLE001 — título é enriquecimento best-effort
        log.warning("web-title-generation-failed", error=str(e)[:240])
        return fallback_title


def _check_cancel(job_id: str) -> None:
    if is_cancelled(job_id):
        raise CancelledException()
