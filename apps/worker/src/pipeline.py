"""Orquestrador: processa um Job do início ao fim (spec 002)."""

from __future__ import annotations

import asyncio
import tempfile
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import botocore.exceptions
import structlog
import yt_dlp.utils

from . import (
    db,
    document_ingest,
    events,
    storage,
    summary,
    uploaded_media,
    video_url,
    voxen_settings,
    ytdl,
)
from .audio_chunking import AudioChunk, split_audio
from .audio_probe import AudioValidationError, validate_audio_for_transcription
from .cancellation import CancelledException, clear_cancelled, is_cancelled
from .openrouter import (
    OpenrouterAuthError,
    OpenrouterTransientError,
    analyze_document_text,
    analyze_image,
    analyze_pdf_native,
    analyze_x_url,
    generate_content_title,
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
# sem este wrapper, o retry helper viraria no-op para yt-dlp e S3.
# Spec 002 L61 (yt-dlp retry) e L64 (S3 retry) dependem disso.
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
        elif job_type == "UPLOAD_AND_TRANSCRIBE":
            await _run_upload_pipeline(
                job_id=job_id, user_id=user_id, source_url=source_url, log=log
            )
        elif job_type == "UPLOAD_AND_ANALYZE_IMAGE":
            await _run_image_pipeline(
                job_id=job_id, user_id=user_id, source_url=source_url, log=log
            )
        elif job_type == "UPLOAD_AND_ANALYZE_DOCUMENT":
            await _run_document_pipeline(
                job_id=job_id, user_id=user_id, source_url=source_url, log=log
            )
        elif job_type == "ANALYZE_X":
            await _run_x_analysis_pipeline(
                job_id=job_id, user_id=user_id, source_url=source_url, log=log
            )
        else:
            await _run_pipeline(job_id=job_id, user_id=user_id, source_url=source_url, log=log)
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


def _friendly_external_error(exc: BaseException) -> str | None:
    text = str(exc).lower()
    if "tiktok" in text and (
        "unable to extract" in text or "rehydration" in text or "universal data" in text
    ):
        return (
            "Não consegui extrair este conteúdo do TikTok agora. "
            "O TikTok muda a estrutura da página com frequência e às vezes bloqueia "
            "downloads automatizados. Tente novamente em alguns minutos; se continuar "
            "falhando, baixe o vídeo e envie por upload manual."
        )
    if (
        "sign in to confirm" in text
        or "not a bot" in text
        or "cookies-from-browser" in text
        or "cookies for the authentication" in text
    ):
        return (
            "O YouTube bloqueou o download automatizado deste vídeo. "
            "Opções: envie o arquivo por upload manual, "
            "ou peça ao admin para configurar um proxy residencial nas configurações da instância. "
            "Por que isso acontece em VPS? Veja docs/DEPLOY.md (Home-lab vs VPS)."
        )
    if "unable to obtain file audio codec" in text or ("ffprobe" in text and "audio" in text):
        return (
            "Este conteúdo foi servido sem faixa de áudio (a plataforma entregou só "
            "vídeo, ou exige login). Não dá pra transcrever sem áudio. Tente novamente "
            "em alguns minutos ou envie o arquivo por upload manual."
        )
    if "private video" in text or "login required" in text or "members-only" in text:
        return (
            "Este vídeo exige login ou não está público. "
            "Envie um link público ou faça upload do arquivo."
        )
    if "video unavailable" in text or "this video is unavailable" in text:
        return (
            "Este vídeo não está disponível para download. "
            "Tente outro link ou envie o arquivo por upload."
        )
    return None


def _check_cancel(job_id: str) -> None:
    """Levanta CancelledException se o user pediu cancelamento."""
    if is_cancelled(job_id):
        raise CancelledException()


async def _run_pipeline(*, job_id: str, user_id: str, source_url: str, log: Any) -> None:  # noqa: ANN401
    _check_cancel(job_id)
    await events.publish_job_event(user_id, job_id, "downloading", percent=5)

    transcript_fetch = await ytdl.fetch_youtube_transcript(source_url)
    if transcript_fetch is not None:
        log.info("path-youtube-transcript-api", lang=transcript_fetch.language)
        probe_info = transcript_fetch.probe
        if probe_info.duration_sec > ytdl.MAX_DURATION_SEC:
            raise PermanentError("Vídeo excede a duração máxima de 4 horas.")
        _check_cancel(job_id)
        await events.publish_job_event(user_id, job_id, "choosing_method", percent=10)
        segments = transcript_fetch.segments
        method = "SUBTITLES"
        model = None
        cost_total: Decimal | None = None
        language = transcript_fetch.language
    else:
        probe_info = await _retry_transient(lambda: ytdl.probe(source_url), tries=3)
        if probe_info.duration_sec > ytdl.MAX_DURATION_SEC:
            raise PermanentError("Vídeo excede a duração máxima de 4 horas.")

        _check_cancel(job_id)
        await events.publish_job_event(user_id, job_id, "choosing_method", percent=10)
        sub_pick = ytdl.pick_subtitle_lang(probe_info)

        with tempfile.TemporaryDirectory(prefix="voxen-") as tmp:
            tmpdir = Path(tmp)
            subtitle_segments: tuple[Segment, ...] | None = None
            subtitle_lang: str | None = None

            if sub_pick is not None:
                lang, fmt = sub_pick
                log.info("path-subtitles", lang=lang, fmt=fmt)
                try:
                    sub_path = await _retry_transient(
                        lambda: ytdl.download_subtitle(source_url, lang, fmt, tmpdir),
                        tries=3,
                    )
                    content = sub_path.read_text(encoding="utf-8")
                    subtitle_segments = ytdl.parse_vtt_or_srt(content)
                    subtitle_lang = lang
                except _TRANSIENT_EXC as e:
                    # YouTube rate-limita download de subtitles (HTTP 429) com
                    # frequência. Em vez de FAILED, caímos pro path API (Whisper) —
                    # é mais caro mas funciona. Probe já passou, vídeo existe.
                    log.warning(
                        "subtitle-failed-fallback-api",
                        lang=lang,
                        error=str(e)[:200],
                    )

            if subtitle_segments is not None and subtitle_lang is not None:
                segments = subtitle_segments
                method = "SUBTITLES"
                model = None
                cost_total = None
                language = subtitle_lang.split("-")[0]
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

    source_for_label = video_url.detect_source(source_url) or "VIDEO"
    content_for_title = "\n".join(seg.text.strip() for seg in segments if seg.text.strip())
    generated_title = await _maybe_generate_title(
        user_id=user_id,
        job_id=job_id,
        content=content_for_title,
        source_label=f"Vídeo {source_for_label}",
        fallback_title=probe_info.title,
        fallback_model=model,
        log=log,
    )

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
        title_override=generated_title,
    )

    await events.publish_job_event(user_id, job_id, "indexing", percent=95)
    await db.link_job_transcript(job_id, new_transcript_id)

    await _generate_summary_with_progress(
        user_id=user_id, transcript_id=new_transcript_id, job_id=job_id, log=log
    )

    await db.mark_job_done(job_id)
    await events.publish_job_event(
        user_id, job_id, "done", percent=100, transcript_id=new_transcript_id
    )
    log.info("job-done", transcript_id=new_transcript_id)


