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

SUMMARIZE_PROMPT = """Você recebe a transcrição de um vídeo. Produza um RESUMO em markdown,
em português brasileiro, estruturado assim:

## TL;DR
2-3 frases capturando a essência do vídeo.

## Principais pontos
- Lista de 4 a 8 bullets, cada um com a ideia central. Quando útil, cite o
  trecho referenciando o minuto no formato `[mm:ss]` (ou `[hh:mm:ss]` se > 1h).

## Conclusão
Parágrafo curto com a mensagem principal ou take-away.

REGRAS:
- Não invente conteúdo. Só use o que está na transcrição.
- Português direto, sem rodeios. Sem emojis.
- Não adicione cabeçalho extra; comece direto pelo "## TL;DR"."""


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

        api_key = await voxen_settings.get_openrouter_api_key()
        model = await voxen_settings.get_default_chat_model()
        if not api_key or not model:
            log.warning("summary-skipped-missing-config")
            return

        text = str(row["plainText"]).strip()
        if not text:
            log.info("summary-skipped-empty-text")
            return
        if len(text) > 60_000:
            text = text[:60_000] + "\n\n[…transcrição truncada para resumo…]"

        timeout = await voxen_settings.get_summary_timeout_sec()
        payload: dict[str, object] = {
            "model": model,
            "messages": [
                {"role": "system", "content": SUMMARIZE_PROMPT},
                {
                    "role": "user",
                    "content": f"Título do vídeo: {row['title']}\n\nTranscrição:\n\n{text}",
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
                body=res.text[:200],
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
                meta={"source": "transcript_summary", "transcript_id": transcript_id},
            )
        except Exception:  # noqa: BLE001
            log.exception("summary-cost-event-failed", transcript_id=transcript_id)

        log.info("summary-done", transcript_id=transcript_id)
    except Exception:  # noqa: BLE001 — resumo é melhoria, não bloqueia
        log.exception("summary-failed", transcript_id=transcript_id)
