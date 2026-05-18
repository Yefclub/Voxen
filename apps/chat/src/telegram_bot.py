"""Telegram bot worker — long polling pra escutar mensagens do bot.

Roda como task background do chat service. Quando `telegram_bot_token` está
setado em Setting, conecta no Bot API e processa updates:

- /start <code>       → vincula conta Voxen (resolve código Redis)
- /buscar <termo>     → search_transcripts + search_notes scoped por userId
- /help               → ajuda
- texto livre         → forward pra Vox via agent_core (HITL via inline_keyboard)
- foto (photo)        → baixa via Bot API + envia pra Vox (vision pipeline)
- callback_query      → resolve HITL pendente (sim/não) usando state no Redis

HITL: quando a Vox chama request_user_confirmation, o bot recebe state +
action_summary, salva state no Redis com chave `tg:hitl:<chat_id>` (TTL 1h)
e envia mensagem com inline_keyboard. Clique resolve com resume_chat_completion.
"""

from __future__ import annotations

import asyncio
import base64
import json
from typing import Any

import httpx
import structlog

from . import db, voxen_settings
from .agent_core import (
    AgentTurnResult,
    resume_chat_completion,
    run_chat_completion,
)
from .redis_pub import get_redis

log = structlog.get_logger("telegram")

TG_BASE = "https://api.telegram.org/bot{token}"
TG_FILE_BASE = "https://api.telegram.org/file/bot{token}"
POLL_TIMEOUT = 25
RETRY_BASE_SEC = 2.0
RETRY_MAX_SEC = 60.0
HITL_REDIS_TTL_SEC = 3600  # 1h pra resolver
MAX_PHOTO_SIZE = 5 * 1024 * 1024  # 5 MB (bate com cap web)


async def telegram_loop() -> None:
    """Loop principal. Reentrante — pode ser cancelado e relançado."""
    backoff = RETRY_BASE_SEC
    last_update_id = 0
    while True:
        token = await voxen_settings.get_telegram_bot_token()
        if not token:
            await asyncio.sleep(30)
            continue
        try:
            async with httpx.AsyncClient(timeout=POLL_TIMEOUT + 10) as client:
                updates = await _get_updates(client, token, last_update_id)
                for upd in updates:
                    upd_id = int(upd.get("update_id", 0))
                    if upd_id > last_update_id:
                        last_update_id = upd_id
                    try:
                        await _handle_update(client, token, upd)
                    except Exception:  # noqa: BLE001
                        log.exception("telegram-handle-update-failed", upd_id=upd_id)
            backoff = RETRY_BASE_SEC
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
            # callback_query habilita inline_keyboard pro HITL
            "allowed_updates": json.dumps(["message", "callback_query"]),
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
    # 1. Callback query (botões inline)
    callback = upd.get("callback_query")
    if callback:
        await _handle_callback(client, token, callback)
        return

    msg = upd.get("message") or {}
    chat = msg.get("chat") or {}
    chat_id = chat.get("id")
    if not chat_id:
        return

    # 2. Foto (com ou sem caption)
    photos = msg.get("photo")
    if photos:
        caption = (msg.get("caption") or "").strip()
        await _handle_photo(client, token, chat_id, photos, caption)
        return

    # 3. Texto
    text = (msg.get("text") or "").strip()
    if not text:
        return

    if text.startswith("/start"):
        await _handle_start(client, token, chat, text)
        return
    if text.startswith("/buscar"):
        await _handle_search(client, token, chat_id, text[len("/buscar") :].strip())
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
                "Você também pode me mandar:\n"
                "• texto livre — pergunte qualquer coisa\n"
                "• fotos — eu analiso a imagem\n"
                "• ações que peçam confirmação aparecem com botões."
            ),
        )
        return

    await _ask_vox_and_reply(client, token, chat_id, user_text=text)


