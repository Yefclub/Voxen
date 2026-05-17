"""Voxen Chat — FastAPI + tool-calling loop sobre OpenRouter."""

from __future__ import annotations

import json
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
from .tools import TOOLS_SPEC, execute_tool

log = structlog.get_logger(__name__)
app = FastAPI(title="Voxen Chat", version="1.0.0")

MAX_TOOL_LOOPS = 5
OR_BASE_URL = "https://openrouter.ai/api/v1"

SYSTEM_PROMPT = """Você é o assistente do Voxen, uma biblioteca de vídeos transcritos.

REGRAS DE TRABALHO:
- Você responde EXCLUSIVAMENTE com base nas tools disponíveis. Nunca invente conteúdo.
- Sempre faça uma busca antes de citar conteúdo. Use `search_transcripts`
  com palavras-chave em português, sem operadores.
- Quando o usuário pedir um resumo, use `read_transcript_summary` primeiro;
  só leia o markdown completo via `read_transcript` se o resumo for insuficiente.
- Cite fontes incluindo o id da transcrição e o timestamp (se aplicável).
- Use markdown na resposta: títulos curtos, listas, ênfase. Sem HTML.
- Quando citar um trecho, use a forma `[mm:ss](id) texto` para a UI conseguir
  linkar diretamente para o minuto do vídeo.
- Responda em português brasileiro, de forma direta e útil.
- Se a biblioteca está vazia, diga isso e sugira o usuário transcrever um vídeo primeiro.
"""


@app.get("/health")
async def health() -> dict[str, object]:
    return {"ok": True, "service": "chat"}


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    thinking: bool = False


@app.post("/chat")
async def chat(
    body: ChatRequest,
    request: Request,
    x_voxen_user_id: str | None = Header(default=None, alias="X-Voxen-User-Id"),
    x_voxen_conversation_id: str | None = Header(
        default=None, alias="X-Voxen-Conversation-Id"
    ),
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

    async def event_stream() -> AsyncIterator[str]:
        client = AsyncOpenAI(
            api_key=api_key,
            base_url=OR_BASE_URL,
        )
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            *[{"role": m.role, "content": m.content} for m in body.messages],
        ]
        extra: dict[str, Any] = {}
        if thinking:
            extra["reasoning"] = {"effort": "medium"}

        total_in = 0
        total_out = 0
        loops = 0

        try:
            while loops < MAX_TOOL_LOOPS:
                loops += 1
                if await request.is_disconnected():
                    return

                kwargs: dict[str, Any] = dict(
                    model=model,
                    messages=messages,
                    tools=TOOLS_SPEC,
                    stream=True,
                    stream_options={"include_usage": True},
                )
                if extra:
                    kwargs["extra_body"] = extra

                stream = await client.chat.completions.create(**kwargs)  # type: ignore[call-overload]

                content_buf = ""
                tool_calls: list[dict[str, Any]] = []
                finish_reason: str | None = None

                async for chunk in stream:
                    if not chunk.choices:
                        if chunk.usage:
                            total_in += chunk.usage.prompt_tokens or 0
                            total_out += chunk.usage.completion_tokens or 0
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
                        yield _sse("tool_end", {"name": fn_name, "preview": _short(result)})
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
                    cost_usd=Decimal("0"),
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
    x_voxen_audio_name: str = Header(
        default="voice.webm", alias="X-Voxen-Audio-Name"
    ),
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
        raise HTTPException(
            status_code=502, detail=f"OpenRouter retornou {res.status_code}."
        )
    payload = res.json()
    text = (payload.get("text") or "").strip()

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


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _short(obj: Any) -> str:
    s = json.dumps(obj, ensure_ascii=False, default=str)
    return s if len(s) < 200 else s[:200] + "…"
