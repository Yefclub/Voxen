"""Orquestrador: processa um Job do início ao fim (spec 002)."""

from __future__ import annotations

import asyncio
import os
import tempfile
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import botocore.exceptions
import structlog
import yt_dlp.utils

from . import db, events, storage, video_url, voxen_settings, ytdl
from .audio_chunking import AudioChunk, split_audio
from .cancellation import CancelledException, clear_cancelled, is_cancelled
from .openrouter import (
    OpenrouterAuthError,
    OpenrouterTransientError,
    transcribe_audio,
)
from .transcript_md import Segment, TranscriptDoc, render_markdown, render_plain_text

logger = structlog.get_logger(__name__)


class PermanentError(Exception):
    """Erro que NÃO deve ser retentado (URL inválida, vídeo > 4h, OR auth)."""


class TransientError(Exception):
    """Erro retentável (rede, 5xx)."""


# Exceptions externas tratadas como transientes pelo `_retry_transient`.
# yt-dlp e botocore herdam direto de `Exception`, NÃO de OSError/RuntimeError —
# sem este wrapper, o retry helper viraria no-op para yt-dlp e Garage.
# Spec 002 L61 (yt-dlp retry) e L64 (Garage retry) dependem disso.
_TRANSIENT_EXC: tuple[type[BaseException], ...] = (
    TransientError,
    OSError,
    RuntimeError,  # ffmpeg subprocess + RuntimeErrors levantados nos wrappers
    yt_dlp.utils.YoutubeDLError,
    botocore.exceptions.BotoCoreError,
    botocore.exceptions.ClientError,
)


async def process_job(job_id: str) -> None:
    """Executa o pipeline completo para `job_id`. Faz claim, processa, finaliza."""
    claimed = await db.claim_job(job_id)
    if claimed is None:
        logger.info("job-not-claimable", job_id=job_id)
        return

    user_id: str = claimed["userId"]
    source_url: str = claimed["sourceUrl"]
    job_type: str = claimed["type"]
    log = logger.bind(job_id=job_id, user_id=user_id, url=source_url, type=job_type)
    log.info("job-claimed")

    # Já cancelado antes mesmo de começar (DB já está CANCELLED via endpoint).
    if is_cancelled(job_id):
        log.info("job-cancelled-before-start")
        clear_cancelled(job_id)
        await events.publish_job_event(
            user_id, job_id, "cancelled", error_msg="Cancelado pelo usuário."
        )
        return

    await events.publish_job_event(user_id, job_id, "running", percent=0)

    try:
        if job_type == "SCRAPE_WEB":
            from . import scrape_pipeline

            await scrape_pipeline.run(
                job_id=job_id, user_id=user_id, source_url=source_url, log=log
            )
        else:
            await _run_pipeline(
                job_id=job_id, user_id=user_id, source_url=source_url, log=log
            )
    except CancelledException:
        log.info("job-cancelled-mid-pipeline")
        # DB já foi atualizado para CANCELLED pelo endpoint. Só publica evento final.
        await events.publish_job_event(
            user_id, job_id, "cancelled", error_msg="Cancelado pelo usuário."
        )
    except PermanentError as e:
        log.warning("job-failed-permanent", error=str(e))
        await db.mark_job_failed(job_id, str(e))
        await events.publish_job_event(user_id, job_id, "failed", error_msg=str(e))
    except Exception as e:  # noqa: BLE001 — propaga genérico p/ FAILED
        log.exception("job-failed-unexpected")
        msg = f"Erro inesperado: {e}"
        await db.mark_job_failed(job_id, msg)
        await events.publish_job_event(user_id, job_id, "failed", error_msg=msg)
    finally:
        clear_cancelled(job_id)


def _check_cancel(job_id: str) -> None:
    """Levanta CancelledException se o user pediu cancelamento."""
    if is_cancelled(job_id):
        raise CancelledException()