async def _handle_photo(
    client: httpx.AsyncClient,
    token: str,
    chat_id: int,
    photos: list[dict[str, Any]],
    caption: str,
) -> None:
    """Baixa a melhor resolução da foto via Bot API, converte pra data URL
    e envia pra Vox com vision pipeline."""
    link = await _resolve_link(chat_id)
    if not link:
        await _send(
            client,
            token,
            chat_id,
            "Vincule sua conta antes (gere código em /conta + /start <código>).",
        )
        return

    # Telegram envia várias resoluções; pega a maior
    largest = max(photos, key=lambda p: int(p.get("file_size") or 0))
    file_id = largest.get("file_id")
    file_size = int(largest.get("file_size") or 0)
    if not file_id:
        await _send(client, token, chat_id, "⚠️ Foto sem file_id, não consigo baixar.")
        return
    if file_size > MAX_PHOTO_SIZE:
        await _send(client, token, chat_id, "⚠️ Imagem muito grande (limite 5 MB).")
        return

    # getFile → file_path
    try:
        file_info = await client.get(
            TG_BASE.format(token=token) + "/getFile",
            params={"file_id": file_id},
            timeout=30.0,
        )
        file_info.raise_for_status()
        file_path = ((file_info.json().get("result") or {}).get("file_path")) or ""
        if not file_path:
            raise ValueError("file_path ausente")
    except Exception as e:  # noqa: BLE001
        log.warning("telegram-getfile-failed", error=str(e))
        await _send(client, token, chat_id, "⚠️ Falha ao obter a foto.")
        return

    # Download do binário
    try:
        bin_res = await client.get(
            f"{TG_FILE_BASE.format(token=token)}/{file_path}", timeout=60.0
        )
        bin_res.raise_for_status()
    except Exception as e:  # noqa: BLE001
        log.warning("telegram-download-failed", error=str(e))
        await _send(client, token, chat_id, "⚠️ Falha ao baixar a foto.")
        return

    # Telegram sempre serve fotos como JPEG após processamento
    b64 = base64.b64encode(bin_res.content).decode("ascii")
    data_url = f"data:image/jpeg;base64,{b64}"
    user_text = caption or "Descreva esta imagem em detalhes."
    await _ask_vox_and_reply(
        client, token, chat_id, user_text=user_text, image_data_url=data_url
    )


async def _ask_vox_and_reply(
    client: httpx.AsyncClient,
    token: str,
    chat_id: int,
    user_text: str,
    image_data_url: str | None = None,
) -> None:
    """Chama a Vox e envia a resposta. Se houver HITL pendente, envia
    inline_keyboard em vez de texto final."""
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
    await _send_chat_action(client, token, chat_id, "typing")
    try:
        result = await run_chat_completion(
            user_id=user_id,
            user_text=user_text,
            source="telegram",
            image_data_url=image_data_url,
            interrupt_on_confirmation=True,
        )
    except Exception as e:  # noqa: BLE001
        log.exception("telegram-vox-failed", error=str(e))
        await _send(client, token, chat_id, f"⚠️ Erro ao consultar a Vox: {e}")
        return

    if result.pending_hitl:
        await _send_hitl_prompt(client, token, chat_id, user_id, result)
        return

    for chunk in _split_telegram(result.final_content, 3900):
        await _send(client, token, chat_id, chunk, parse_mode="Markdown")


async def _send_hitl_prompt(
    client: httpx.AsyncClient,
    token: str,
    chat_id: int,
    user_id: str,
    result: AgentTurnResult,
) -> None:
    """Envia mensagem com inline_keyboard pro user confirmar/cancelar ação
    pedida pelo agente. Persiste state em Redis pra resumir no callback."""
    pending = result.pending_hitl or {}
    action = pending.get("action_summary", "Confirmar ação?")
    tool_call_id = pending.get("tool_call_id", "")
    state = pending.get("state", [])
    model = pending.get("model", "")

    # Salva state no Redis com chave unique por chat — token curto vai no callback_data
    # (Telegram limita callback_data a 64 bytes).
    import secrets

    token_short = secrets.token_hex(6)  # 12 chars
    redis = await get_redis()
    redis_key = f"tg:hitl:{chat_id}:{token_short}"
    await redis.set(
        redis_key,
        json.dumps(
            {
                "tool_call_id": tool_call_id,
                "state": state,
                "user_id": user_id,
                "model": model,
            },
            ensure_ascii=False,
            default=str,
        ),
        ex=HITL_REDIS_TTL_SEC,
    )

    # Texto opcional gerado pelo assistant antes do tool_call
    pre_text = (result.final_content or "").strip()
    body = f"🤔 *Confirmação necessária*\n\n{action}"
    if pre_text:
        body = f"{pre_text}\n\n{body}"

    keyboard = {
        "inline_keyboard": [
            [
                {"text": "✅ Confirmar", "callback_data": f"hitl:{token_short}:y"},
                {"text": "❌ Cancelar", "callback_data": f"hitl:{token_short}:n"},
            ]
        ]
    }
    await _send(client, token, chat_id, body, parse_mode="Markdown", reply_markup=keyboard)