async def _run_upload_pipeline(*, job_id: str, user_id: str, source_url: str, log: Any) -> None:  # noqa: ANN401
    ref = uploaded_media.parse_upload_source_url(source_url)
    if ref is None:
        raise PermanentError("Upload inválido ou corrompido.")

    _check_cancel(job_id)
    await events.publish_job_event(user_id, job_id, "preparing_upload", percent=5)

    with tempfile.TemporaryDirectory(prefix="voxen-upload-") as tmp:
        tmpdir = Path(tmp)
        raw_path = tmpdir / ref.filename
        audio_path = tmpdir / "audio.opus"
        key = storage.upload_key(user_id, ref.upload_id, ref.filename)
        original_mime_type = uploaded_media.guess_mime_type(ref.filename)

        await _retry_transient(lambda: storage.download_to_file(key=key, dest=raw_path), tries=3)

        _check_cancel(job_id)
        try:
            duration_sec = await _retry_transient(
                lambda: uploaded_media.probe_duration_sec(raw_path), tries=2
            )
        except RuntimeError as e:
            raise PermanentError(
                "Não foi possível ler a mídia enviada. Confirme que o arquivo é áudio ou vídeo."
            ) from e
        if duration_sec > ytdl.MAX_DURATION_SEC:
            raise PermanentError("Arquivo excede a duração máxima de 4 horas.")

        _check_cancel(job_id)
        await events.publish_job_event(user_id, job_id, "extracting_audio", percent=15)
        try:
            await _retry_transient(
                lambda: uploaded_media.extract_audio_opus(raw_path, audio_path), tries=2
            )
        except RuntimeError as e:
            raise PermanentError(
                "Não foi possível extrair áudio deste arquivo. "
                "Envie uma mídia com faixa de áudio reproduzível."
            ) from e

        probe_info = ytdl.VideoProbe(
            video_id=ref.upload_id,
            title=Path(ref.filename).stem or ref.filename,
            channel="Upload local",
            duration_sec=duration_sec,
            published_at=None,
            thumbnail_url=None,
            language_hint=None,
            available_subtitles={},
            automatic_captions={},
        )
        preview_object_key: str | None = None
        preview_mime_type: str | None = None
        if uploaded_media.is_video_mime(original_mime_type):
            preview_path = tmpdir / "preview.jpg"
            try:
                await uploaded_media.extract_video_preview_jpeg(raw_path, preview_path)
                preview_object_key = storage.upload_preview_key(
                    user_id, ref.upload_id, ref.filename
                )
                preview_mime_type = "image/jpeg"
                await _retry_transient(
                    lambda: storage.put_file(
                        key=preview_object_key,
                        path=preview_path,
                        content_type=preview_mime_type,
                    ),
                    tries=3,
                )
            except Exception as e:  # noqa: BLE001 — preview é best-effort
                log.warning("upload-preview-generation-failed", error=str(e)[:240])
        await events.publish_job_event(user_id, job_id, "transcribing", percent=30)
        segments, model, cost_total = await _transcribe_via_api(
            audio_path=audio_path,
            user_id=user_id,
            job_id=job_id,
            duration_sec=duration_sec,
            tmpdir=tmpdir,
            log=log,
        )
        if not segments:
            raise PermanentError("Transcrição vazia — nenhum texto extraído.")

        generated_title = await _maybe_generate_title(
            user_id=user_id,
            job_id=job_id,
            content="\n".join(segment.text for segment in segments),
            source_label="Upload de áudio/vídeo",
            fallback_title=Path(ref.filename).stem or ref.filename,
            fallback_model=model,
            log=log,
        )

        _check_cancel(job_id)
        await events.publish_job_event(user_id, job_id, "uploading", percent=80)
        new_transcript_id = await _persist(
            user_id=user_id,
            job_id=job_id,
            probe_info=probe_info,
            source_url=source_url,
            segments=segments,
            method="API",
            model=model,
            cost_usd=cost_total,
            language="auto",
            source_override="UPLOAD",
            title_override=generated_title,
            original_object_key=key,
            original_filename=ref.filename,
            original_mime_type=original_mime_type,
            preview_object_key=preview_object_key,
            preview_mime_type=preview_mime_type,
        )

    await events.publish_job_event(user_id, job_id, "indexing", percent=95)
    await db.link_job_transcript(job_id, new_transcript_id)
    await _generate_summary_with_progress(
        user_id=user_id, transcript_id=new_transcript_id, job_id=job_id, log=log
    )
    await db.mark_job_done(job_id)
    await events.publish_job_event(
        user_id, job_id, "done", percent=100, transcript_id=new_transcript_id
    )
    log.info("upload-job-done", transcript_id=new_transcript_id)