async def _run_pipeline(*, job_id: str, user_id: str, source_url: str, log: Any) -> None:  # noqa: ANN401
    _check_cancel(job_id)
    await events.publish_job_event(user_id, job_id, "downloading", percent=5)

    probe_info = await _retry_transient(lambda: ytdl.probe(source_url), tries=3)
    if probe_info.duration_sec > ytdl.MAX_DURATION_SEC:
        raise PermanentError("Vídeo excede a duração máxima de 4 horas.")

    _check_cancel(job_id)
    await events.publish_job_event(user_id, job_id, "choosing_method", percent=10)
    sub_pick = ytdl.pick_subtitle_lang(probe_info)

    with tempfile.TemporaryDirectory(prefix="voxen-") as tmp:
        tmpdir = Path(tmp)
        if sub_pick is not None:
            lang, fmt = sub_pick
            log.info("path-subtitles", lang=lang, fmt=fmt)
            sub_path = await _retry_transient(
                lambda: ytdl.download_subtitle(source_url, lang, fmt, tmpdir), tries=3
            )
            content = sub_path.read_text(encoding="utf-8")
            segments = ytdl.parse_vtt_or_srt(content)
            method = "SUBTITLES"
            model = None
            cost_total = Decimal("0")
            language = lang.split("-")[0]
        else:
            log.info("path-api")
            audio_path = await _retry_transient(
                lambda: ytdl.download_audio_opus(source_url, tmpdir), tries=3
            )
            await events.publish_job_event(user_id, job_id, "transcribing", percent=30)
            segments, model, cost_total = await _transcribe_via_api(
                audio_path=audio_path,
                user_id=user_id,
                job_id=job_id,
                duration_sec=probe_info.duration_sec,
                tmpdir=tmpdir,
                log=log,
            )
            method = "API"
            language = probe_info.language_hint or "auto"

        if not segments:
            raise PermanentError("Transcrição vazia — nenhum texto extraído.")

        _check_cancel(job_id)
        await events.publish_job_event(user_id, job_id, "uploading", percent=80)
        new_transcript_id = await _persist(
            user_id=user_id,
            job_id=job_id,
            probe_info=probe_info,
            source_url=source_url,
            segments=segments,
            method=method,
            model=model,
            cost_usd=cost_total if method == "API" else None,
            language=language,
        )

    await events.publish_job_event(user_id, job_id, "indexing", percent=95)
    await db.link_job_done(job_id, new_transcript_id)

    # Resumo via IA — best-effort, não bloqueia entrega.
    await _maybe_generate_summary(
        user_id=user_id,
        transcript_id=new_transcript_id,
        job_id=job_id,
        log=log,
    )

    await events.publish_job_event(
        user_id, job_id, "done", percent=100, transcript_id=new_transcript_id
    )
    log.info("job-done", transcript_id=new_transcript_id)


async def _maybe_generate_summary(
    *, user_id: str, transcript_id: str, job_id: str, log: Any  # noqa: ANN401
) -> None:
    """Delega geração de summary pro chat service (`/summarize-transcript`).

    O chat service é o owner único do prompt e da chamada ao OpenRouter —
    isso elimina duplicação entre worker e chat. Worker só fornece o input
    (title + plainText) e o user_id no header. Chat service grava o
    summaryMd e o CostEvent.

    Falhas viram warning, não bloqueiam o Job (summary é best-effort).
    """
    # Respeita cancel pedido entre link_job_done e o summary (janela curta).
    if is_cancelled(job_id):
        log.info("summary-skipped-cancelled")
        return
    try:
        async with db.connection() as conn:
            row = await conn.fetchrow(
                'SELECT title, "plainText" FROM "Transcript" WHERE id = $1',
                transcript_id,
            )
        if not row or not row["plainText"]:
            log.info("summary-skipped-empty-text")
            return

        import httpx

        chat_url = os.environ.get("CHAT_SERVICE_URL", "http://chat:8001")
        async with httpx.AsyncClient(timeout=120.0) as client:
            res = await client.post(
                f"{chat_url}/summarize-transcript",
                headers={"X-Voxen-User-Id": user_id},
                json={
                    "transcript_id": transcript_id,
                    "title": row["title"],
                    "plain_text": row["plainText"],
                },
            )
        if res.status_code != 200:
            log.warning(
                "summary-upstream-non-200",
                status=res.status_code,
                body=res.text[:200],
            )
            return
        data = res.json()
        if data.get("summary_md"):
            log.info("summary-done", transcript_id=transcript_id)
        else:
            log.info("summary-empty")
    except Exception:  # noqa: BLE001 — resumo é melhoria, não bloqueia
        log.exception("summary-failed", transcript_id=transcript_id)


