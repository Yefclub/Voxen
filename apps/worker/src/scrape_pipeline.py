"""Pipeline para Jobs de tipo SCRAPE_WEB (spec 004)."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from hashlib import sha256
from typing import Any

import structlog

from . import db, events, scraper, storage, voxen_settings
from .cancellation import CancelledException, is_cancelled
from .openrouter import generate_content_title
from .pipeline import PermanentError, _maybe_assign_folder  # noqa: PLC2701
from .safe_diagnostics import error_diagnostic

log = structlog.get_logger(__name__)


@dataclass(frozen=True)
class PersistResult:
    transcript_id: str
    changed: bool


async def run(
    *,
    job_id: str,
    user_id: str,
    source_url: str,
    refresh_transcript_id: str | None = None,
    log: Any,
) -> None:  # noqa: ANN401
    """Processa um Job SCRAPE_WEB: baixa, extrai, persiste, dispara summary."""
    _check_cancel(job_id)
    await events.publish_job_event(user_id, job_id, "downloading", percent=10)

    try:
        result = await _scrape_with_retry(source_url)
    except scraper.RobotsBlockedError as e:
        raise PermanentError.public(
            "SCRAPE_ROBOTS_BLOCKED",
            "O site não permite a leitura automatizada deste conteúdo.",
        ) from e
    except scraper.FetchBlockedError as e:
        raise PermanentError.public(
            "SCRAPE_ACCESS_BLOCKED",
            "Não foi possível acessar esta página com segurança.",
        ) from e
    except scraper.EmptyContentError as e:
        raise PermanentError.public(
            "SCRAPE_CONTENT_EMPTY",
            "A página não ofereceu conteúdo suficiente para análise.",
        ) from e

    _check_cancel(job_id)
    await events.publish_job_event(user_id, job_id, "uploading", percent=70)

    persisted = await _persist(
        user_id=user_id,
        job_id=job_id,
        source_url=source_url,
        result=result,
        refresh_transcript_id=refresh_transcript_id,
        log=log,
    )
    transcript_id = persisted.transcript_id

    await events.publish_job_event(user_id, job_id, "indexing", percent=92)
    # Job.transcriptId é único e pertence à ingestão que *criou* o conteúdo.
    # Refreshes usam refreshTranscriptId; o evento final ainda traz o ID para a UI.
    if not refresh_transcript_id:
        await db.link_job_transcript(job_id, transcript_id)

    if not persisted.changed:
        await db.mark_job_done(job_id)
        await events.publish_job_event(
            user_id, job_id, "done", percent=100, transcript_id=transcript_id
        )
        log.info("source-refresh-unchanged", transcript_id=transcript_id)
        return

    from .pipeline import _complete_persisted_job

    await _complete_persisted_job(
        user_id=user_id, transcript_id=transcript_id, job_id=job_id, log=log
    )
    log.info("scrape-done", transcript_id=transcript_id, refresh=bool(refresh_transcript_id))


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
    refresh_transcript_id: str | None,
    log: Any,  # noqa: ANN401
) -> PersistResult:
    if refresh_transcript_id:
        # FOR UPDATE em autocommit não protege o tempo gasto com título,
        # thumbnail e storage. O lock de sessão permanece no MESMO connection
        # até a escrita final, então refreshes concorrentes reavaliam o checksum
        # já atualizado e não duplicam versão/custo.
        async with db.connection() as locked_conn:
            lock_key = f"voxen:source-refresh:{refresh_transcript_id}"
            await locked_conn.execute("SELECT pg_advisory_lock(hashtext($1))", lock_key)
            try:
                return await _persist_locked(
                    user_id=user_id,
                    job_id=job_id,
                    source_url=source_url,
                    result=result,
                    refresh_transcript_id=refresh_transcript_id,
                    log=log,
                    locked_conn=locked_conn,
                )
            finally:
                await locked_conn.execute("SELECT pg_advisory_unlock(hashtext($1))", lock_key)
    return await _persist_locked(
        user_id=user_id,
        job_id=job_id,
        source_url=source_url,
        result=result,
        refresh_transcript_id=None,
        log=log,
        locked_conn=None,
    )


async def _persist_locked(
    *,
    user_id: str,
    job_id: str,
    source_url: str,
    result: scraper.ScrapeResult,
    refresh_transcript_id: str | None,
    log: Any,  # noqa: ANN401
    locked_conn: Any | None,  # noqa: ANN401
) -> PersistResult:
    """Persiste uma fonte nova ou atualiza sua versão somente se ela mudou."""
    import json

    checksum = _source_checksum(result.plain_text)
    metadata = _source_metadata(result)

    # A decisão de idempotência acontece antes de thumbnail, título ou upload:
    # uma consulta sem mudança não chama IA nem sobrescreve storage.
    if refresh_transcript_id:
        assert locked_conn is not None
        async with locked_conn.transaction():
            await db.assert_job_lease_in_connection(locked_conn, job_id=job_id, user_id=user_id)
            current = await locked_conn.fetchrow(
                """
                SELECT id, "plainText", "mdPath", "sourceChecksum", "sourceVersion",
                       "sourceMetadata", source
                FROM "Transcript"
                WHERE id = $1 AND "userId" = $2
                """,
                refresh_transcript_id,
                user_id,
            )
            if not current or current["source"] != "WEB":
                raise PermanentError.public(
                    "SOURCE_REFRESH_MISSING",
                    "A fonte não está mais disponível para atualização.",
                )
            current_checksum = current["sourceChecksum"] or _source_checksum(current["plainText"])
            current_version = int(current["sourceVersion"] or 0)
            baseline_version = current_version or 1
            if current_checksum == checksum:
                await locked_conn.execute(
                    """
                    UPDATE "Transcript"
                    SET "sourceChecksum" = $3,
                        "sourceVersion" = $4,
                        "sourceCollectedAt" = NOW(),
                        "sourceMetadata" = $5::jsonb,
                        "sourceRefreshStatus" = 'CURRENT'::"SourceRefreshStatus",
                        "sourceRefreshError" = NULL,
                        "updatedAt" = NOW()
                    WHERE id = $1 AND "userId" = $2
                    """,
                    refresh_transcript_id,
                    user_id,
                    checksum,
                    baseline_version,
                    json.dumps(metadata),
                )
                # Legados passam a ter o primeiro snapshot sem criar conteúdo novo.
                await locked_conn.execute(
                    """
                    INSERT INTO "SourceContentVersion" (
                      id, "userId", "transcriptId", version, checksum,
                      "mdPath", "plainText", metadata
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
                    ON CONFLICT ("transcriptId", checksum) DO NOTHING
                    """,
                    db.generate_cuid(),
                    user_id,
                    refresh_transcript_id,
                    baseline_version,
                    checksum,
                    current["mdPath"],
                    current["plainText"],
                    json.dumps(metadata),
                )
                return PersistResult(refresh_transcript_id, changed=False)
        transcript_id = refresh_transcript_id
        next_version = baseline_version + 1
        old_snapshot = {
            "version": baseline_version,
            "checksum": current_checksum,
            "md_path": current["mdPath"],
            "plain_text": current["plainText"],
            "metadata": _json_object(current["sourceMetadata"]),
        }
    else:
        transcript_id = db.generate_cuid()
        next_version = 1
        old_snapshot = None

    md_key = storage.source_version_key(user_id, transcript_id, next_version)
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

    frontmatter: dict[str, Any] = {
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
        frontmatter["preview"] = {
            "objectKey": preview_object_key,
            "mimeType": preview_mime_type,
        }

    async with _persist_connection(locked_conn) as conn:
        await db.assert_job_lease_in_connection(conn, job_id=job_id, user_id=user_id)
        if old_snapshot:
            # Snapshot da versão anterior antes de mover o ponteiro do Transcript.
            await conn.execute(
                """
                INSERT INTO "SourceContentVersion" (
                  id, "userId", "transcriptId", version, checksum, "mdPath", "plainText", metadata
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
                ON CONFLICT ("transcriptId", checksum) DO NOTHING
                """,
                db.generate_cuid(),
                user_id,
                transcript_id,
                old_snapshot["version"],
                old_snapshot["checksum"],
                old_snapshot["md_path"],
                old_snapshot["plain_text"],
                json.dumps(old_snapshot["metadata"]),
            )
            await conn.execute(
                """
                UPDATE "Transcript"
                SET url = $3, title = $4, channel = $5, author = $6,
                    "publishedAt" = $7, "thumbnailUrl" = $8, language = $9,
                    "mdPath" = $10, "plainText" = $11, frontmatter = $12::jsonb,
                    "previewObjectKey" = $13, "previewMimeType" = $14,
                    "summaryMd" = NULL, "taggingStatus" = 'PENDING'::"EnrichmentStatus",
                    "summaryStatus" = 'PENDING'::"EnrichmentStatus",
                    "summaryAttempts" = 0, "summaryStartedAt" = NULL,
                    "summaryNextAttemptAt" = NULL, "summaryError" = NULL,
                    "taggingAttempts" = 0, "taggingStartedAt" = NULL,
                    "taggingNextAttemptAt" = NULL, "taggingError" = NULL,
                    "sourceChecksum" = $15, "sourceVersion" = $16,
                    "sourceCollectedAt" = NOW(), "sourceMetadata" = $17::jsonb,
                    "sourceRefreshStatus" = 'CURRENT'::"SourceRefreshStatus",
                    "sourceRefreshError" = NULL, "updatedAt" = NOW()
                WHERE id = $1 AND "userId" = $2
                """,
                transcript_id,
                user_id,
                result.url,
                title,
                result.site_name,
                result.author,
                _naive_datetime(result.published_at),
                thumbnail_url,
                result.language or "und",
                md_key,
                result.plain_text,
                json.dumps(frontmatter, default=str),
                preview_object_key,
                preview_mime_type,
                checksum,
                next_version,
                json.dumps(metadata),
            )
            # Tags e citações dependem da versão de texto, ao contrário de pasta
            # e identidade do conteúdo, que permanecem estáveis.
            await conn.execute(
                'DELETE FROM "TranscriptTag" WHERE "transcriptId" = $1', transcript_id
            )
            await _mark_transcript_citations_stale(conn, transcript_id)
        else:
            await conn.execute(
                """
            INSERT INTO "Transcript" (
                id, "userId", source, url, title, channel, author, "durationSec",
                "publishedAt", "thumbnailUrl", language, "transcriptionMethod",
                model, "costUsd", "mdPath", "plainText", frontmatter,
                "previewObjectKey", "previewMimeType",
                "sourceChecksum", "sourceVersion", "sourceCollectedAt", "sourceMetadata",
                "sourceRefreshStatus",
                "createdAt", "updatedAt"
            ) VALUES (
                $1, $2, 'WEB'::"TranscriptSource", $3, $4, $5, $6, 0,
                $7, $8, $9, 'SCRAPE'::"TranscriptionMethod",
                NULL, 0, $10, $11, $12::jsonb,
                $13, $14,
                $15, 1, NOW(), $16::jsonb, 'CURRENT'::"SourceRefreshStatus",
                NOW(), NOW()
            )
            """,
                transcript_id,
                user_id,
                result.url,
                title,
                result.site_name,
                result.author,
                _naive_datetime(result.published_at),
                thumbnail_url,
                result.language or "und",
                md_key,
                result.plain_text,
                json.dumps(frontmatter, default=str),
                preview_object_key,
                preview_mime_type,
                checksum,
                json.dumps(metadata),
            )
        await conn.execute(
            """
            INSERT INTO "SourceContentVersion" (
              id, "userId", "transcriptId", version, checksum, "mdPath", "plainText", metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
            """,
            db.generate_cuid(),
            user_id,
            transcript_id,
            next_version,
            checksum,
            md_key,
            result.plain_text,
            json.dumps(metadata),
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
        if not refresh_transcript_id:
            await db.link_job_transcript_in_connection(conn, job_id, transcript_id)
    if not old_snapshot:
        await _maybe_assign_folder(
            user_id=user_id,
            job_id=job_id,
            transcript_id=transcript_id,
            title=title,
            content=result.plain_text,
            fallback_model=None,
            log=log,
        )
    return PersistResult(transcript_id, changed=True)


@asynccontextmanager
async def _persist_connection(existing_conn: Any | None) -> AsyncIterator[Any]:  # noqa: ANN401
    if existing_conn is not None:
        async with existing_conn.transaction():
            yield existing_conn
        return
    async with db.connection() as conn:
        async with conn.transaction():
            yield conn


def _source_checksum(plain_text: str) -> str:
    """Ignora apenas diferenças de espaços causadas pelo extrator."""
    normalized = " ".join(plain_text.split())
    return sha256(normalized.encode("utf-8")).hexdigest()


def _source_metadata(result: scraper.ScrapeResult) -> dict[str, str | None]:
    return {
        "url": result.url,
        "siteName": result.site_name,
        "author": result.author,
        "publishedAt": result.published_at.isoformat() if result.published_at else None,
        "language": result.language,
    }


def _naive_datetime(value: Any) -> Any:  # noqa: ANN401
    return value.replace(tzinfo=None) if value and value.tzinfo else value


def _json_object(value: Any) -> dict[str, Any]:  # noqa: ANN401
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        import json

        try:
            decoded = json.loads(value)
            return decoded if isinstance(decoded, dict) else {}
        except ValueError:
            return {}
    return {}


async def _mark_transcript_citations_stale(conn: Any, transcript_id: str) -> None:  # noqa: ANN401
    """Conserva citações históricas, mas retira o selo de versão atual."""
    await conn.execute(
        """
        UPDATE "ChatMessage"
        SET citations = (
          SELECT jsonb_agg(
            CASE WHEN citation->>'sourceId' = $1
              THEN citation || '{"stale": true, "verified": false}'::jsonb
              ELSE citation
            END
          )
          FROM jsonb_array_elements(citations) AS citation
        )
        WHERE jsonb_typeof(citations) = 'array'
          AND citations @> jsonb_build_array(jsonb_build_object('sourceId', $1))
        """,
        transcript_id,
    )


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
        config = await voxen_settings.get_openrouter_model_config(("default_chat_model",))
        if not config.api_key or not config.model:
            return fallback_title
        api_key = config.api_key
        model = config.model
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
        log.warning(
            "web-title-generation-failed",
            **error_diagnostic(e, "WEB_TITLE_GENERATION_FAILED"),
        )
        return fallback_title


def _check_cancel(job_id: str) -> None:
    if is_cancelled(job_id):
        raise CancelledException()
