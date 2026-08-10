"""Best-effort summary do Transcript via OpenRouter (direto no worker).

Worker (pipeline vídeo e scrape_pipeline web) chama esta função após persistir
o Transcript. Prompt + chamada OpenRouter + grava `summaryMd` + CostEvent
ficam no worker — sem dependência do antigo serviço `apps/chat`.

Falhas viram warning e NÃO bloqueiam o Job — summary é melhoria, não pré-req.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import httpx

from . import db, openrouter, research_db, voxen_settings
from .cancellation import is_cancelled
from .safe_diagnostics import error_diagnostic

OR_BASE_URL = openrouter.OR_BASE_URL


def build_summarize_prompt(language: str) -> str:
    """Prompt de resumo no idioma da instância. Nunca usa o termo TL;DR."""
    if language == "en":
        return """You receive a video transcript. Produce a SUMMARY in markdown,
in English, structured exactly like this:

## In short
2-3 sentences capturing the essence of the video.

## Key points
- A list of 4 to 8 bullets, each with the core idea. When useful, cite the
  passage with a minute timestamp in the format `[mm:ss]` (or `[hh:mm:ss]` if > 1h).

## Conclusion
A short paragraph with the main takeaway.

RULES:
- Do not invent content. Only use what is in the transcript.
- Clear, direct English. No emojis.
- Do not use English acronyms for the short summary section (never "too long; didn't read").
- Do not add an extra top-level heading; start directly with "## In short"."""

    return """Você recebe a transcrição de um vídeo. Produza um RESUMO em markdown,
em português brasileiro, estruturado assim:

## Em poucas linhas
2-3 frases capturando a essência do vídeo.

## Principais pontos
- Lista de 4 a 8 bullets, cada um com a ideia central. Quando útil, cite o
  trecho referenciando o minuto no formato `[mm:ss]` (ou `[hh:mm:ss]` se > 1h).

## Conclusão
Parágrafo curto com a mensagem principal ou take-away.

