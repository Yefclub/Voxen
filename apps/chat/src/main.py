"""Voxen Chat — FastAPI + tool-calling loop sobre OpenRouter."""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator
from decimal import Decimal
from typing import Any

import httpx
import structlog
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from openai import AsyncOpenAI
from pydantic import BaseModel

from . import db, voxen_settings
from .telegram_bot import telegram_loop
from .tools import TOOLS_SPEC, execute_tool

log = structlog.get_logger(__name__)
app = FastAPI(title="Voxen Chat", version="1.0.0")

# Telegram bot worker — spawnado no startup, sobrevive ao boot inteiro do
# processo. Se setting `telegram_bot_token` ausente, fica dormindo até admin
# configurar (sem reiniciar o chat service).
_telegram_task: asyncio.Task[None] | None = None


@app.on_event("startup")
async def _start_telegram() -> None:
    global _telegram_task
    _telegram_task = asyncio.create_task(telegram_loop(), name="telegram-bot")


@app.on_event("shutdown")
async def _stop_telegram() -> None:
    if _telegram_task and not _telegram_task.done():
        _telegram_task.cancel()
        try:
            await _telegram_task
        except asyncio.CancelledError:
            pass


MAX_TOOL_LOOPS = 5
OR_BASE_URL = "https://openrouter.ai/api/v1"

SYSTEM_PROMPT_BASE = """Você é a Vox, assistente do Voxen — base de conhecimento pessoal.

IDENTIDADE:
- Você é a "Vox" (identificação feminina). Apresente-se como Vox quando perguntada.
- O Voxen é a plataforma; a Vox é VOCÊ, a assistente.
- O usuário se chama: {user_name}.
- Data e hora atual: {current_datetime} ({user_timezone}).
- Idioma de resposta padrão: português brasileiro.

REGRAS DE TRABALHO:
- Responda EXCLUSIVAMENTE com base nas tools disponíveis e no contexto. Nunca invente.
- Sempre faça `search_transcripts` antes de citar conteúdo. Use palavras-chave em pt-br.
- Quando o usuário pedir resumo, use `read_transcript_summary` primeiro; só leia o markdown
  completo via `read_transcript` se o resumo for insuficiente.
- Cite fontes incluindo o id da transcrição e timestamps. Use `[mm:ss](id) texto` pra UI linkar.
- Markdown na resposta: títulos curtos, listas, ênfase. Sem HTML.
- Se a base está vazia, diga e sugira indexar conteúdo.

INDEXAÇÃO:
- Link de vídeo (YouTube/Instagram Reel/TikTok) — chame `transcribe_video`. Confirme rápido,
  avise que demora (curto: ~30s, longo: minutos).
- Link http(s) que NÃO é vídeo (blog, artigo, docs, wiki) — chame `scrape_url`. Confirme rápido.

PESQUISA WEB:
- Use `web_search` APENAS pra info atual que não está na base (datas, fatos voláteis, notícias).
- Não use `web_search` em vez de `search_transcripts` — base interna é primária.

AÇÕES MODIFICATÓRIAS (HITL):
- Antes de ações que MODIFICAM dados (criar/editar/excluir nota, sobrescrever conteúdo),
  chame `request_user_confirmation` com resumo claro do que vai fazer.
- Após chamar, ESPERE a próxima mensagem do usuário. Não executa em loop.
- Ações apenas LEITORAS (listar, ler, buscar) não precisam de confirmação.

ESTILO:
- Direta, útil, sem rodeios. Tom profissional mas humano.
- Se não souber, diga "não sei" + sugira tool/caminho.
"""


def build_system_prompt(user_name: str, user_timezone: str) -> str:
    """Renderiza o system prompt injetando variáveis de contexto.

    `user_name` cai pra "usuário" se vazio. Timezone IANA (ex: "America/Sao_Paulo");
    se inválido vira UTC. A data é calculada com zoneinfo na hora da chamada
    pra refletir o momento real (não o do boot do container).
    """
    import datetime as _dt
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    try:
        tz = ZoneInfo(user_timezone) if user_timezone else ZoneInfo("UTC")
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("UTC")
        user_timezone = "UTC"
    now = _dt.datetime.now(tz)
    formatted = now.strftime("%A, %d de %B de %Y, %H:%M")
    return SYSTEM_PROMPT_BASE.format(
        user_name=user_name or "usuário",
        current_datetime=formatted,
        user_timezone=user_timezone,
    )


