"""Compactação de memória de conversa — quando contexto chega a ~80%, gera
um resumo detalhado e substitui as mensagens antigas por ele no array enviado
ao modelo. As mensagens originais ficam no DB com `compactedAt` setado.

Fluxo:
  1. Antes de enviar pra OR, soma tokens das mensagens.
  2. Se >= 80% do limite do modelo, dispara compact_conversation():
     - Pega N mensagens "antigas" (todas exceto as últimas K = K_KEEP_RECENT)
     - Chama o próprio modelo de chat com COMPACTION_PROMPT
     - Resposta vira ChatMessage role=SYSTEM kind=COMPACTION_SUMMARY
     - Marca as antigas com compactedAt=now()
  3. Pipeline continua com [system_prompt, summary, ...recent_messages]
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import structlog
from openai import AsyncOpenAI

from . import db
from .token_limits import (
    DEFAULT_THRESHOLD,
    estimate_messages_tokens,
    get_context_limit,
    should_compact,
)

log = structlog.get_logger("compaction")

OR_BASE_URL = "https://openrouter.ai/api/v1"

# Quantas mensagens mais recentes preservar (sem compactar). Garante que o
# user não perde contexto IMEDIATO. As últimas 6 mensagens (3 trocas) ficam
# íntegras + o resumo das anteriores.
K_KEEP_RECENT = 6

COMPACTION_PROMPT = """Você está compactando uma conversa entre um usuário e a assistente Vox \
(plataforma Voxen — base de conhecimento pessoal).

Gere um resumo MUITO DETALHADO da conversa abaixo. Preserve:
- Decisões tomadas e por quê
- Fatos importantes mencionados pelo usuário (nomes, datas, contextos)
- Conteúdo de notas/transcrições citadas (resumo do que continham)
- Tools usadas pela Vox e seus resultados (search, transcribe, create_note, etc)
- Intenções abertas / pendências do usuário ("ele quer X depois", "perguntou Y")
- Próximos passos combinados

Formato:
## Contexto principal
- ponto-chave 1
- ponto-chave 2

## Decisões e fatos
- ...

## Tools usadas
- search_transcripts("X") → encontrou Y
- create_note → "título"

## Pendências e próximos passos
- ...

NÃO seja econômico. Detalhe é mais importante que brevidade aqui — o resumo \
vai substituir o histórico real no próximo turno. Cita IDs de notas/transcrições \
quando relevantes pra Vox conseguir consultá-los depois.
"""


async def maybe_compact_messages(
    *,
    api_key: str,
    model: str,
    user_id: str,
    conversation_id: str | None,
    messages: list[dict[str, Any]],
    threshold: float = DEFAULT_THRESHOLD,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Decide se compacta. Retorna (mensagens_pra_or, info).

    - mensagens_pra_or: lista que vai ser enviada ao modelo (possivelmente já
      compactada — substituiu mensagens antigas pelo resumo).
    - info: dict com `triggered=True` + métricas quando compactou,
      `triggered=False, error="..."` quando tentou e falhou, ou `None`
      quando nem tentou (abaixo do threshold).
    """
    tokens_before = estimate_messages_tokens(messages)
    if not should_compact(tokens_before, model, threshold):
        return messages, None
    if not conversation_id:
        # Sem conversation persistente não dá pra marcar mensagens como
        # compactadas — apenas seguimos (modelo pode estourar).
        log.warning("compaction-skipped-no-conv-id")
        return messages, {
            "triggered": False,
            "error": "Sem conversa persistente.",
            "tokens_before": tokens_before,
            "limit": get_context_limit(model),
        }

    # Separa: [system] + [old...] + [recent]
    # system prompt é a primeira mensagem (role=system). Vai junto sempre.
    system_msgs = [m for m in messages if m.get("role") == "system"]
    chat_msgs = [m for m in messages if m.get("role") != "system"]
    if len(chat_msgs) <= K_KEEP_RECENT:
        # Conversa curta mas tokens altos (provável imagem ou conteúdo gigante
        # numa mensagem só) — não dá pra compactar mais. Devolve como está.
        log.warning(
            "compaction-skipped-too-short",
            messages=len(chat_msgs),
            tokens=tokens_before,
        )
        return messages, {
            "triggered": False,
            "error": "Conversa muito curta para compactar.",
            "tokens_before": tokens_before,
            "limit": get_context_limit(model),
        }

    old = chat_msgs[:-K_KEEP_RECENT]
    recent = chat_msgs[-K_KEEP_RECENT:]

    # Monta o conteúdo a resumir
    conversation_text = "\n\n".join(
        f"[{m['role'].upper()}]: {_extract_text(m['content'])}" for m in old
    )

    log.info(
        "compacting",
        conversation_id=conversation_id,
        tokens_before=tokens_before,
        old_count=len(old),
        recent_count=len(recent),
    )

    client = AsyncOpenAI(api_key=api_key, base_url=OR_BASE_URL)
    try:
        resp: Any = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": COMPACTION_PROMPT},
                {"role": "user", "content": conversation_text},
            ],
            stream=False,
            extra_body={"usage": {"include": True}},
        )
    except Exception as e:  # noqa: BLE001
        log.exception("compaction-failed", error=str(e))
        return messages, {
            "triggered": False,
            "error": "Falha ao chamar o modelo para compactação.",
            "tokens_before": tokens_before,
            "limit": get_context_limit(model),
        }

    summary = (resp.choices[0].message.content or "").strip()
    if not summary:
        log.warning("compaction-empty-summary")
        return messages, {
            "triggered": False,
            "error": "Modelo retornou resumo vazio.",
            "tokens_before": tokens_before,
            "limit": get_context_limit(model),
        }

    # Custo
    cost_usd = Decimal("0")
    if resp.usage:
        raw = getattr(resp.usage, "cost", None)
        if raw is not None:
            try:
                cost_usd = Decimal(str(raw))
            except (ValueError, ArithmeticError):
                pass

    # Persiste o summary como ChatMessage SYSTEM kind=COMPACTION_SUMMARY +
    # marca as antigas como compactedAt (soft-delete pro contexto futuro).
    try:
        await _persist_compaction(conversation_id, user_id, summary)
    except Exception as e:  # noqa: BLE001
        log.exception("compaction-persist-failed", error=str(e))
        return messages, {
            "triggered": False,
            "error": "Falha ao persistir resumo no DB.",
            "tokens_before": tokens_before,
            "limit": get_context_limit(model),
        }

    # Registra custo
    try:
        await db.insert_cost_event(
            user_id=user_id,
            model=model,
            tokens_in=int(getattr(resp.usage, "prompt_tokens", 0) or 0),
            tokens_out=int(getattr(resp.usage, "completion_tokens", 0) or 0),
            cost_usd=cost_usd,
            meta={"source": "compaction", "conversation_id": conversation_id},
        )
    except Exception:  # noqa: BLE001
        log.exception("compaction-cost-event-failed")

    # Monta novo array pra enviar ao modelo
    summary_msg = {
        "role": "system",
        "content": (
            f"[Resumo de mensagens anteriores desta conversa, "
            f"compactado automaticamente]\n\n{summary}"
        ),
    }
    new_messages = [*system_msgs, summary_msg, *recent]
    tokens_after = estimate_messages_tokens(new_messages)

    return new_messages, {
        "triggered": True,
        "summary": summary,
        "tokens_before": tokens_before,
        "tokens_after": tokens_after,
        "limit": get_context_limit(model),
        "cost_usd": str(cost_usd),
    }


