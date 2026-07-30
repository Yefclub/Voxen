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

from . import db, openrouter, voxen_settings
from .cancellation import is_cancelled

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
    job_id: str,
    log: Any,  # noqa: ANN401
) -> None:
    # Respeita cancel pedido entre persistência do transcript e summary.
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

        config = await voxen_settings.get_openrouter_model_config(("default_chat_model",))
        if not config.api_key or not config.model:
            log.warning("summary-skipped-missing-config")
            return
        api_key = config.api_key
        model = config.model

        text = str(row["plainText"]).strip()
        if not text:
            log.info("summary-skipped-empty-text")
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

        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                res = await client.post(
                    f"{OR_BASE_URL}/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json=payload,
                )
            except (httpx.TimeoutException, httpx.NetworkError) as e:
                log.warning("summary-network-error", error=str(e)[:200])
                return

        if res.status_code in (401, 403):
            log.warning("summary-auth-error", status=res.status_code)
            return
        if res.status_code >= 400:
            log.warning(
                "summary-upstream-non-200",
                status=res.status_code,
            )
            return

        data = res.json()
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
            return

        try:
            async with db.connection() as conn:
                await conn.execute(
                    'UPDATE "Transcript" SET "summaryMd" = $2, "updatedAt" = NOW() '
                    'WHERE id = $1 AND "userId" = $3',
                    transcript_id,
                    summary,
                    user_id,
                )
        except Exception:  # noqa: BLE001
            log.exception("summary-persist-failed", transcript_id=transcript_id)
            return

        try:
            await db.insert_cost_event(
                user_id=user_id,
                kind="CHAT",
                model=model,
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
        except Exception:  # noqa: BLE001
            log.exception("summary-cost-event-failed", transcript_id=transcript_id)

        log.info("summary-done", transcript_id=transcript_id, language=language)
    except Exception:  # noqa: BLE001 — resumo é melhoria, não bloqueia
        log.exception("summary-failed", transcript_id=transcript_id)
