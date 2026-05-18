"""Loop central do agente Vox — usado pelo /chat (SSE) E pelo Telegram (sync).

Refatoração do `main.event_stream` em uma função reutilizável que NÃO faz
streaming. Acumula texto da resposta + tools usadas + cost e retorna no fim.

Útil pra:
- Telegram bot (sem SSE; manda mensagem final)
- Futuro CLI ou cron jobs que precisam consultar a Vox

NÃO substitui o /chat (SSE) — esse continua tendo seu loop próprio pra
streaming token-by-token + emissão de tool_start/tool_end events em tempo
real.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import structlog
from openai import AsyncOpenAI

from . import db, voxen_settings
from .tools import TOOLS_SPEC, execute_tool

OR_BASE_URL = "https://openrouter.ai/api/v1"
MAX_TOOL_LOOPS = 5
log = structlog.get_logger("agent")


async def run_chat_completion(
    *,
    user_id: str,
    user_text: str,
    source: str = "internal",
) -> str:
    """Roda 1 turno completo do agente Vox e retorna o texto final.

    - user_id: pra escopar tools (transcripts, notes)
    - user_text: pergunta do usuário (string)
    - source: pra registrar em CostEvent.meta.source

    Persiste em CostEvent. NÃO persiste em Conversation (caller decide).
    """
    from .main import build_system_prompt

    api_key = await voxen_settings.get_openrouter_api_key()
    if not api_key:
        return "⚠️ Setup incompleto — admin precisa configurar a chave OpenRouter."
    model = await voxen_settings.get_default_chat_model()
    if not model:
        return "⚠️ Setup incompleto — modelo de chat ausente."

    # Busca nome do user pra system prompt (do DB direto, sem header)
    user_name = await _get_user_name(user_id)
    system_prompt = build_system_prompt(user_name=user_name, user_timezone="UTC")

    client = AsyncOpenAI(api_key=api_key, base_url=OR_BASE_URL)
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_text},
    ]

    total_in = 0
    total_out = 0
    total_cost = Decimal("0")
    final_content = ""
    loops = 0

    import json as _json

    while loops < MAX_TOOL_LOOPS:
        loops += 1
        # stream=False retorna ChatCompletion (não AsyncStream) — cast pra Any
        # pra mypy aceitar o acesso a .choices/.usage sem precisar isinstance.
        completion: Any = await client.chat.completions.create(
            model=model,
            messages=messages,  # type: ignore[arg-type]
            tools=TOOLS_SPEC,  # type: ignore[arg-type]
            stream=False,
            extra_body={"usage": {"include": True}},
        )
        choice = completion.choices[0] if completion.choices else None
        if not choice:
            break
        msg = choice.message
        # Custos
        if completion.usage:
            total_in += completion.usage.prompt_tokens or 0
            total_out += completion.usage.completion_tokens or 0
            raw_cost = getattr(completion.usage, "cost", None)
            if raw_cost is not None:
                try:
                    total_cost += Decimal(str(raw_cost))
                except (ValueError, ArithmeticError):
                    pass

        tool_calls = msg.tool_calls or []
        if tool_calls:
            # Append assistant call + execute tools sequencialmente
            messages.append(
                {
                    "role": "assistant",
                    "content": msg.content or None,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            },
                        }
                        for tc in tool_calls
                    ],
                }
            )
            for tc in tool_calls:
                try:
                    args = _json.loads(tc.function.arguments or "{}")
                except Exception:  # noqa: BLE001
                    args = {}
                result = await execute_tool(tc.function.name, args, user_id)
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": _json.dumps(result, default=str, ensure_ascii=False),
                    }
                )
            continue

        # Sem tool_calls → resposta final
        final_content = (msg.content or "").strip()
        break

    # Registra custo total
    if total_cost > 0 or total_in > 0:
        try:
            await db.insert_cost_event(
                user_id=user_id,
                model=model,
                tokens_in=total_in,
                tokens_out=total_out,
                cost_usd=total_cost,
                meta={"source": source},
            )
        except Exception as e:  # noqa: BLE001
            log.warning("agent-cost-event-failed", error=str(e))

    return final_content or "Sem resposta da Vox (verifique se há conteúdo na biblioteca)."


async def _get_user_name(user_id: str) -> str:
    """Busca name do user no DB. Falha silenciosa retorna ''."""
    try:
        async with db.connection() as conn:
            row = await conn.fetchrow('SELECT name FROM "User" WHERE id = $1', user_id)
        return str(row["name"]) if row else ""
    except Exception:  # noqa: BLE001
        return ""