def _extract_text(content: Any) -> str:
    """Pega só o texto de content (string ou multimodal array)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for p in content:
            if isinstance(p, dict):
                if p.get("type") == "text":
                    parts.append(p.get("text", ""))
                elif p.get("type") == "image_url":
                    parts.append("[imagem]")
        return "\n".join(parts)
    return str(content)


async def _persist_compaction(conversation_id: str, user_id: str, summary: str) -> None:
    """Insere o SYSTEM message + marca todas as outras (não compactadas
    ainda) como compactadas. Executa em transação.

    Cruza `userId` em toda query como defesa em profundidade — o
    `conversation_id` já chega validado pelo middleware do Node API, mas
    se um caller futuro pular esse middleware, esta camada também impede
    compactar conversa de outro user.
    """
    import secrets
    import time

    new_id = f"c{format(int(time.time() * 1000), 'x')[-8:]}{secrets.token_hex(8)}"
    async with db.connection() as conn:
        async with conn.transaction():
            # Valida que a conversa pertence ao user — se não, raise.
            owner = await conn.fetchrow(
                """
                SELECT "userId" FROM "Conversation" WHERE id = $1
                """,
                conversation_id,
            )
            if owner is None or owner["userId"] != user_id:
                raise PermissionError(f"conversation {conversation_id} not owned by {user_id}")
            # Cria a mensagem SYSTEM kind=COMPACTION_SUMMARY
            await conn.execute(
                """
                INSERT INTO "ChatMessage" (
                    id, "conversationId", role, kind, content, "createdAt"
                )
                VALUES (
                    $1, $2, 'SYSTEM'::"ChatRole",
                    'COMPACTION_SUMMARY'::"ChatMessageKind", $3, NOW()
                )
                """,
                new_id,
                conversation_id,
                summary,
            )
            # Marca todas anteriores (exceto a recém-criada) como compactadas
            await conn.execute(
                """
                UPDATE "ChatMessage"
                SET "compactedAt" = NOW()
                WHERE "conversationId" = $1
                  AND id != $2
                  AND "compactedAt" IS NULL
                  AND kind != 'COMPACTION_SUMMARY'::"ChatMessageKind"
                """,
                conversation_id,
                new_id,
            )
            await conn.execute(
                """
                UPDATE "Conversation"
                SET "compactionCount" = "compactionCount" + 1,
                    "updatedAt" = NOW()
                WHERE id = $1 AND "userId" = $2
                """,
                conversation_id,
                user_id,
            )