async def _run_image_pipeline(*, job_id: str, user_id: str, source_url: str, log: Any) -> None:  # noqa: ANN401
    ref = uploaded_media.parse_upload_source_url(source_url)
    if ref is None:
        raise PermanentError("Upload inválido ou corrompido.")

    api_key = await voxen_settings.get_openrouter_api_key()
    if not api_key:
        raise PermanentError("Setup incompleto — chave da OpenRouter ausente.")
    model = await voxen_settings.get_default_vision_model()
    if not model:
        raise PermanentError("Setup incompleto — modelo de visão padrão ausente.")

    _check_cancel(job_id)
    await events.publish_job_event(user_id, job_id, "preparing_upload", percent=5)

    with tempfile.TemporaryDirectory(prefix="voxen-image-") as tmp:
        tmpdir = Path(tmp)
        image_path = tmpdir / ref.filename
        key = storage.upload_key(user_id, ref.upload_id, ref.filename)
        original_mime_type = uploaded_media.guess_mime_type(ref.filename)
        await _retry_transient(lambda: storage.download_to_file(key=key, dest=image_path), tries=3)

        _check_cancel(job_id)
        await events.publish_job_event(user_id, job_id, "analyzing_image", percent=35)
        prompt = (
            "Analise esta imagem para uma base de conhecimento. "
            "Descreva o conteúdo visual, liste texto legível/OCR, identifique contexto, "
            "objetos, pessoas, interfaces, marcas ou dados relevantes. "
            "Use markdown curto e pesquisável."
        )

        async def _do_call() -> Any:
            return await analyze_image(
                image_path=image_path,
                api_key=api_key,
                model=model,
                prompt=prompt,
            )

        result = await _retry_transient_or(_do_call, tries=3)
        if not result.text:
            raise PermanentError("Análise vazia — nenhum conteúdo foi descrito.")
        await db.insert_cost_event(
            user_id=user_id,
            kind="CHAT",
            model=model,
            tokens_in=result.tokens_in,
            tokens_out=result.tokens_out,
            cost_usd=result.cost_usd,
            job_id=job_id,
            meta={"source": "image_upload", "filename": ref.filename},
        )

        probe_info = ytdl.VideoProbe(
            video_id=ref.upload_id,
            title=Path(ref.filename).stem or ref.filename,
            channel="Imagem enviada",
            duration_sec=0,
            published_at=None,
            thumbnail_url=None,
            language_hint=None,
            available_subtitles={},
            automatic_captions={},
        )
        generated_title = await _maybe_generate_title(
            user_id=user_id,
            job_id=job_id,
            content=result.text,
            source_label="Upload de imagem",
            fallback_title=Path(ref.filename).stem or ref.filename,
            fallback_model=model,
            log=log,
        )
        _check_cancel(job_id)
        await events.publish_job_event(user_id, job_id, "uploading", percent=80)
        new_transcript_id = await _persist(
            user_id=user_id,
            job_id=job_id,
            probe_info=probe_info,
            source_url=source_url,
            segments=(Segment(start_sec=0.0, text=result.text),),
            method="VISION",
            model=model,
            cost_usd=result.cost_usd,
            language="pt",
            source_override="UPLOAD",
            title_override=generated_title,
            original_object_key=key,
            original_filename=ref.filename,
            original_mime_type=original_mime_type,
        )

    await events.publish_job_event(user_id, job_id, "indexing", percent=95)
    await db.link_job_transcript(job_id, new_transcript_id)
    await _generate_summary_with_progress(
        user_id=user_id, transcript_id=new_transcript_id, job_id=job_id, log=log
    )
    await db.mark_job_done(job_id)
    await events.publish_job_event(
        user_id, job_id, "done", percent=100, transcript_id=new_transcript_id
    )
    log.info("image-job-done", transcript_id=new_transcript_id)


