"""Pipeline para Jobs de tipo SCRAPE_WEB (spec 004)."""

from __future__ import annotations

import asyncio
from typing import Any

import structlog

from . import db, events, scraper, storage, summary
from .cancellation import CancelledException, is_cancelled
from .pipeline import PermanentError  # reusa exceção pro process_job tratar igual

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
        source_url=source_url,
        result=result,
    )

    await events.publish_job_event(user_id, job_id, "indexing", percent=92)
    await db.link_job_transcript(job_id, new_transcript_id)

    # Resumo via IA — best-effort, delega pro chat service (mesmo padrão do vídeo)
    _check_cancel(job_id)
    await events.publish_job_event(user_id, job_id, "summarizing", percent=98)
    await summary.maybe_generate(
        user_id=user_id, transcript_id=new_transcript_id, job_id=job_id, log=log
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


async def _persist(*, user_id: str, source_url: str, result: scraper.ScrapeResult) -> str:
    """Persiste o resultado como Transcript (source=WEB, method=SCRAPE)."""
    import json

    transcript_id = db.generate_cuid()
    md_key = storage.transcript_key(user_id, transcript_id)

    await storage.put_markdown(key=md_key, content=result.markdown)

    frontmatter = {
        "id": transcript_id,
        "userId": user_id,
        "source": "WEB",
        "url": result.url,
        "title": result.title,
        "siteName": result.site_name,
        "author": result.author,
        "publishedAt": result.published_at.isoformat() if result.published_at else None,
        "language": result.language,
        "transcriptionMethod": "SCRAPE",
    }

    async with db.connection() as conn:
        await conn.execute(
            """
            INSERT INTO "Transcript" (
                id, "userId", source, url, title, channel, author, "durationSec",
                "publishedAt", "thumbnailUrl", language, "transcriptionMethod",
                model, "costUsd", "mdPath", "plainText", frontmatter,
                "createdAt", "updatedAt"
            ) VALUES (
                $1, $2, 'WEB'::"TranscriptSource", $3, $4, $5, $6, 0,
                $7, $8, $9, 'SCRAPE'::"TranscriptionMethod",
                NULL, 0, $10, $11, $12::jsonb,
                NOW(), NOW()
            )
            """,
            transcript_id,
            user_id,
            result.url,
            result.title,
            result.site_name,
            result.author,
            (
                result.published_at.replace(tzinfo=None)
                if result.published_at and result.published_at.tzinfo
                else result.published_at
            ),
            result.thumbnail_url,
            result.language or "und",
            md_key,
            result.plain_text,
            json.dumps(frontmatter, default=str),
        )
    return transcript_id


def _check_cancel(job_id: str) -> None:
    if is_cancelled(job_id):
        raise CancelledException()