@app.get("/health")
async def health() -> dict[str, object]:
    return {"ok": True, "service": "chat"}


@app.get("/health/deep")
async def health_deep() -> JSONResponse:
    """Checa DB + setting cifrado decifrável. 200 se ok, 503 se não.

    O check de 'settings_decryptable' tenta carregar+decifrar 'openrouter_api_key'
    do DB usando a master key. Cobre 2 coisas em 1: (a) master key existe e é
    válida, (b) DB tem row de setting acessível. É mais honesto que checar só
    se o arquivo de master key carrega (que é cached e sempre passa após boot).
    """
    checks: dict[str, dict[str, object]] = {}
    all_ok = True

    # Postgres
    t = time.perf_counter()
    try:
        async with db.connection() as conn:
            await conn.fetchval("SELECT 1")
        checks["postgres"] = {"ok": True, "latencyMs": round((time.perf_counter() - t) * 1000)}
    except Exception as e:  # noqa: BLE001
        all_ok = False
        checks["postgres"] = {"ok": False, "error": str(e)}

    # Setting decryptable — testa master key + DB + cifragem fim-a-fim.
    # Retorna ok mesmo se a setting não existe (setup incompleto não é falha
    # de health) — só falha se decrypt der erro.
    t = time.perf_counter()
    try:
        await voxen_settings.get_openrouter_api_key()
        checks["settings_decryptable"] = {
            "ok": True,
            "latencyMs": round((time.perf_counter() - t) * 1000),
        }
    except Exception as e:  # noqa: BLE001
        all_ok = False
        checks["settings_decryptable"] = {"ok": False, "error": str(e)}

    return JSONResponse({"ok": all_ok, "checks": checks}, status_code=200 if all_ok else 503)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    thinking: bool = False
    # Nome do user vem no body (não header) pra suportar unicode — fetch valida
    # headers como Latin-1 e lançaria em nomes com CJK/emoji/acentos exóticos.
    user_name: str = ""
    # Imagem anexada à última mensagem do user (data URL base64). Quando
    # presente, o agente usa default_vision_model em vez de default_chat_model
    # e injeta a imagem no content multimodal da última mensagem.
    image_data_url: str | None = None