async def _run_document_pipeline(
    *,
    job_id: str,
    user_id: str,
    source_url: str,
    log: Any,  # noqa: ANN401
) -> None:
    ref = uploaded_media.parse_upload_source_url(source_url)
    if ref is None:
        raise PermanentError("Upload inválido ou corrompido.")

    api_key = await voxen_settings.get_openrouter_api_key()
    if not api_key:
        raise PermanentError("Setup incompleto — chave da OpenRouter ausente.")
    model = await voxen_settings.get_default_document_model()
    if not model:
        raise PermanentError("Setup incompleto — modelo de documentos padrão ausente.")

    _check_cancel(job_id)
    await events.publish_job_event(user_id, job_id, "preparing_upload", percent=5)

    with tempfile.TemporaryDirectory(prefix="voxen-doc-") as tmp:
        tmpdir = Path(tmp)
        doc_path = tmpdir / ref.filename
        key = storage.upload_key(user_id, ref.upload_id, ref.filename)
        original_mime_type = uploaded_media.guess_mime_type(ref.filename)
        await _retry_transient(lambda: storage.download_to_file(key=key, dest=doc_path), tries=3)

        _check_cancel(job_id)
        await events.publish_job_event(user_id, job_id, "analyzing_document", percent=30)
        result: Any
        parser = "openrouter-native-pdf"
        if document_ingest.is_pdf(doc_path):

            async def _do_native_pdf() -> Any:
                return await analyze_pdf_native(pdf_path=doc_path, api_key=api_key, model=model)

            try:
                result = await _retry_transient_or(_do_native_pdf, tries=2)
            except RuntimeError as e:
                log.warning("document-native-pdf-fallback-markitdown", error=str(e)[:240])
                await events.publish_job_event(user_id, job_id, "converting_document", percent=25)
                try:
                    extracted = await document_ingest.convert_to_markdown(doc_path)
                except RuntimeError as e:
                    raise PermanentError(
                        "Não foi possível extrair texto deste PDF. "
                        "Tente um PDF com texto selecionável ou envie outro formato."
                    ) from e
                parser = "markitdown"

                async def _do_text_pdf() -> Any:
                    return await analyze_document_text(
                        markdown=extracted.markdown,
                        filename=ref.filename,
                        api_key=api_key,
                        model=model,
                    )

                result = await _retry_transient_or(_do_text_pdf, tries=3)
        else:
            await events.publish_job_event(user_id, job_id, "converting_document", percent=20)
            try:
                extracted = await document_ingest.convert_to_markdown(doc_path)
            except RuntimeError as e:
                raise PermanentError(
                    "Não foi possível extrair texto deste documento. "
                    "Confirme se o arquivo não está corrompido ou protegido."
                ) from e
            parser = "markitdown"

            async def _do_text_doc() -> Any:
                return await analyze_document_text(
                    markdown=extracted.markdown,
                    filename=ref.filename,
                    api_key=api_key,
                    model=model,
                )

            result = await _retry_transient_or(_do_text_doc, tries=3)

        if not result.text:
            raise PermanentError("Análise vazia — nenhum conteúdo foi extraído do documento.")

        await db.insert_cost_event(
            user_id=user_id,
            kind="DOCUMENT",
            model=model,
            tokens_in=result.tokens_in,
            tokens_out=result.tokens_out,
            cost_usd=result.cost_usd,
            job_id=job_id,
            meta={"source": "document_upload", "filename": ref.filename, "parser": parser},
        )

        probe_info = ytdl.VideoProbe(
            video_id=ref.upload_id,
            title=Path(ref.filename).stem or ref.filename,
            channel="Documento enviado",
            duration_sec=0,
            published_at=None,
            thumbnail_url=None,
            language_hint=None,
            available_subtitles={},
            automatic_captions={},
        )
        generated_title = await _maybe_generate_title(
            user_id=user_id,
            job_id=job_id,
            content=result.text,
            source_label="Upload de documento",
            fallback_title=Path(ref.filename).stem or ref.filename,
            fallback_model=model,
            log=log,
        )
        _check_cancel(job_id)
        await events.publish_job_event(user_id, job_id, "uploading", percent=80)
        new_transcript_id = await _persist(
            user_id=user_id,
            job_id=job_id,
            probe_info=probe_info,
            source_url=source_url,
            segments=(Segment(start_sec=0.0, text=result.text),),
            method="DOCUMENT",
            model=model,
            cost_usd=result.cost_usd,
            language="pt",
            source_override="UPLOAD",
            title_override=generated_title,
            original_object_key=key,
            original_filename=ref.filename,
            original_mime_type=original_mime_type,
        )

    await events.publish_job_event(user_id, job_id, "indexing", percent=95)
    await db.link_job_transcript(job_id, new_transcript_id)
    await _generate_summary_with_progress(
        user_id=user_id, transcript_id=new_transcript_id, job_id=job_id, log=log
    )
    await db.mark_job_done(job_id)
    await events.publish_job_event(
        user_id, job_id, "done", percent=100, transcript_id=new_transcript_id
    )
    log.info("document-job-done", transcript_id=new_transcript_id)