async def _handle_callback(
    client: httpx.AsyncClient, token: str, callback: dict[str, Any]
) -> None:
    """User clicou em botão inline. Resolve HITL pendente."""
    cb_id = callback.get("id")
    data = callback.get("data") or ""
    msg = callback.get("message") or {}
    chat = msg.get("chat") or {}
    chat_id = chat.get("id")
    message_id = msg.get("message_id")

    if not cb_id or not chat_id:
        return

    # Answer callback imediatamente pra parar o spinner do Telegram
    async def ack(text: str | None = None) -> None:
        try:
            await client.post(
                TG_BASE.format(token=token) + "/answerCallbackQuery",
                json={"callback_query_id": cb_id, **({"text": text} if text else {})},
                timeout=10.0,
            )
        except httpx.HTTPError:
            pass

    if not data.startswith("hitl:"):
        await ack()
        return

    parts = data.split(":")
    if len(parts) != 3:
        await ack("Formato inválido.")
        return
    _, token_short, decision = parts
    approved = decision == "y"

    redis = await get_redis()
    redis_key = f"tg:hitl:{chat_id}:{token_short}"
    raw = await redis.get(redis_key)
    if not raw:
        await ack("⏱️ Confirmação expirou. Tente de novo.")
        if message_id:
            await _edit_message(
                client,
                token,
                chat_id,
                message_id,
                "⏱️ Confirmação expirou (mais de 1h).",
            )
        return
    await redis.delete(redis_key)

    try:
        stored = json.loads(raw)
    except Exception:  # noqa: BLE001
        await ack("Estado inválido.")
        return

    # Atualiza a mensagem original substituindo botões por status
    if message_id:
        status_text = "✅ Aprovado pelo usuário" if approved else "❌ Cancelado pelo usuário"
        await _edit_message(client, token, chat_id, message_id, status_text)
    await ack("Processando…")
    await _send_chat_action(client, token, chat_id, "typing")

    try:
        result = await resume_chat_completion(
            state=stored["state"],
            tool_call_id=stored["tool_call_id"],
            approved=approved,
            user_id=stored["user_id"],
            model=stored["model"],
            source="telegram",
        )
    except Exception as e:  # noqa: BLE001
        log.exception("telegram-hitl-resume-failed", error=str(e))
        await _send(client, token, chat_id, f"⚠️ Erro ao retomar: {e}")
        return

    # Pode ter outra confirmação encadeada (raro mas possível)
    if result.pending_hitl:
        await _send_hitl_prompt(
            client,
            token,
            chat_id,
            stored["user_id"],
            result,
        )
        return

    for chunk in _split_telegram(result.final_content, 3900):
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
    await redis.delete(f"tg:link:{code}")
    await _send(
        client,
        token,
        chat_id,
        f"✅ Vinculado! Sua conta Voxen agora está conectada como @{username}. "
        "Use /buscar pra pesquisar na sua biblioteca, ou só mande uma pergunta direta.",
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


async def _send_chat_action(
    client: httpx.AsyncClient, token: str, chat_id: int, action: str
) -> None:
    url = TG_BASE.format(token=token) + "/sendChatAction"
    try:
        await client.post(url, json={"chat_id": chat_id, "action": action})
    except httpx.HTTPError:
        pass


def _split_telegram(text: str, limit: int) -> list[str]:
    if len(text) <= limit:
        return [text]
    chunks: list[str] = []
    remaining = text
    while len(remaining) > limit:
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
    reply_markup: dict[str, Any] | None = None,
) -> None:
    url = TG_BASE.format(token=token) + "/sendMessage"
    body: dict[str, Any] = {"chat_id": chat_id, "text": text[:4000]}
    if parse_mode:
        body["parse_mode"] = parse_mode
    if reply_markup:
        body["reply_markup"] = reply_markup
    try:
        res = await client.post(url, json=body)
        # Se Markdown falhar (entidade não pareada), tenta sem parse_mode
        if res.status_code == 400 and parse_mode:
            body.pop("parse_mode", None)
            await client.post(url, json=body)
    except httpx.HTTPError as e:
        log.warning("telegram-send-error", error=str(e))


async def _edit_message(
    client: httpx.AsyncClient,
    token: str,
    chat_id: int,
    message_id: int,
    text: str,
) -> None:
    """Edita mensagem existente — usado pra trocar inline_keyboard por status."""
    url = TG_BASE.format(token=token) + "/editMessageText"
    try:
        await client.post(
            url,
            json={
                "chat_id": chat_id,
                "message_id": message_id,
                "text": text[:4000],
            },
            timeout=10.0,
        )
    except httpx.HTTPError as e:
        log.warning("telegram-edit-error", error=str(e))


def _gen_id() -> str:
    import secrets
    import time

    return f"t{format(int(time.time() * 1000), 'x')[-8:]}{secrets.token_hex(8)}"
