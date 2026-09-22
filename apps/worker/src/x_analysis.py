"""Análise de posts do X via OpenRouter, com veredito de acesso explícito.

Vive fora de `openrouter.py` porque o contrato do X (veredito + grounding na
captura determinística) é domínio próprio; o transporte HTTP continua no
`openrouter_transport`.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal

import httpx

from .openrouter import _chat_completion_document  # noqa: PLC2701

_ACCESS_VERDICT_RE = re.compile(r"^\s*ACESSO\s*:\s*(OK|INDISPONIVEL)\s*$", re.IGNORECASE)
_UNAVAILABLE_WINDOW = 600
_UNAVAILABLE_PHRASES = (
    "nao estava acessivel",
    "nao esta acessivel",
    "nao foi possivel acessar",
    "nao consegui acessar",
    "nao foi possivel recuperar",
    "nao consegui recuperar",
    "nao tenho acesso",
    "sem acesso ao post",
    "post is inaccessible",
    "post is not accessible",
    "post nao esta acessivel",
    "unable to access the post",
    "unable to retrieve the post",
    "could not access the post",
    "couldn't access the post",
    "could not retrieve the post",
    "couldn't retrieve the post",
    "post could not be retrieved",
)
_X_ANALYSIS_INSTRUCTIONS = (
    "Entregue em português do Brasil, em Markdown pesquisável:\n"
    "1. Resumo objetivo do conteúdo.\n"
    "2. Contexto, autor/perfil citado, entidades e links relevantes.\n"
    "3. Pontos verificáveis, ressalvas e incertezas.\n"
    "4. Palavras-chave para busca futura."
)


@dataclass(frozen=True)
class XAnalysisResult:
    text: str
    cost_usd: Decimal
    model: str
    tokens_in: int
    tokens_out: int
    # Se o conteúdo foi recuperado (veredito explícito ou heurística de falha).
    accessible: bool = True
    # True quando o caminho de busca nativa respondeu sem a linha de veredito.
    verdict_missing: bool = False


def _strip_accents(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value.casefold())
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def split_access_verdict(raw: str) -> tuple[bool | None, str]:
    """Separa a linha de veredito do corpo; None quando ela não existe."""
    head, _, rest = raw.partition("\n")
    match = _ACCESS_VERDICT_RE.match(head)
    if match is None:
        return None, raw.strip()
    return match.group(1).upper() == "OK", rest.strip()


def looks_unavailable(raw: str) -> bool:
    """Heurística conservadora para respostas sem veredito explícito."""
    window = _strip_accents(raw)[:_UNAVAILABLE_WINDOW]
    return any(phrase in window for phrase in _UNAVAILABLE_PHRASES)


async def analyze_x_url(
    *,
    url: str,
    api_key: str,
    model: str,
    fallback_model: str | None = None,
    post_context: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> XAnalysisResult:
    """Analisa post/thread do X usando Grok via OpenRouter com busca nativa.

    Com `post_context` (captura determinística), a análise é ancorada no
    conteúdo capturado e não pede busca. Sem ele, o modelo responde com a busca
    nativa e precisa declarar o veredito de acesso na primeira linha.
    """
    if post_context:
        prompt = (
            "Analise o post do X abaixo para uma base de conhecimento. O conteúdo "
            "foi capturado diretamente da fonte pública e é a referência factual.\n\n"
            f"URL: {url}\n\n"
            "Conteúdo capturado:\n"
            f"{post_context}\n\n"
            f"{_X_ANALYSIS_INSTRUCTIONS}\n\n"
            "Baseie-se apenas no conteúdo capturado e não invente detalhes."
        )
        payload: dict[str, object] = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Você analisa publicações do X para uma base de conhecimento pessoal. "
                        "Seja objetivo, cite URLs relevantes quando existirem e escreva em "
                        "português do Brasil."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            "usage": {"include": True},
        }
    else:
        prompt = (
            "Analise este post ou thread do X para uma base de conhecimento.\n\n"
            f"URL: {url}\n\n"
            "Comece a resposta com uma única linha de veredito, exatamente "
            "`ACESSO: OK` se você conseguiu recuperar o post, ou "
            "`ACESSO: INDISPONIVEL` se não conseguiu. Não escreva mais nada nessa linha.\n\n"
            f"{_X_ANALYSIS_INSTRUCTIONS}\n\n"
            "Use a busca nativa no X quando disponível. Se o conteúdo não estiver "
            "acessível, responda apenas com o veredito INDISPONIVEL e não invente detalhes."
        )
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Você analisa publicações do X para uma base de conhecimento pessoal. "
                        "Use dados recuperados pela busca nativa do X/OpenRouter, seja objetivo, "
                        "cite URLs relevantes quando existirem e escreva em português do Brasil."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            "tools": [
                {
                    "type": "openrouter:web_search",
                    "parameters": {"engine": "native", "max_uses": 1},
                }
            ],
            "max_tool_calls": 1,
            "x_search_filter": {
                "enable_image_understanding": True,
                "enable_video_understanding": True,
            },
            "usage": {"include": True},
        }

    result = await _chat_completion_document(
        payload=payload,
        api_key=api_key,
        model=model,
        fallback_model=fallback_model,
        client=client,
    )

    verdict, body = split_access_verdict(result.text)
    verdict_missing = False
    text = result.text
    if verdict is not None:
        accessible = verdict
        text = body
    else:
        accessible = not looks_unavailable(result.text)
        verdict_missing = post_context is None

    return XAnalysisResult(
        text=text,
        cost_usd=result.cost_usd,
        model=result.model,
        tokens_in=result.tokens_in,
        tokens_out=result.tokens_out,
        accessible=accessible,
        verdict_missing=verdict_missing,
    )
