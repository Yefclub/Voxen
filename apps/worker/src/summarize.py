"""Gera resumo em markdown da transcrição via OpenRouter chat model.

Chamada simples e barata: passa o plain text e pede um resumo estruturado em
markdown. Falha aqui NÃO interrompe o pipeline — resumo é melhoria, não pré-req.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import httpx
import structlog

OR_BASE_URL = "https://openrouter.ai/api/v1"

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
- Não adicione cabeçalho extra; comece direto pelo "## TL;DR".
- Se a transcrição estiver truncada/incoerente, faça o melhor possível e
  marque com "(transcrição parcial)" no início.
"""

# Cap de input pra não estourar contexto/custo. 60k caracteres ≈ 15k tokens.
MAX_INPUT_CHARS = 60_000

log = structlog.get_logger(__name__)


async def generate_summary(
    *,
    plain_text: str,
    title: str,
    api_key: str,
    model: str,
    timeout: float = 90.0,  # noqa: ASYNC109 — passado pro httpx, não substitui asyncio.timeout
) -> tuple[str, dict[str, int], Decimal]:
    """Retorna `(summary_md, usage, cost_usd)`.

    `usage` tem `tokens_in` / `tokens_out`. `cost_usd` é Decimal(0) — OpenRouter
    devolve usage mas não custo direto na response stream, e o pipeline já
    registra o custo da transcrição via tokens.
    """
    text = plain_text.strip()
    if len(text) > MAX_INPUT_CHARS:
        text = text[:MAX_INPUT_CHARS] + "\n\n[…transcrição truncada para resumo…]"

    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": SUMMARIZE_PROMPT},
            {
                "role": "user",
                "content": f"Título do vídeo: {title}\n\nTranscrição:\n\n{text}",
            },
        ],
        "stream": False,
    }

    async with httpx.AsyncClient(timeout=timeout) as client:
        res = await client.post(
            f"{OR_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json=payload,
        )
    if res.status_code >= 400:
        raise RuntimeError(f"OpenRouter {res.status_code}: {res.text[:200]}")

    data = res.json()
    choice = (data.get("choices") or [{}])[0]
    summary = (choice.get("message", {}).get("content") or "").strip()
    usage = data.get("usage") or {}
    tokens = {
        "tokens_in": int(usage.get("prompt_tokens") or 0),
        "tokens_out": int(usage.get("completion_tokens") or 0),
    }
    return summary, tokens, Decimal("0")