@app.post("/chat")
async def chat(
    body: ChatRequest,
    request: Request,
    x_voxen_user_id: str | None = Header(default=None, alias="X-Voxen-User-Id"),
    x_voxen_conversation_id: str | None = Header(default=None, alias="X-Voxen-Conversation-Id"),
    x_voxen_user_timezone: str | None = Header(default=None, alias="X-Voxen-User-Timezone"),
) -> StreamingResponse:
    if not x_voxen_user_id:
        raise HTTPException(status_code=401, detail="Header X-Voxen-User-Id ausente.")

    api_key = await voxen_settings.get_openrouter_api_key()
    if not api_key:
        raise HTTPException(status_code=412, detail="Setup incompleto — chave OpenRouter ausente.")
    model = await voxen_settings.get_default_chat_model()
    if not model:
        raise HTTPException(
            status_code=412, detail="Setup incompleto — modelo de chat padrão ausente."
        )

    user_id = x_voxen_user_id
    conversation_id = x_voxen_conversation_id
    thinking = body.thinking
    system_prompt = build_system_prompt(
        user_name=body.user_name,
        user_timezone=x_voxen_user_timezone or "UTC",
    )

    # Se mandou imagem, troca pro vision model (se configurado).
    if body.image_data_url:
        vision_model = await voxen_settings.get_default_vision_model()
        if vision_model:
            model = vision_model
        # Sem vision_model setting: continua com chat model (alguns aceitam
        # imagens nativamente, ex: gpt-4o; OpenRouter retorna erro se não).

    async def event_stream() -> AsyncIterator[str]:
        client = AsyncOpenAI(
            api_key=api_key,
            base_url=OR_BASE_URL,
        )
        # Última mensagem do user pode receber imagem inline (multimodal).
        # Demais ficam com content string puro.
        msg_list: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
        ]
        for i, m in enumerate(body.messages):
            is_last_user = (
                i == len(body.messages) - 1 and m.role == "user" and body.image_data_url is not None
            )
            if is_last_user:
                msg_list.append(
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": m.content or "Descreva esta imagem."},
                            {
                                "type": "image_url",
                                "image_url": {"url": body.image_data_url},
                            },
                        ],
                    }
                )
            else:
                msg_list.append({"role": m.role, "content": m.content})
        messages: list[dict[str, Any]] = msg_list

        # === Compactação de memória ===
        # Se a conversa está perto do limite do modelo (>= 80%), gera um
        # resumo detalhado e substitui as mensagens antigas por ele.
        # Emite eventos SSE pra UI mostrar progresso.
        from .compaction import maybe_compact_messages
        from .token_limits import estimate_messages_tokens, get_context_limit

        tokens_before = estimate_messages_tokens(messages)
        ctx_limit = get_context_limit(model)
        # Notifica estado atual de uso ANTES de qualquer chamada
        yield _sse(
            "context_usage",
            {"tokens": tokens_before, "limit": ctx_limit},
        )
        compacted, compact_info = await maybe_compact_messages(
            api_key=api_key,
            model=model,
            user_id=user_id,
            conversation_id=conversation_id,
            messages=messages,
        )
        if compact_info:
            messages = compacted
            yield _sse(
                "compaction_done",
                {
                    "summary": compact_info["summary"],
                    "tokens_before": compact_info["tokens_before"],
                    "tokens_after": compact_info["tokens_after"],
                    "limit": compact_info["limit"],
                    "cost_usd": compact_info["cost_usd"],
                },
            )
        # === Fim compactação ===

        extra: dict[str, Any] = {}
        if thinking:
            extra["reasoning"] = {"effort": "medium"}

        total_in = 0
        total_out = 0
        total_cost = Decimal("0")
        loops = 0

        try:
            while loops < MAX_TOOL_LOOPS:
                loops += 1
                if await request.is_disconnected():
                    return

                # `usage.include` no extra_body faz OR retornar custo $ real
                # no campo `usage.cost` (https://openrouter.ai/docs/use-cases/usage-accounting).
                # Sem isso o usage.cost vem 0/None e o painel mostra $0,00.
                completion_extra = dict(extra)
                completion_extra["usage"] = {"include": True}
                kwargs: dict[str, Any] = dict(
                    model=model,
                    messages=messages,
                    tools=TOOLS_SPEC,
                    stream=True,
                    stream_options={"include_usage": True},
                    extra_body=completion_extra,
                )

                stream = await client.chat.completions.create(**kwargs)

                content_buf = ""
                tool_calls: list[dict[str, Any]] = []
                finish_reason: str | None = None

                async for chunk in stream:
                    if not chunk.choices:
                        if chunk.usage:
                            total_in += chunk.usage.prompt_tokens or 0
                            total_out += chunk.usage.completion_tokens or 0
                            # OR injeta `cost` no usage quando `usage.include=true`
                            cost = getattr(chunk.usage, "cost", None)
                            if cost is not None:
                                try:
                                    total_cost += Decimal(str(cost))
                                except (ValueError, ArithmeticError):
                                    pass
                        continue

                    delta = chunk.choices[0].delta
                    finish_reason = chunk.choices[0].finish_reason or finish_reason

                    if delta.content:
                        content_buf += delta.content
                        yield _sse("token", {"text": delta.content})

                    if delta.tool_calls:
                        for tc in delta.tool_calls:
                            while len(tool_calls) <= (tc.index or 0):
                                tool_calls.append(
                                    {
                                        "id": "",
                                        "type": "function",
                                        "function": {"name": "", "arguments": ""},
                                    }
                                )
                            slot = tool_calls[tc.index or 0]
                            if tc.id:
                                slot["id"] = tc.id
                            if tc.function:
                                if tc.function.name:
                                    slot["function"]["name"] += tc.function.name
                                if tc.function.arguments:
                                    slot["function"]["arguments"] += tc.function.arguments

                if finish_reason == "tool_calls" and tool_calls:
                    messages.append(
                        {
                            "role": "assistant",
                            "content": content_buf or None,
                            "tool_calls": tool_calls,
                        }
                    )
                    for tc in tool_calls:
                        fn_name = tc["function"]["name"]
                        try:
                            fn_args = json.loads(tc["function"]["arguments"] or "{}")
                        except Exception:  # noqa: BLE001
                            fn_args = {}
                        yield _sse("tool_start", {"name": fn_name, "args": fn_args})
                        result = await execute_tool(fn_name, fn_args, user_id)
                        # Pra HITL, devolve `action_summary` cru no payload SSE
                        # alem do preview truncado — UI usa o campo dedicado
                        # pra renderizar o banner sem depender de parsear o
                        # preview (que pode estar truncado por _short).
                        event_payload: dict[str, Any] = {
                            "name": fn_name,
                            "preview": _short(result),
                        }
                        if fn_name == "request_user_confirmation" and isinstance(result, dict):
                            summary = result.get("action_summary")
                            if isinstance(summary, str) and summary:
                                event_payload["action_summary"] = summary
                        yield _sse("tool_end", event_payload)
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tc["id"],
                                "content": json.dumps(result, default=str, ensure_ascii=False),
                            }
                        )
                    continue

                if content_buf and not tool_calls:
                    messages.append({"role": "assistant", "content": content_buf})
                break

            try:
                await db.insert_cost_event(
                    user_id=user_id,
                    model=model,
                    tokens_in=total_in,
                    tokens_out=total_out,
                    cost_usd=total_cost,
                    meta={
                        "loops": loops,
                        "conversation_id": conversation_id,
                        "thinking": thinking,
                    },
                )
            except Exception:  # noqa: BLE001
                log.exception("cost-event-failed")

            yield _sse("done", {"tokens_in": total_in, "tokens_out": total_out, "loops": loops})
        except Exception as e:  # noqa: BLE001
            log.exception("chat-error")
            yield _sse("error", {"message": str(e)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


# ----------------------------------------------------------------------------
# Voice transcription (mic → texto)
# ----------------------------------------------------------------------------


@app.post("/voice-transcribe")
async def voice_transcribe(
    request: Request,
    x_voxen_user_id: str | None = Header(default=None, alias="X-Voxen-User-Id"),
    x_voxen_audio_name: str = Header(default="voice.webm", alias="X-Voxen-Audio-Name"),
) -> JSONResponse:
    if not x_voxen_user_id:
        raise HTTPException(status_code=401, detail="Header X-Voxen-User-Id ausente.")

    api_key = await voxen_settings.get_openrouter_api_key()
    if not api_key:
        raise HTTPException(status_code=412, detail="Setup incompleto — chave OpenRouter ausente.")
    model = await voxen_settings.get_default_transcription_model()
    if not model:
        raise HTTPException(
            status_code=412, detail="Setup incompleto — modelo de transcrição ausente."
        )

    audio_bytes = await request.body()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Áudio vazio.")
    mime = request.headers.get("content-type", "audio/webm")

    async with httpx.AsyncClient(timeout=60.0) as client:
        files = {"file": (x_voxen_audio_name, audio_bytes, mime)}
        data = {"model": model, "response_format": "json"}
        res = await client.post(
            f"{OR_BASE_URL}/audio/transcriptions",
            headers={"Authorization": f"Bearer {api_key}"},
            data=data,
            files=files,
        )

    if res.status_code in (401, 403):
        raise HTTPException(status_code=412, detail="Chave OpenRouter rejeitada.")
    if res.status_code >= 400:
        log.warning("voice-transcribe-failed", status=res.status_code, body=res.text[:200])
        raise HTTPException(status_code=502, detail=f"OpenRouter retornou {res.status_code}.")
    payload = res.json()
    text = (payload.get("text") or "").strip()

    # Limitação conhecida: /audio/transcriptions do OpenRouter não devolve
    # `usage.cost` (a flag usage.include só funciona em /chat/completions).
    # Cost fica 0 aqui — custo real é refletido no painel da OR.
    try:
        await db.insert_cost_event(
            user_id=x_voxen_user_id,
            model=model,
            tokens_in=0,
            tokens_out=0,
            cost_usd=Decimal("0"),
            kind="TRANSCRIBE",
            meta={"source": "chat_voice"},
        )
    except Exception:  # noqa: BLE001
        log.exception("voice-cost-event-failed")

    return JSONResponse({"text": text})


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


class SummarizeRequest(BaseModel):
    transcript_id: str
    title: str
    plain_text: str


@app.post("/summarize-transcript")
async def summarize_transcript(
    body: SummarizeRequest,
    x_voxen_user_id: str | None = Header(default=None, alias="X-Voxen-User-Id"),
) -> JSONResponse:
    if not x_voxen_user_id:
        raise HTTPException(status_code=401, detail="Header X-Voxen-User-Id ausente.")
    api_key = await voxen_settings.get_openrouter_api_key()
    if not api_key:
        raise HTTPException(status_code=412, detail="Setup incompleto — chave OpenRouter ausente.")
    model = await voxen_settings.get_default_chat_model()
    if not model:
        raise HTTPException(status_code=412, detail="Setup incompleto — modelo de chat ausente.")

    text = body.plain_text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Texto vazio.")
    if len(text) > 60_000:
        text = text[:60_000] + "\n\n[…transcrição truncada para resumo…]"

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SUMMARIZE_PROMPT},
            {
                "role": "user",
                "content": f"Título do vídeo: {body.title}\n\nTranscrição:\n\n{text}",
            },
        ],
        "stream": False,
        # OpenRouter retorna usage.cost (USD) só quando solicitamos via
        # usage.include=true. Sem isso o painel mostra $0,00 mesmo gastando.
        "usage": {"include": True},
    }
    timeout = await voxen_settings.get_summary_timeout_sec()
    async with httpx.AsyncClient(timeout=timeout) as client:
        res = await client.post(
            f"{OR_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json=payload,
        )
    if res.status_code >= 400:
        log.warning("summarize-failed", status=res.status_code, body=res.text[:200])
        raise HTTPException(status_code=502, detail=f"OpenRouter {res.status_code}.")

    data = res.json()
    summary = ((data.get("choices") or [{}])[0].get("message", {}).get("content") or "").strip()
    usage = data.get("usage") or {}
    tokens_in = int(usage.get("prompt_tokens") or 0)
    tokens_out = int(usage.get("completion_tokens") or 0)
    cost_raw = usage.get("cost")
    try:
        cost_usd = Decimal(str(cost_raw)) if cost_raw is not None else Decimal("0")
    except (ValueError, ArithmeticError):
        cost_usd = Decimal("0")

    if summary:
        try:
            async with db.connection() as conn:
                await conn.execute(
                    'UPDATE "Transcript" SET "summaryMd" = $2, "updatedAt" = NOW() '
                    'WHERE id = $1 AND "userId" = $3',
                    body.transcript_id,
                    summary,
                    x_voxen_user_id,
                )
        except Exception:  # noqa: BLE001
            log.exception("summary-persist-failed")
        try:
            await db.insert_cost_event(
                user_id=x_voxen_user_id,
                model=model,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                cost_usd=cost_usd,
                meta={"source": "transcript_summary", "transcript_id": body.transcript_id},
            )
        except Exception:  # noqa: BLE001
            log.exception("summary-cost-event-failed")

    return JSONResponse({"summary_md": summary})


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _short(obj: Any) -> str:
    s = json.dumps(obj, ensure_ascii=False, default=str)
    return s if len(s) < 200 else s[:200] + "…"
