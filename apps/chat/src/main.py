"""Voxen Chat — FastAPI + tool-calling loop sobre OpenRouter."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from decimal import Decimal
from typing import Any

import structlog
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI
from pydantic import BaseModel

from . import db, voxen_settings
from .tools import TOOLS_SPEC, execute_tool

log = structlog.get_logger(__name__)
app = FastAPI(title="Voxen Chat", version="1.0.0")

MAX_TOOL_LOOPS = 5

SYSTEM_PROMPT = """Você é o assistente do Voxen, uma knowledge base de vídeos transcritos.

REGRAS DE TRABALHO:
- Você responde EXCLUSIVAMENTE com base nas tools disponíveis. Nunca invente conteúdo.
- Sempre faça uma busca antes de citar conteúdo. Use `search_transcripts`
  com palavras-chave em português, sem operadores.
- Cite fontes incluindo o id da transcrição e o timestamp (se aplicável).
- Quando precisar do contexto completo, use `read_transcript` ou `read_transcript_section`.
- Responda em português brasileiro, de forma direta e útil.
- Se o acervo está vazio, diga isso e sugira o usuário transcrever um vídeo primeiro.
"""


@app.get("/health")
async def health() -> dict[str, object]:
    return {"ok": True, "service": "chat"}


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


@app.post("/chat")
async def chat(
    body: ChatRequest,
    request: Request,
    x_voxen_user_id: str | None = Header(default=None, alias="X-Voxen-User-Id"),
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

    async def event_stream() -> AsyncIterator[str]:
        client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://openrouter.ai/api/v1",
        )
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            *[{"role": m.role, "content": m.content} for m in body.messages],
        ]
        total_in = 0
        total_out = 0
        loops = 0

        try:
            while loops < MAX_TOOL_LOOPS:
                loops += 1
                if await request.is_disconnected():
                    return

                stream = await client.chat.completions.create(  # type: ignore[call-overload]
                    model=model,
                    messages=messages,
                    tools=TOOLS_SPEC,
                    stream=True,
                    stream_options={"include_usage": True},
                )

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
                    meta={"loops": loops},
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


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _short(obj: Any) -> str:
    s = json.dumps(obj, ensure_ascii=False, default=str)
    return s if len(s) < 200 else s[:200] + "…"
