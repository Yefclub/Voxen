"""Loop central do agente Vox — usado pelo /chat (SSE) E pelo Telegram (sync).

Refatoração do `main.event_stream` em uma função reutilizável que NÃO faz
streaming. Acumula texto da resposta + tools usadas + cost e retorna no fim.

Útil pra:
- Telegram bot (sem SSE; manda mensagem final)
- Futuro CLI ou cron jobs que precisam consultar a Vox

NÃO substitui o /chat (SSE) — esse continua tendo seu loop próprio pra
streaming token-by-token + emissão de tool_start/tool_end events em tempo
real.

HITL no Telegram: `run_chat_completion` aceita `interrupt_on_confirmation=True`.
Quando o agent chama `request_user_confirmation`, em vez de executar a tool
e continuar o loop, retorna o estado pendente. Caller (bot) envia mensagem
com inline_keyboard pro user e chama `resume_chat_completion` quando o user
clica em uma das opções.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

import structlog
from openai import AsyncOpenAI

from . import db, voxen_settings
from .tools import TOOLS_SPEC, execute_tool

OR_BASE_URL = "https://openrouter.ai/api/v1"
MAX_TOOL_LOOPS = 5
log = structlog.get_logger("agent")


@dataclass
class AgentTurnResult:
    """Resultado de 1 turno (ou turno parcial) do agente."""

    final_content: str
    pending_hitl: dict[str, Any] | None = None  # { action_summary, tool_call_id, state }
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: Decimal = field(default_factory=lambda: Decimal("0"))


async def run_chat_completion(
    *,
    user_id: str,
    user_text: str,
    source: str = "internal",
    image_data_url: str | None = None,
    interrupt_on_confirmation: bool = False,
) -> AgentTurnResult:
    """Roda 1 turno completo do agente Vox.

    - user_id: pra escopar tools (transcripts, notes)
    - user_text: pergunta do usuário
    - source: pra registrar em CostEvent.meta.source
    - image_data_url: opcional, anexa imagem na última msg user (vision)
    - interrupt_on_confirmation: se True, ao detectar request_user_confirmation
      pausa o loop e retorna state em `pending_hitl` em vez de executar a tool

    Persiste em CostEvent. NÃO persiste em Conversation (caller decide).
    """
    from .main import build_system_prompt

    api_key = await voxen_settings.get_openrouter_api_key()
    if not api_key:
        return AgentTurnResult(
            final_content="⚠️ Setup incompleto — admin precisa configurar a chave OpenRouter."
        )
    model = await voxen_settings.get_default_chat_model()
    if not model:
        return AgentTurnResult(final_content="⚠️ Setup incompleto — modelo de chat ausente.")

    # Vision: troca pro modelo de visão se imagem anexada + setting presente
    if image_data_url:
        vision_model = await voxen_settings.get_default_vision_model()
        if vision_model:
            model = vision_model

    user_name = await _get_user_name(user_id)
    system_prompt = build_system_prompt(user_name=user_name, user_timezone="UTC")

    user_msg: dict[str, Any]
    if image_data_url:
        user_msg = {
            "role": "user",
            "content": [
                {"type": "text", "text": user_text or "Descreva esta imagem."},
                {"type": "image_url", "image_url": {"url": image_data_url}},
            ],
        }
    else:
        user_msg = {"role": "user", "content": user_text}

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        user_msg,
    ]

    return await _run_loop(
        api_key=api_key,
        model=model,
        messages=messages,
        user_id=user_id,
        source=source,
        interrupt_on_confirmation=interrupt_on_confirmation,
    )


async def resume_chat_completion(
    *,
    state: list[dict[str, Any]],
    tool_call_id: str,
    approved: bool,
    user_id: str,
    model: str,
    source: str = "internal",
) -> AgentTurnResult:
    """Retoma um turno pausado por HITL.

    `state` é o array `messages` capturado quando `interrupt_on_confirmation`
    parou o loop. Injeta o tool_result da confirmação e continua.
    """
    api_key = await voxen_settings.get_openrouter_api_key()
    if not api_key:
        return AgentTurnResult(final_content="⚠️ Setup incompleto.")

    import json as _json

    messages = list(state)
    # Injeta tool result da confirmação
    messages.append(
        {
            "role": "tool",
            "tool_call_id": tool_call_id,
            "content": _json.dumps(
                {"approved": approved, "decided_by": "human"},
                ensure_ascii=False,
            ),
        }
    )
    # Continua o loop sem permitir nova interrupção
    return await _run_loop(
        api_key=api_key,
        model=model,
        messages=messages,
        user_id=user_id,
        source=source,
        interrupt_on_confirmation=False,
    )


async def _run_loop(
    *,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    user_id: str,
    source: str,
    interrupt_on_confirmation: bool,
) -> AgentTurnResult:
    """Loop interno do agente. Compartilhado entre run + resume."""
    import json as _json

    client = AsyncOpenAI(api_key=api_key, base_url=OR_BASE_URL)
    total_in = 0
    total_out = 0
    total_cost = Decimal("0")
    final_content = ""
    pending: dict[str, Any] | None = None
    loops = 0

    while loops < MAX_TOOL_LOOPS:
        loops += 1
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
            # Append assistant call
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

            # Pausa se algum tool_call é request_user_confirmation e
            # interrupt_on_confirmation=True
            confirmation_tc = None
            if interrupt_on_confirmation:
                for tc in tool_calls:
                    if tc.function.name == "request_user_confirmation":
                        confirmation_tc = tc
                        break

            if confirmation_tc is not None:
                try:
                    args = _json.loads(confirmation_tc.function.arguments or "{}")
                except Exception:  # noqa: BLE001
                    args = {}
                pending = {
                    "action_summary": str(args.get("action_summary") or "Confirmar ação?"),
                    "tool_call_id": confirmation_tc.id,
                    "state": messages,
                    "model": model,
                }
                # Texto opcional que o assistant gerou antes do tool_call
                final_content = (msg.content or "").strip()
                break

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

    return AgentTurnResult(
        final_content=final_content
        or "Sem resposta da Vox (verifique se há conteúdo na biblioteca).",
        pending_hitl=pending,
        tokens_in=total_in,
        tokens_out=total_out,
        cost_usd=total_cost,
    )


async def _get_user_name(user_id: str) -> str:
    """Busca name do user no DB. Falha silenciosa retorna ''."""
    try:
        async with db.connection() as conn:
            row = await conn.fetchrow('SELECT name FROM "User" WHERE id = $1', user_id)
        return str(row["name"]) if row else ""
    except Exception:  # noqa: BLE001
        return ""
