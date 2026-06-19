"""Limites de contexto por modelo + estimativa de tokens.

Estimativa é aproximada: ~4 chars = 1 token (regra empírica que funciona bem
pra PT-BR e EN; código tende a ser mais "denso" e modelos modernos com BPE
quebram códigos em 2-3 tokens por símbolo). Pra contagem exata precisaríamos
do tokenizer do modelo específico — complexo demais pro ganho.

Limites são CONTEXTO TOTAL (input + output). Threshold default = 80% do
contexto pra dar margem segura pra resposta + tools.
"""

from __future__ import annotations

# Modelos comuns no OpenRouter. Default seguro: 32k pra modelos desconhecidos.
# Updated 2026-05 — checar periodicamente https://openrouter.ai/models
MODEL_CONTEXT_LIMITS: dict[str, int] = {
    # OpenAI
    "openai/gpt-4o": 128_000,
    "openai/gpt-4o-mini": 128_000,
    "openai/gpt-4-turbo": 128_000,
    "openai/o1": 128_000,
    "openai/o1-mini": 128_000,
    "openai/o3-mini": 200_000,
    # Anthropic
    "anthropic/claude-3.5-sonnet": 200_000,
    "anthropic/claude-3.5-haiku": 200_000,
    "anthropic/claude-3-opus": 200_000,
    "anthropic/claude-opus-4": 200_000,
    "anthropic/claude-sonnet-4": 1_000_000,
    # Google
    "google/gemini-2.5-pro": 2_000_000,
    "google/gemini-2.0-flash": 1_000_000,
    "google/gemini-3.1-flash": 1_000_000,
    "google/gemini-3.1-flash-lite": 1_000_000,
    "google/gemini-pro-1.5": 2_000_000,
    # Meta
    "meta-llama/llama-3.3-70b-instruct": 128_000,
    "meta-llama/llama-3.1-405b-instruct": 128_000,
    # Mistral
    "mistralai/mistral-large": 128_000,
    "mistralai/mixtral-8x22b-instruct": 65_536,
    # DeepSeek
    "deepseek/deepseek-r1": 64_000,
    "deepseek/deepseek-chat": 64_000,
}

DEFAULT_LIMIT = 32_000
# Threshold deliberadamente conservador: 70% deixa ~30% de headroom para
# tool loops (MAX_TOOL_LOOPS=8) que injetam resultados grandes
# (read_transcript pode trazer 5k+ tokens por chamada) + a resposta final
# em streaming. 80% estoura na prática quando o agente encadeia tools.
DEFAULT_THRESHOLD = 0.70


def get_context_limit(model: str) -> int:
    """Lookup do limite do modelo. Aceita também sufixos como `:online`."""
    base = model.split(":")[0]
    return MODEL_CONTEXT_LIMITS.get(base, DEFAULT_LIMIT)


def estimate_tokens(text: str) -> int:
    """Aproximação: 4 chars ≈ 1 token. Não é exato, mas guia bem decisão."""
    if not text:
        return 0
    return max(1, len(text) // 4)


def estimate_messages_tokens(messages: list[dict[str, object]]) -> int:
    """Soma tokens estimados de um array de mensagens (formato OpenAI)."""
    total = 0
    for m in messages:
        content = m.get("content")
        if isinstance(content, str):
            total += estimate_tokens(content)
        elif isinstance(content, list):
            # Multimodal — soma só text parts (imagens contam tokens fixos
            # estimados em 800 por imagem, ballpark)
            for part in content:
                if part.get("type") == "text":
                    total += estimate_tokens(part.get("text", ""))
                elif part.get("type") == "image_url":
                    total += 800
        # Pequeno overhead por mensagem (role + delimitadores)
        total += 4
    return total


def should_compact(tokens: int, model: str, threshold: float = DEFAULT_THRESHOLD) -> bool:
    """Decide se deve compactar baseado em tokens vs limite do modelo."""
    limit = get_context_limit(model)
    return tokens >= int(limit * threshold)
