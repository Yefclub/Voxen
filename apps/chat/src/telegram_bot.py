"""Telegram bot worker — long polling pra escutar mensagens do bot.

Roda como task background do chat service. Quando `telegram_bot_token` está
setado em Setting, conecta no Bot API e processa updates:

- /start <code>       → vincula conta Voxen (resolve código Redis)
- /buscar <termo>     → search_transcripts + search_notes scoped por userId
- /help               → ajuda
- texto livre         → forward pra Vox via agent_core (HITL via inline_keyboard)
- foto (photo)        → grava no S3 + enfileira job de análise visual
- áudio/vídeo/docs    → grava no S3 + enfileira job de transcrição/análise
- callback_query      → resolve HITL pendente (sim/não) usando state no Redis

HITL: quando a Vox chama request_user_confirmation, o bot recebe state +
action_summary, salva state no Redis com chave `tg:hitl:<chat_id>` (TTL 1h)
e envia mensagem com inline_keyboard. Clique resolve com resume_chat_completion.
"""

from __future__ import annotations

import asyncio
import json
import mimetypes
import uuid
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx
import structlog

from . import db, redis_pub, storage, voxen_settings
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
MAX_TELEGRAM_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_TELEGRAM_MEDIA_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_TELEGRAM_DOCUMENT_UPLOAD_BYTES = 50 * 1024 * 1024

MEDIA_EXTENSIONS = {
    "aac",
    "aiff",
    "avi",
    "flac",
    "m4a",
    "m4v",
    "mkv",
    "mov",
    "mp3",
    "mp4",
    "mpeg",
    "mpga",
    "ogg",
    "opus",
    "wav",
    "webm",
    "wma",
}
IMAGE_EXTENSIONS = {"gif", "jpeg", "jpg", "png", "webp"}
DOCUMENT_EXTENSIONS = {
    "csv",
    "docx",
    "epub",
    "htm",
    "html",
    "json",
    "md",
    "pdf",
    "pptx",
    "txt",
    "xls",
    "xlsx",
    "xml",
}
DOCUMENT_MIME_TYPES = {
    "application/csv",
    "application/epub+zip",
    "application/json",
    "application/pdf",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/xml",
    "text/csv",
    "text/html",
    "text/markdown",
    "text/plain",
    "text/xml",
}


@dataclass(frozen=True)
class TelegramUploadSpec:
    file_id: str
    filename: str
    content_type: str
    file_size: int
    kind: str
    job_type: str


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


async def _get_updates(client: httpx.AsyncClient, token: str, offset: int) -> list[dict[str, Any]]:
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


async def _handle_update(client: httpx.AsyncClient, token: str, upd: dict[str, Any]) -> None:
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

    upload_spec = _telegram_upload_spec_from_message(msg)
    if upload_spec:
        await _handle_upload_attachment(client, token, chat_id, upload_spec)
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
                "• fotos/arquivos de imagem — eu envio para a Biblioteca e analiso\n"
                "• áudio/vídeo — eu envio para a Biblioteca e transcrevo\n"
                "• PDF/DOCX/PPTX/XLSX/CSV/TXT — eu envio para análise documental\n"
                "• ações que peçam confirmação aparecem com botões."
            ),
        )
        return

    await _ask_vox_and_reply(client, token, chat_id, user_text=text)


async def _handle_upload_attachment(
    client: httpx.AsyncClient,
    token: str,
    chat_id: int,
    spec: TelegramUploadSpec,
) -> None:
    """Grava anexo do Telegram no S3 e cria job compatível com o worker."""
    link = await _resolve_link(chat_id)
    if not link:
        await _send(
            client,
            token,
            chat_id,
            "Vincule sua conta antes (gere código em /conta + /start <código>).",
        )
        return

    if spec.kind == "image":
        limit = MAX_TELEGRAM_IMAGE_UPLOAD_BYTES
    elif spec.kind == "document":
        limit = MAX_TELEGRAM_DOCUMENT_UPLOAD_BYTES
    else:
        limit = MAX_TELEGRAM_MEDIA_UPLOAD_BYTES
    if spec.file_size > limit:
        limit_mib = limit // (1024 * 1024)
        await _send(client, token, chat_id, f"⚠️ Arquivo muito grande (limite {limit_mib} MiB).")
        return
    if spec.kind == "document" and not await voxen_settings.get_default_document_model():
        await _send(
            client,
            token,
            chat_id,
            "⚠️ Análise documental ainda não está configurada. "
            "Defina um modelo de documento no setup da Voxen.",
        )
        return

    await _send_chat_action(client, token, chat_id, "upload_document")
    try:
        body = await _download_bot_file(client, token, spec.file_id)
    except Exception as e:  # noqa: BLE001
        log.warning("telegram-upload-download-failed", error=str(e))
        await _send(client, token, chat_id, "⚠️ Falha ao baixar o arquivo do Telegram.")
        return
    if len(body) > limit:
        limit_mib = limit // (1024 * 1024)
        await _send(client, token, chat_id, f"⚠️ Arquivo muito grande (limite {limit_mib} MiB).")
        return

    user_id = str(link["userId"])
    upload_id = str(uuid.uuid4())
    filename = storage.sanitize_upload_filename(spec.filename)
    key = storage.upload_key(user_id, upload_id, filename)
    source_url = f"upload://{upload_id}/{quote(filename)}"
    try:
        await storage.put_bytes(key=key, body=body, content_type=spec.content_type)
        res = await db.create_upload_job(user_id, source_url, spec.job_type)
    except Exception as e:  # noqa: BLE001
        log.exception("telegram-upload-create-job-failed", error=str(e))
        await _send(client, token, chat_id, "⚠️ Falha ao enviar o arquivo para a Biblioteca.")
        return

    if res.get("duplicate") == "transcript":
        await _send(
            client,
            token,
            chat_id,
            "Esse arquivo já está na Biblioteca.",
        )
        return
    if res.get("duplicate") == "job":
        await _send(
            client,
            token,
            chat_id,
            f"Esse arquivo já está em processamento: /jobs/{res['id']}.",
        )
        return

    await redis_pub.publish_new_job(str(res["id"]))
    label = (
        "Imagem enviada para análise"
        if spec.kind == "image"
        else "Documento enviado para análise"
        if spec.kind == "document"
        else "Arquivo enviado para transcrição"
    )
    await _send(client, token, chat_id, f"{label}. Acompanhe em /jobs/{res['id']}.")


