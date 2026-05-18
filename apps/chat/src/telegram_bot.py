"""Telegram bot worker — long polling pra escutar mensagens do bot.

Roda como task background do chat service. Quando `telegram_bot_token` está
setado em Setting, conecta no Bot API e processa updates:

- /start <code>  → resolve código do Redis (gerado em /api/account/telegram/code)
                   e cria TelegramLink no DB.
- /buscar <termo> → search_transcripts + search_notes scoped por userId
- texto livre    → forward pra Vox (mesma pipeline do /chat)

Stack: httpx pra Bot API (sem dependência externa de aiogram). Long polling
com timeout=25s, retry exponencial em erro.

Pra rodar em prod: o entrypoint do chat service spawna `telegram_loop` em
asyncio.create_task quando o setting está presente.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
import structlog

from . import db, voxen_settings
from .redis_pub import get_redis

log = structlog.get_logger("telegram")

TG_BASE = "https://api.telegram.org/bot{token}"
POLL_TIMEOUT = 25
RETRY_BASE_SEC = 2.0
RETRY_MAX_SEC = 60.0


async def telegram_loop() -> None:
    """Loop principal. Reentrante — pode ser cancelado e relançado."""
    backoff = RETRY_BASE_SEC
    last_update_id = 0
    while True:
        token = await voxen_settings.get_telegram_bot_token()
        if not token:
            # Sem token → dorme 30s e relê (admin pode setar em runtime)
            await asyncio.sleep(30)
            continue
        try:
            async with httpx.AsyncClient(timeout=POLL_TIMEOUT + 10) as client:
                updates = await _get_updates(client, token, last_update_id)
                for upd in updates:
                    upd_id = int(upd.get("update_id", 0))
                    if upd_id > last_update_id:
                        last_update_id = upd_id
                    await _handle_update(client, token, upd)
            backoff = RETRY_BASE_SEC  # reset após sucesso
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            log.exception("telegram-loop-error", error=str(e))
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, RETRY_MAX_SEC)


async def _get_updates(
    client: httpx.AsyncClient, token: str, offset: int
) -> list[dict[str, Any]]:
    url = TG_BASE.format(token=token) + "/getUpdates"
    res = await client.get(
        url,
        params={
            "offset": offset + 1,
            "timeout": POLL_TIMEOUT,
            "allowed_updates": ["message"],
        },
    )
    res.raise_for_status()
    data = res.json()
    if not data.get("ok"):
        log.warning("telegram-getupdates-not-ok", description=data.get("description"))
        return []
    return list(data.get("result") or [])


async def _handle_update(
    client: httpx.AsyncClient, token: str, upd: dict[str, Any]
) -> None:
    msg = upd.get("message") or {}
    chat = msg.get("chat") or {}
    chat_id = chat.get("id")
    text = (msg.get("text") or "").strip()
    if not chat_id or not text:
        return

    # Roteamento simples por comando
    if text.startswith("/start"):
        await _handle_start(client, token, chat, text)
        return
    if text.startswith("/buscar"):
        await _handle_search(client, token, chat_id, text[len("/buscar"):].strip())
        return
    if text.startswith("/help"):
        await _send(
            client,
            token,
            chat_id,
            (
                "Olá! Sou a Vox.\n\n"
                "Comandos:\n"
                "/start <código> — vincula sua conta Voxen\n"
                "/buscar <termo> — busca na sua biblioteca\n"
                "/help — esta mensagem\n\n"
                "Ou só me mande uma pergunta direta."
            ),
        )
        return

    # Texto livre → confirma vínculo + responde via Vox
    link = await _resolve_link(chat_id)
    if not link:
        await _send(
            client,
            token,
            chat_id,
            "Você ainda não vinculou sua conta Voxen. Gere um código em /conta e me mande "
            "/start <código>.",
        )
        return
    user_id = link["userId"]
    # Mostra typing pra UX enquanto processa (cap em 30s)
    await _send_chat_action(client, token, chat_id, "typing")
    try:
        reply = await _ask_vox(user_id, text)
    except Exception as e:  # noqa: BLE001
        log.exception("telegram-vox-failed", error=str(e))
        await _send(client, token, chat_id, f"⚠️ Erro ao consultar a Vox: {e}")
        return
    # Telegram limit 4096 chars — split em partes se precisa
    for chunk in _split_telegram(reply, 3900):
        await _send(client, token, chat_id, chunk, parse_mode="Markdown")


async def _handle_start(
    client: httpx.AsyncClient, token: str, chat: dict[str, Any], text: str
) -> None:
    chat_id = chat["id"]
    parts = text.split(maxsplit=1)
    if len(parts) < 2:
        await _send(
            client,
            token,
            chat_id,
            "Use /start <código>. Gere o código em /conta no Voxen.",
        )
        return
    code = parts[1].strip()
    redis = await get_redis()
    user_id = await redis.get(f"tg:link:{code}")
    if not user_id:
        await _send(
            client,
            token,
            chat_id,
            "Código inválido ou expirou (válido por 10 minutos). Gere outro em /conta.",
        )
        return
    user_id_str = str(user_id)
    username = chat.get("username") or chat.get("first_name") or ""
    # Cria ou atualiza link
    async with db.connection() as conn:
        await conn.execute(
            """
            INSERT INTO "TelegramLink" (id, "userId", "chatId", username, "linkedAt")
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT ("userId") DO UPDATE
                SET "chatId" = EXCLUDED."chatId",
                    username = EXCLUDED.username,
                    "linkedAt" = NOW()
            """,
            _gen_id(),
            user_id_str,
            int(chat_id),
            username[:200] or None,
        )
    # Invalida o código (one-shot)
    await redis.delete(f"tg:link:{code}")
    await _send(
        client,
        token,
        chat_id,
        f"✅ Vinculado! Sua conta Voxen agora está conectada como @{username}. "
        "Use /buscar pra pesquisar na sua biblioteca.",
    )


async def _handle_search(
    client: httpx.AsyncClient, token: str, chat_id: int, query: str
) -> None:
    if not query:
        await _send(client, token, chat_id, "Use /buscar <termo>.")
        return
    link = await _resolve_link(chat_id)
    if not link:
        await _send(
            client,
            token,
            chat_id,
            "Vincule sua conta antes de buscar. Gere código em /conta + /start <código>.",
        )
        return
    user_id = link["userId"]
    rows = await db.search_user_transcripts(user_id, query, limit=5)
    notes = await db.search_user_notes(user_id, query, limit=5)
    if not rows and not notes:
        await _send(client, token, chat_id, f"Nada encontrado pra «{query}».")
        return
    parts = [f"🔍 Resultados pra «{query}»:\n"]
    for r in rows[:3]:
        snippet = (r.get("snippet") or "").replace("«", "*").replace("»", "*")
        parts.append(f"📺 *{r['title']}*\n{snippet[:200]}\n")
    for n in notes[:3]:
        snippet = (n.get("snippet") or "").replace("«", "*").replace("»", "*")
        parts.append(f"📝 *{n['title']}*\n{snippet[:200]}\n")
    await _send(client, token, chat_id, "\n".join(parts), parse_mode="Markdown")


async def _resolve_link(chat_id: int) -> dict[str, Any] | None:
    async with db.connection() as conn:
        row = await conn.fetchrow(
            'SELECT "userId" FROM "TelegramLink" WHERE "chatId" = $1',
            int(chat_id),
        )
    return dict(row) if row else None


async def _ask_vox(user_id: str, user_text: str) -> str:
    """Chama a Vox sem SSE — acumula resposta + cost e devolve texto final.

    Mantém uma Conversation por user (title "Telegram") pra preservar
    histórico cross-session do bot. Loop multi-tool igual ao /chat endpoint
    com cap em MAX_TOOL_LOOPS (5).
    """
    from .agent_core import run_chat_completion

    return await run_chat_completion(user_id=user_id, user_text=user_text, source="telegram")


async def _send_chat_action(
    client: httpx.AsyncClient, token: str, chat_id: int, action: str
) -> None:
    """Mostra "digitando…" na conversa do user enquanto a IA processa."""
    url = TG_BASE.format(token=token) + "/sendChatAction"
    try:
        await client.post(url, json={"chat_id": chat_id, "action": action})
    except httpx.HTTPError:
        pass


def _split_telegram(text: str, limit: int) -> list[str]:
    """Divide texto longo em chunks respeitando o limite de 4096 chars do
    Telegram. Prefere quebrar em parágrafos; se não couber, quebra cru."""
    if len(text) <= limit:
        return [text]
    chunks: list[str] = []
    remaining = text
    while len(remaining) > limit:
        # Tenta quebrar em \n\n próximo do limite
        idx = remaining.rfind("\n\n", 0, limit)
        if idx <= 0:
            idx = remaining.rfind("\n", 0, limit)
        if idx <= 0:
            idx = remaining.rfind(" ", 0, limit)
        if idx <= 0:
            idx = limit
        chunks.append(remaining[:idx].rstrip())
        remaining = remaining[idx:].lstrip()
    if remaining:
        chunks.append(remaining)
    return chunks


async def _send(
    client: httpx.AsyncClient,
    token: str,
    chat_id: int,
    text: str,
    parse_mode: str | None = None,
) -> None:
    url = TG_BASE.format(token=token) + "/sendMessage"
    body: dict[str, Any] = {"chat_id": chat_id, "text": text[:4000]}
    if parse_mode:
        body["parse_mode"] = parse_mode
    try:
        await client.post(url, json=body)
    except httpx.HTTPError as e:
        log.warning("telegram-send-error", error=str(e))


def _gen_id() -> str:
    import secrets
    import time

    return f"t{format(int(time.time() * 1000), 'x')[-8:]}{secrets.token_hex(8)}"
