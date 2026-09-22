"""Pipeline do Job ANALYZE_X: captura determinística + análise do modelo.

Vive fora do `pipeline.py` pelo mesmo motivo do `scrape_pipeline.py`: é uma
família de job própria. A captura pública do post e o veredito de acesso estão
no contrato de `x_post.py`/`x_analysis.py`.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

from . import db, events, video_url, voxen_settings, x_post, ytdl
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
from .transcript_md import Segment
from .x_analysis import analyze_x_url


async def run(
    *,
    job_id: str,
    user_id: str,
    source_url: str,
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
        language=(
            "pt"
            if selection.source == "analysis"
            else (capture.lang if capture is not None and capture.lang else "pt")
        ),
        title_override=generated_title,
    )

    await events.publish_job_event(user_id, job_id, "indexing", percent=95)
    await db.link_job_transcript(job_id, new_transcript_id)
    await _complete_persisted_job(
        user_id=user_id, transcript_id=new_transcript_id, job_id=job_id, log=log
    )
    log.info("x-analysis-job-done", transcript_id=new_transcript_id)