REGRAS:
- Não invente conteúdo. Só use o que está na transcrição.
- Português direto, sem rodeios. Sem emojis.
- Não use abreviações em inglês para o resumo curto (nunca "too long; didn't read").
- Não adicione cabeçalho extra; comece direto pelo "## Em poucas linhas"."""


async def maybe_generate(
    *,
    user_id: str,
    transcript_id: str,
    job_id: str | None,
    log: Any,  # noqa: ANN401
    already_claimed: bool = False,
    claim_attempt: int | None = None,
    correction_revision: int | None = None,
    source_version: int | None = None,
    source_checksum: str | None = None,
) -> None:
    if already_claimed:
        if claim_attempt is None or correction_revision is None or source_version is None:
            raise ValueError("complete content identity is required")
        active_attempt = claim_attempt
        active_revision = correction_revision
        active_source_version = source_version
        active_source_checksum = source_checksum
    else:
        claim = await db.start_summary_enrichment(user_id, transcript_id)
        if claim is None:
            return
        active_attempt = int(claim["summaryAttempt"])
        active_revision = int(claim["correctionRevision"])
        active_source_version = int(claim["sourceVersion"])
        active_source_checksum = str(claim["sourceChecksum"]) if claim["sourceChecksum"] else None

    async def finish(status: str, error: str | None = None) -> None:
        await db.finish_summary_enrichment(
            user_id,
            transcript_id,
            claim_attempt=active_attempt,
            correction_revision=active_revision,
            source_version=active_source_version,
            source_checksum=active_source_checksum,
            status=status,
            error=error,
        )

    # Respeita cancel pedido entre persistência do transcript e summary.
    if job_id and is_cancelled(job_id):
        log.info("summary-skipped-cancelled")
        await finish("RETRY", "SUMMARY_CANCELLED")
        return
    try:
        async with db.connection() as conn:
            row = await conn.fetchrow(
                """SELECT title, "plainText", "correctedPlainText", "correctionState"
                   FROM "Transcript" WHERE id = $1 AND "userId" = $2
                     AND "summaryStatus" = 'RUNNING'::"EnrichmentStatus"
                     AND "summaryAttempts" = $3 AND "correctionRevision" = $4
                     AND "sourceVersion" = $5
                     AND "sourceChecksum" IS NOT DISTINCT FROM $6""",
                transcript_id,
                user_id,
                active_attempt,
                active_revision,
                active_source_version,
                active_source_checksum,
            )
        effective_text = (
            row["correctedPlainText"]
            if row and row["correctionState"] == "ACTIVE" and row["correctedPlainText"]
            else row["plainText"]
            if row
            else None
        )
        if not row or not effective_text:
            log.info("summary-skipped-empty-text")
            await finish("SKIPPED", "SUMMARY_EMPTY_TEXT")
            return

        config = await voxen_settings.get_openrouter_model_config(("default_chat_model",))
        if not config.api_key or not config.model:
            log.warning("summary-skipped-missing-config")
            await finish("RETRY", "SUMMARY_CONFIG_MISSING")
            return
        api_key = config.api_key
        model = config.model

        text = str(effective_text).strip()
        if not text:
            log.info("summary-skipped-empty-text")
            await finish("SKIPPED", "SUMMARY_EMPTY_TEXT")
            return
        if len(text) > 60_000:
            text = text[:60_000] + "\n\n[…transcrição truncada para resumo…]"

        language = await voxen_settings.get_app_language()
        prompt = build_summarize_prompt(language)
        title_label = "Video title" if language == "en" else "Título do vídeo"
        body_label = "Transcript" if language == "en" else "Transcrição"

        timeout = await voxen_settings.get_summary_timeout_sec()
        payload: dict[str, object] = {
            "model": model,
            "messages": [
                {"role": "system", "content": prompt},
                {
                    "role": "user",
                    "content": f"{title_label}: {row['title']}\n\n{body_label}:\n\n{text}",
                },
            ],
            "stream": False,
            # OpenRouter retorna usage.cost (USD) só quando solicitamos via
            # usage.include=true. Sem isso o painel mostra $0,00 mesmo gastando.
            "usage": {"include": True},
        }
        if config.fallback_model and config.fallback_model != model:
            payload["models"] = [config.fallback_model]

        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                res = await client.post(
                    f"{OR_BASE_URL}/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json=payload,
                )
            except httpx.TransportError as e:
                log.warning(
                    "summary-network-error",
                    **error_diagnostic(e, "SUMMARY_UPSTREAM_UNAVAILABLE"),
                )
                await finish("RETRY", "SUMMARY_UPSTREAM_UNAVAILABLE")
                return

        if res.status_code in (401, 403):
            log.warning("summary-auth-error", status=res.status_code)
            await finish("RETRY", "SUMMARY_AUTH_ERROR")
            return
        if res.status_code >= 400:
            log.warning(
                "summary-upstream-non-200",
                status=res.status_code,
            )
            await finish("RETRY", "SUMMARY_UPSTREAM_ERROR")
            return

        data = res.json()
        selected_model = str(data.get("model") or model)
        if selected_model != model:
            log.warning(
                "openrouter-model-fallback-used",
                purpose="summary",
                primary_model=model,
                selected_model=selected_model,
            )
        summary = (
            ((data.get("choices") or [{}])[0].get("message", {}) or {}).get("content") or ""
        ).strip()
        usage = data.get("usage") or {}
        tokens_in = int(usage.get("prompt_tokens") or 0)
        tokens_out = int(usage.get("completion_tokens") or 0)
        cost_raw = usage.get("cost")
        try:
            cost_usd = Decimal(str(cost_raw)) if cost_raw is not None else Decimal("0")
        except (ValueError, ArithmeticError):
            cost_usd = Decimal("0")

        if not summary:
            log.info("summary-empty")
            await finish("SKIPPED", "SUMMARY_EMPTY_RESPONSE")
            return

        try:
            persisted = await db.complete_summary_enrichment(
                user_id,
                transcript_id,
                claim_attempt=active_attempt,
                correction_revision=active_revision,
                source_version=active_source_version,
                source_checksum=active_source_checksum,
                summary_md=summary,
            )
        except Exception as e:  # noqa: BLE001
            log.error(
                "summary-persist-failed",
                transcript_id=transcript_id,
                **error_diagnostic(e, "SUMMARY_PERSIST_FAILED"),
            )
            await finish("RETRY", "SUMMARY_PERSIST_FAILED")
            return

        try:
            await db.insert_cost_event(
                user_id=user_id,
                kind="CHAT",
                model=selected_model,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                cost_usd=cost_usd,
                job_id=job_id,
                meta={
                    "source": "transcript_summary",
                    "transcript_id": transcript_id,
                    "language": language,
                },
            )
        except Exception as e:  # noqa: BLE001
            log.error(
                "summary-cost-event-failed",
                transcript_id=transcript_id,
                **error_diagnostic(e, "SUMMARY_COST_EVENT_FAILED"),
            )

        if not persisted:
            log.info(
                "summary-stale-claim-discarded",
                transcript_id=transcript_id,
                claim_attempt=active_attempt,
            )
            return

        try:
            queued = await research_db.queue_auto_transcript_enrichment(user_id, transcript_id)
            if queued:
                log.info("research-enrichment-queued", transcript_id=transcript_id)
        except Exception as e:  # noqa: BLE001 -- summary remains complete
            log.error(
                "research-enrichment-queue-failed",
                transcript_id=transcript_id,
                **error_diagnostic(e, "RESEARCH_QUEUE_FAILED"),
            )

        log.info("summary-done", transcript_id=transcript_id, language=language)
    except Exception as e:  # noqa: BLE001 — resumo é melhoria, não bloqueia
        log.error(
            "summary-failed",
            transcript_id=transcript_id,
            **error_diagnostic(e, "SUMMARY_FAILED"),
        )
        try:
            await finish("RETRY", "SUMMARY_FAILED")
        except Exception as finish_error:  # noqa: BLE001
            log.error(
                "summary-state-persist-failed",
                transcript_id=transcript_id,
                **error_diagnostic(finish_error, "SUMMARY_STATE_PERSIST_FAILED"),
            )