async def _download_bot_file(client: httpx.AsyncClient, token: str, file_id: str) -> bytes:
    file_info = await client.get(
        TG_BASE.format(token=token) + "/getFile",
        params={"file_id": file_id},
        timeout=30.0,
    )
    file_info.raise_for_status()
    file_path = ((file_info.json().get("result") or {}).get("file_path")) or ""
    if not file_path:
        raise ValueError("file_path ausente")
    bin_res = await client.get(f"{TG_FILE_BASE.format(token=token)}/{file_path}", timeout=120.0)
    bin_res.raise_for_status()
    return bytes(bin_res.content)


def _telegram_upload_spec_from_message(msg: dict[str, Any]) -> TelegramUploadSpec | None:
    photos = msg.get("photo")
    if isinstance(photos, list) and photos:
        largest = max(photos, key=lambda p: int(p.get("file_size") or 0))
        file_id = str(largest.get("file_id") or "")
        if file_id:
            return TelegramUploadSpec(
                file_id=file_id,
                filename=storage.sanitize_upload_filename(f"foto-{file_id[:10]}.jpg"),
                content_type="image/jpeg",
                file_size=int(largest.get("file_size") or 0),
                kind="image",
                job_type="UPLOAD_AND_ANALYZE_IMAGE",
            )

    for field, default_prefix in (
        ("audio", "audio"),
        ("voice", "voz"),
        ("video", "video"),
        ("video_note", "video"),
        ("document", "arquivo"),
    ):
        payload = msg.get(field)
        if isinstance(payload, dict):
            return _telegram_upload_spec_from_payload(payload, default_prefix)
    return None


def _telegram_upload_spec_from_payload(
    payload: dict[str, Any],
    default_prefix: str,
) -> TelegramUploadSpec | None:
    file_id = str(payload.get("file_id") or "")
    if not file_id:
        return None
    content_type = str(payload.get("mime_type") or _fallback_content_type(default_prefix))
    filename = _telegram_upload_filename(
        raw=str(payload.get("file_name") or ""),
        file_id=file_id,
        content_type=content_type,
        default_prefix=default_prefix,
    )
    ext = _extension(filename)
    if _is_image_file(content_type, ext):
        return TelegramUploadSpec(
            file_id=file_id,
            filename=filename,
            content_type=content_type,
            file_size=int(payload.get("file_size") or 0),
            kind="image",
            job_type="UPLOAD_AND_ANALYZE_IMAGE",
        )
    if _is_media_file(content_type, ext):
        return TelegramUploadSpec(
            file_id=file_id,
            filename=filename,
            content_type=content_type,
            file_size=int(payload.get("file_size") or 0),
            kind="media",
            job_type="UPLOAD_AND_TRANSCRIBE",
        )
    if _is_document_file(content_type, ext):
        return TelegramUploadSpec(
            file_id=file_id,
            filename=filename,
            content_type=content_type,
            file_size=int(payload.get("file_size") or 0),
            kind="document",
            job_type="UPLOAD_AND_ANALYZE_DOCUMENT",
        )
    return None


def _telegram_upload_filename(
    *,
    raw: str,
    file_id: str,
    content_type: str,
    default_prefix: str,
) -> str:
    if raw.strip():
        return storage.sanitize_upload_filename(raw)
    normalized_content_type = content_type.split(";")[0].strip().lower()
    ext = "ogg" if normalized_content_type == "audio/ogg" else (
        mimetypes.guess_extension(normalized_content_type) or ""
    ).lstrip(".")
    if not ext:
        ext = "bin"
    return storage.sanitize_upload_filename(f"{default_prefix}-{file_id[:10]}.{ext}")


def _fallback_content_type(default_prefix: str) -> str:
    if default_prefix == "voz":
        return "audio/ogg"
    if default_prefix == "video":
        return "video/mp4"
    return "application/octet-stream"


def _extension(filename: str) -> str:
    if "." not in filename:
        return ""
    return filename.rsplit(".", 1)[-1].lower()


def _is_image_file(content_type: str, ext: str) -> bool:
    type_norm = content_type.split(";", 1)[0].strip().lower()
    return (
        type_norm in {"image/png", "image/jpeg", "image/webp", "image/gif"}
        or ext in IMAGE_EXTENSIONS
    )


def _is_media_file(content_type: str, ext: str) -> bool:
    type_norm = content_type.split(";", 1)[0].strip().lower()
    return type_norm.startswith(("audio/", "video/")) or ext in MEDIA_EXTENSIONS


def _is_document_file(content_type: str, ext: str) -> bool:
    type_norm = content_type.split(";", 1)[0].strip().lower()
    return type_norm in DOCUMENT_MIME_TYPES or ext in DOCUMENT_EXTENSIONS


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


async def _handle_callback(client: httpx.AsyncClient, token: str, callback: dict[str, Any]) -> None:
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


async def _handle_search(client: httpx.AsyncClient, token: str, chat_id: int, query: str) -> None:
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