async def _run_x_analysis_pipeline(
    *,
    job_id: str,
    user_id: str,
    source_url: str,
    log: Any,  # noqa: ANN401
) -> None:
    if video_url.detect_source(source_url) != "X":
        raise PermanentError("Job de análise do X recebeu uma URL que não é do X.")

    api_key = await voxen_settings.get_openrouter_api_key()
    if not api_key:
        raise PermanentError("Setup incompleto — chave da OpenRouter ausente.")
    model = await voxen_settings.get_default_x_analysis_model()
    if not model:
        raise PermanentError("Setup incompleto — modelo de análise do X ausente.")

    _check_cancel(job_id)
    await events.publish_job_event(user_id, job_id, "analyzing_x", percent=30)

    async def _do_call() -> Any:
        return await analyze_x_url(url=source_url, api_key=api_key, model=model)

    result = await _retry_transient_or(_do_call, tries=3)
    if not result.text:
        raise PermanentError("Análise vazia — o conteúdo do X não pôde ser recuperado.")

    await db.insert_cost_event(
        user_id=user_id,
        kind="X_SEARCH",
        model=model,
        tokens_in=result.tokens_in,
        tokens_out=result.tokens_out,
        cost_usd=result.cost_usd,
        job_id=job_id,
        meta={"source": "x_analysis", "url": source_url},
    )

    status_id = source_url.rstrip("/").split("/")[-1]
    probe_info = ytdl.VideoProbe(
        video_id=status_id,
        title=f"Post do X {status_id}",
        channel="X",
        duration_sec=0,
        published_at=None,
        thumbnail_url=None,
        language_hint=None,
        available_subtitles={},
        automatic_captions={},
    )
    generated_title = await _maybe_generate_title(
        user_id=user_id,
        job_id=job_id,
        content=result.text,
        source_label="Publicação do X",
        fallback_title=f"Post do X {status_id}",
        fallback_model=model,
        log=log,
    )

    _check_cancel(job_id)
    await events.publish_job_event(user_id, job_id, "uploading", percent=80)
    new_transcript_id = await _persist(
        user_id=user_id,
        job_id=job_id,
        probe_info=probe_info,
        source_url=source_url,
        segments=(Segment(start_sec=0.0, text=result.text),),
        method="X_SEARCH",
        model=model,
        cost_usd=result.cost_usd,
        language="pt",
        title_override=generated_title,
    )

    await events.publish_job_event(user_id, job_id, "indexing", percent=95)
    await db.link_job_transcript(job_id, new_transcript_id)
    await _generate_summary_with_progress(
        user_id=user_id, transcript_id=new_transcript_id, job_id=job_id, log=log
    )
    await db.mark_job_done(job_id)
    await events.publish_job_event(
        user_id, job_id, "done", percent=100, transcript_id=new_transcript_id
    )
    log.info("x-analysis-job-done", transcript_id=new_transcript_id)