async def _transcribe_via_api(
    *,
    audio_path: Path,
    user_id: str,
    job_id: str,
    duration_sec: int,
    tmpdir: Path,
    log: Any,  # noqa: ANN401
) -> tuple[tuple[Segment, ...], str, Decimal]:
    api_key = await voxen_settings.get_openrouter_api_key()
    if not api_key:
        raise PermanentError("Setup incompleto — chave da OpenRouter ausente.")
    model = await voxen_settings.get_default_transcription_model()
    if not model:
        raise PermanentError("Setup incompleto — modelo de transcrição padrão ausente.")

    chunks: list[AudioChunk] = await split_audio(audio_path, tmpdir, duration_sec)
    total_chunks = len(chunks)
    all_segments: list[Segment] = []
    total_cost = Decimal("0")

    for i, chunk in enumerate(chunks):
        _check_cancel(job_id)
        await events.publish_job_event(
            user_id,
            job_id,
            "transcribing",
            percent=int(30 + (i / total_chunks) * 50),
            chunk_index=i,
        )
        chunk_path = chunk.path

        async def _do_call(path: Path = chunk_path) -> Any:
            return await _call_or(path, api_key, model)

        result = await _retry_transient_or(_do_call, tries=3)
        await db.insert_cost_event(
            user_id=user_id,
            kind="TRANSCRIBE",
            model=model,
            cost_usd=result.cost_usd,
            job_id=job_id,
            meta={"chunk_index": i, "duration_sec": chunk.duration_sec},
        )
        total_cost += result.cost_usd
        # Spec: OpenRouter retorna texto por chunk; sem timestamps refinados nesta
        # versão. Tratamos o chunk todo como um segmento iniciando em chunk.start_sec.
        # Refino (response_format=verbose_json com word timestamps) é melhoria.
        if result.text.strip():
            all_segments.append(Segment(start_sec=float(chunk.start_sec), text=result.text))
        log.info("chunk-done", index=i, chars=len(result.text), cost=str(result.cost_usd))

    return tuple(all_segments), model, total_cost


async def _call_or(
    audio_path: Path, api_key: str, model: str
) -> Any:  # noqa: ANN401 — TranscriptionResult
    return await transcribe_audio(audio_path=audio_path, api_key=api_key, model=model)