async def _generate_summary_with_progress(
    *,
    user_id: str,
    transcript_id: str,
    job_id: str,
    log: Any,  # noqa: ANN401
) -> None:
    # Resumo via IA — best-effort, mas agora visível no realtime da UI.
    _check_cancel(job_id)
    await events.publish_job_event(user_id, job_id, "summarizing", percent=98)
    await summary.maybe_generate(
        user_id=user_id,
        transcript_id=transcript_id,
        job_id=job_id,
        log=log,
    )
    await db.reindex_transcript_brain_node(user_id, transcript_id)


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

    # Fail fast: valida o áudio com ffprobe ANTES de fatiar e chamar a API (spec 046).
    # Barra arquivos vazios/corrompidos/sem faixa de áudio sem queimar tokens.
    try:
        await validate_audio_for_transcription(audio_path)
    except AudioValidationError as e:
        raise PermanentError(str(e)) from e

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


async def _maybe_generate_title(
    *,
    user_id: str,
    job_id: str,
    content: str,
    source_label: str,
    fallback_title: str,
    fallback_model: str | None,
    log: Any,  # noqa: ANN401
) -> str | None:
    clean_content = content.strip()
    if len(clean_content) < 40:
        return None
    try:
        api_key = await voxen_settings.get_openrouter_api_key()
        model = await voxen_settings.get_default_chat_model()
        model = model or fallback_model
        if not api_key or not model:
            return None
        result = await _retry_transient_or(
            lambda: generate_content_title(
                content=clean_content,
                source_label=source_label,
                fallback_title=fallback_title,
                api_key=api_key,
                model=model,
            ),
            tries=2,
        )
        await db.insert_cost_event(
            user_id=user_id,
            kind="CHAT",
            model=result.model,
            tokens_in=result.tokens_in,
            tokens_out=result.tokens_out,
            cost_usd=result.cost_usd,
            job_id=job_id,
            meta={"source": "title_generation", "source_label": source_label},
        )
        return result.title
    except Exception as e:  # noqa: BLE001 — título é enriquecimento best-effort
        log.warning("title-generation-failed", source_label=source_label, error=str(e)[:240])
        return None