async def _persist(
    *,
    user_id: str,
    job_id: str,
    probe_info: ytdl.VideoProbe,
    source_url: str,
    segments: tuple[Segment, ...],
    method: str,
    model: str | None,
    cost_usd: Decimal | None,
    language: str,
) -> str:
    # Gera transcript_id e doc completo
    transcribed_at = datetime.now(UTC)
    # Reservamos id antecipado pra usar no path do Garage; db.write_transcript
    # gera o id e o devolve, mas precisamos do md ANTES do insert.
    # Solução: gerar o id aqui (mesmo padrão do db._generate_cuid) e passar.
    transcript_id = db._generate_cuid()  # noqa: SLF001 — uso interno controlado

    # Detecta plataforma pela URL canonical (YouTube/Instagram/TikTok).
    # Fallback "YOUTUBE" cobre URLs antigas ou edge cases — não-bloqueador.
    source = video_url.detect_source(source_url) or "YOUTUBE"

    doc = TranscriptDoc(
        transcript_id=transcript_id,
        user_id=user_id,
        source=source,
        url=source_url,
        video_id=probe_info.video_id,
        title=probe_info.title,
        channel=probe_info.channel,
        author=None,
        duration_sec=probe_info.duration_sec,
        published_at=probe_info.published_at,
        thumbnail_url=probe_info.thumbnail_url,
        language=language,
        transcription_method=method,
        model=model,
        cost_usd=cost_usd,
        segments=segments,
        transcribed_at=transcribed_at,
    )
    md_content = render_markdown(doc)
    plain_text = render_plain_text(doc)
    md_key = storage.transcript_key(user_id, transcript_id)

    await _retry_transient(
        lambda: storage.put_markdown(key=md_key, content=md_content), tries=3
    )

    # Insert no Postgres (passamos o mesmo id usado no path do Garage)
    async with db.connection() as conn:
        await conn.execute(
            """
            INSERT INTO "Transcript" (
                id, "userId", source, url, title, channel, author, "durationSec",
                "publishedAt", "thumbnailUrl", language, "transcriptionMethod",
                model, "costUsd", "mdPath", "plainText", frontmatter,
                "createdAt", "updatedAt"
            ) VALUES (
                $1, $2, $3::"TranscriptSource", $4, $5, $6, $7, $8, $9, $10, $11,
                $12::"TranscriptionMethod", $13, $14, $15, $16, $17::jsonb,
                NOW(), NOW()
            )
            """,
            transcript_id,
            user_id,
            doc.source,
            doc.url,
            doc.title,
            doc.channel,
            doc.author,
            doc.duration_sec,
            doc.published_at.replace(tzinfo=None)
            if doc.published_at and doc.published_at.tzinfo
            else doc.published_at,
            doc.thumbnail_url,
            doc.language,
            doc.transcription_method,
            doc.model,
            doc.cost_usd,
            md_key,
            plain_text,
            _frontmatter_json(doc),
        )
    return transcript_id


def _frontmatter_json(doc: TranscriptDoc) -> str:
    import json

    from .transcript_md import build_frontmatter

    return json.dumps(build_frontmatter(doc), default=str)


# ============================================================================
# Retry helpers
# ============================================================================


async def _retry_transient[T](
    fn: Callable[[], Awaitable[T]], *, tries: int = 3, base_delay: float = 1.0
) -> T:
    """Retry exp backoff (1/2/4 s) para erros transientes externos.

    Captura `_TRANSIENT_EXC` (TransientError, OSError, yt-dlp YoutubeDLError,
    botocore BotoCoreError/ClientError). OpenRouter usa `_retry_transient_or`
    separado porque distingue auth (permanente) de 5xx (transiente).
    """
    last_exc: BaseException | None = None
    for attempt in range(tries):
        try:
            return await fn()
        except _TRANSIENT_EXC as e:
            last_exc = e
            if attempt < tries - 1:
                await asyncio.sleep(base_delay * (2**attempt))
            continue
    assert last_exc is not None
    raise last_exc


async def _retry_transient_or[T](
    fn: Callable[[], Awaitable[T]], *, tries: int = 3, base_delay: float = 1.0
) -> T:
    """Retry específico OpenRouter: auth = permanente; transient = backoff."""
    last_exc: Exception | None = None
    for attempt in range(tries):
        try:
            return await fn()
        except OpenrouterAuthError as e:
            raise PermanentError("Chave da OpenRouter rejeitada — admin precisa revalidar.") from e
        except OpenrouterTransientError as e:
            last_exc = e
            if attempt < tries - 1:
                await asyncio.sleep(base_delay * (2**attempt))
            continue
    assert last_exc is not None
    raise last_exc