async def _call_or(audio_path: Path, api_key: str, model: str) -> Any:  # noqa: ANN401 — TranscriptionResult
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
    source_override: str | None = None,
    title_override: str | None = None,
    original_object_key: str | None = None,
    original_filename: str | None = None,
    original_mime_type: str | None = None,
    preview_object_key: str | None = None,
    preview_mime_type: str | None = None,
) -> str:
    # Gera transcript_id e doc completo
    transcribed_at = datetime.now(UTC)
    # Reservamos id antecipado pra usar no path do S3; db.write_transcript
    # gera o id e o devolve, mas precisamos do md ANTES do insert.
    # Solução: gerar o id aqui (mesmo padrão do db.generate_cuid) e passar.
    transcript_id = db.generate_cuid()

    # Detecta plataforma pela URL canonical (YouTube/Instagram/TikTok/X)
    # ou recebe override para fontes internas como UPLOAD.
    # Sem fallback: URL já foi validada por parseVideoUrl no web + _canonical_video_url
    # no chat. Se chegou aqui sem source detectável, é bug de canonicalização —
    # prefere falhar cedo a salvar Transcript com source errado.
    source = source_override or video_url.detect_source(source_url)
    if source is None:
        raise PermanentError(f"URL não reconhecida pelo detect_source: {source_url}")

    doc = TranscriptDoc(
        transcript_id=transcript_id,
        user_id=user_id,
        source=source,
        url=source_url,
        video_id=probe_info.video_id,
        title=title_override or probe_info.title,
        channel=probe_info.channel,
        author=None,
        duration_sec=probe_info.duration_sec,
        published_at=probe_info.published_at,
        thumbnail_url=probe_info.thumbnail_url or f"/api/transcripts/{transcript_id}/preview",
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

    frontmatter_json = _frontmatter_json(
        doc,
        original_object_key=original_object_key,
        original_filename=original_filename,
        original_mime_type=original_mime_type,
        preview_object_key=preview_object_key,
        preview_mime_type=preview_mime_type,
    )

    await _retry_transient(lambda: storage.put_markdown(key=md_key, content=md_content), tries=3)

    # Insert no Postgres (passamos o mesmo id usado no path do S3)
    async with db.connection() as conn:
        await conn.execute(
            """
            INSERT INTO "Transcript" (
                id, "userId", source, url, title, channel, author, "durationSec",
                "publishedAt", "thumbnailUrl", language, "transcriptionMethod",
                model, "costUsd", "mdPath", "plainText", frontmatter,
                "originalObjectKey", "originalFilename", "originalMimeType",
                "previewObjectKey", "previewMimeType",
                "createdAt", "updatedAt"
            ) VALUES (
                $1, $2, $3::"TranscriptSource", $4, $5, $6, $7, $8, $9, $10, $11,
                $12::"TranscriptionMethod", $13, $14, $15, $16, $17::jsonb,
                $18, $19, $20, $21, $22,
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
            frontmatter_json,
            original_object_key,
            original_filename,
            original_mime_type,
            preview_object_key,
            preview_mime_type,
        )
        await db.upsert_transcript_brain_node(
            conn,
            user_id=user_id,
            transcript_id=transcript_id,
            source=doc.source,
            url=doc.url,
            title=doc.title,
            channel=doc.channel,
            language=doc.language,
            transcription_method=doc.transcription_method,
            thumbnail_url=doc.thumbnail_url,
            plain_text=plain_text,
        )
    return transcript_id


def _frontmatter_json(
    doc: TranscriptDoc,
    *,
    original_object_key: str | None = None,
    original_filename: str | None = None,
    original_mime_type: str | None = None,
    preview_object_key: str | None = None,
    preview_mime_type: str | None = None,
) -> str:
    import json

    from .transcript_md import build_frontmatter

    frontmatter = build_frontmatter(doc)
    if original_object_key:
        frontmatter["original"] = {
            "objectKey": original_object_key,
            "filename": original_filename,
            "mimeType": original_mime_type,
        }
    if preview_object_key:
        frontmatter["preview"] = {
            "objectKey": preview_object_key,
            "mimeType": preview_mime_type,
        }
    return json.dumps(frontmatter, default=str)


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
            friendly = _friendly_external_error(e)
            if friendly:
                raise PermanentError(friendly) from e
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
