"""Testes para src/compaction.py — funções de orquestração.

Cobre _extract_text + early returns + paths de erro do
maybe_compact_messages com AsyncOpenAI mockado.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.compaction import _extract_text, maybe_compact_messages

# ---------------------------------------------------------------------------
# _extract_text
# ---------------------------------------------------------------------------


def test_extract_text_string() -> None:
    assert _extract_text("hello world") == "hello world"


def test_extract_text_multimodal_text_only() -> None:
    content = [
        {"type": "text", "text": "part 1"},
        {"type": "text", "text": "part 2"},
    ]
    assert _extract_text(content) == "part 1\npart 2"


def test_extract_text_multimodal_with_image() -> None:
    content = [
        {"type": "text", "text": "hi"},
        {"type": "image_url", "image_url": {"url": "data:..."}},
    ]
    assert _extract_text(content) == "hi\n[imagem]"


def test_extract_text_falls_back_to_str() -> None:
    assert _extract_text(123) == "123"  # type: ignore[arg-type]
    assert _extract_text(None) == "None"  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# maybe_compact_messages — early returns
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_below_threshold_returns_none() -> None:
    # 1 mensagem curta → muito abaixo de 70% de 32k (DEFAULT_LIMIT)
    msgs: list[dict[str, Any]] = [{"role": "user", "content": "oi"}]
    out, info = await maybe_compact_messages(
        api_key="sk-test",
        model="fake/model",
        user_id="u1",
        conversation_id="c1",
        messages=msgs,
    )
    assert out == msgs
    assert info is None


@pytest.mark.asyncio
async def test_above_threshold_no_conversation_id_returns_error_info() -> None:
    # Constrói mensagem grande pra acionar threshold
    big = "x" * 200_000  # ~50k tokens
    msgs = [{"role": "user", "content": big}]
    out, info = await maybe_compact_messages(
        api_key="sk-test",
        model="fake/model",  # DEFAULT_LIMIT=32000, 70% = 22400
        user_id="u1",
        conversation_id=None,
        messages=msgs,
    )
    assert out == msgs
    assert info is not None
    assert info["triggered"] is False
    assert "conversa" in info["error"].lower()


@pytest.mark.asyncio
async def test_above_threshold_too_few_messages_returns_error_info() -> None:
    # Tokens altos mas só 3 mensagens (<= K_KEEP_RECENT=6) → skipa
    big = "x" * 200_000
    msgs: list[dict[str, Any]] = [
        {"role": "system", "content": "system prompt"},
        {"role": "user", "content": big},
        {"role": "assistant", "content": "resp"},
    ]
    out, info = await maybe_compact_messages(
        api_key="sk-test",
        model="fake/model",
        user_id="u1",
        conversation_id="c1",
        messages=msgs,
    )
    assert out == msgs
    assert info is not None
    assert info["triggered"] is False
    assert "curta" in info["error"].lower()


# ---------------------------------------------------------------------------
# maybe_compact_messages — paths de erro do modelo
# ---------------------------------------------------------------------------


def _build_long_conv(n: int = 12) -> list[dict[str, Any]]:
    """Constrói conversa com `n` mensagens (alternando user/assistant), cada
    uma com ~10k caracteres → garante que tokens excedem o threshold do
    fake/model (DEFAULT_LIMIT 32k, 70% = 22.4k)."""
    big = "x" * 10_000
    out: list[dict[str, Any]] = [{"role": "system", "content": "system prompt"}]
    for i in range(n):
        out.append({"role": "user" if i % 2 == 0 else "assistant", "content": big})
    return out


@pytest.mark.asyncio
async def test_openai_call_failure_returns_error_info() -> None:
    msgs = _build_long_conv()
    fake_client = MagicMock()
    fake_client.chat.completions.create = AsyncMock(side_effect=RuntimeError("network error"))

    with patch("src.compaction.AsyncOpenAI", return_value=fake_client):
        out, info = await maybe_compact_messages(
            api_key="sk-test",
            model="fake/model",
            user_id="u1",
            conversation_id="c1",
            messages=msgs,
        )
    assert out == msgs
    assert info is not None
    assert info["triggered"] is False
    assert "modelo" in info["error"].lower()


@pytest.mark.asyncio
async def test_empty_summary_returns_error_info() -> None:
    msgs = _build_long_conv()
    fake_resp = MagicMock()
    fake_resp.choices = [MagicMock(message=MagicMock(content=""))]
    fake_resp.usage = None
    fake_client = MagicMock()
    fake_client.chat.completions.create = AsyncMock(return_value=fake_resp)

    with patch("src.compaction.AsyncOpenAI", return_value=fake_client):
        out, info = await maybe_compact_messages(
            api_key="sk-test",
            model="fake/model",
            user_id="u1",
            conversation_id="c1",
            messages=msgs,
        )
    assert out == msgs
    assert info is not None
    assert info["triggered"] is False
    assert "vazio" in info["error"].lower()


@pytest.mark.asyncio
async def test_persist_failure_returns_error_info() -> None:
    msgs = _build_long_conv()
    fake_resp = MagicMock()
    fake_resp.choices = [MagicMock(message=MagicMock(content="resumo detalhado"))]
    fake_resp.usage = MagicMock(prompt_tokens=10, completion_tokens=20, cost=0.001)
    fake_client = MagicMock()
    fake_client.chat.completions.create = AsyncMock(return_value=fake_resp)

    with (
        patch("src.compaction.AsyncOpenAI", return_value=fake_client),
        patch(
            "src.compaction._persist_compaction",
            new=AsyncMock(side_effect=RuntimeError("db down")),
        ),
    ):
        out, info = await maybe_compact_messages(
            api_key="sk-test",
            model="fake/model",
            user_id="u1",
            conversation_id="c1",
            messages=msgs,
        )
    assert out == msgs
    assert info is not None
    assert info["triggered"] is False
    assert "persistir" in info["error"].lower()


# ---------------------------------------------------------------------------
# maybe_compact_messages — caminho feliz
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_happy_path_returns_compacted_messages() -> None:
    msgs = _build_long_conv(n=12)
    summary = "## Resumo\n- ponto 1\n- ponto 2"
    fake_resp = MagicMock()
    fake_resp.choices = [MagicMock(message=MagicMock(content=summary))]
    fake_resp.usage = MagicMock(prompt_tokens=100, completion_tokens=50, cost=0.0025)
    fake_client = MagicMock()
    fake_client.chat.completions.create = AsyncMock(return_value=fake_resp)

    with (
        patch("src.compaction.AsyncOpenAI", return_value=fake_client),
        patch("src.compaction._persist_compaction", new=AsyncMock(return_value=None)),
        patch("src.compaction.db.insert_cost_event", new=AsyncMock(return_value=None)),
    ):
        out, info = await maybe_compact_messages(
            api_key="sk-test",
            model="fake/model",
            user_id="u1",
            conversation_id="c1",
            messages=msgs,
        )

    assert info is not None
    assert info["triggered"] is True
    assert info["summary"] == summary
    assert info["tokens_after"] < info["tokens_before"]
    # out = [system_prompt original, summary_msg, ...K_KEEP_RECENT recentes]
    # K_KEEP_RECENT=6 + system + summary = 8
    assert len(out) == 8
    assert out[0]["role"] == "system"  # system prompt original
    assert out[1]["role"] == "system"  # summary
    assert "Resumo de mensagens anteriores" in out[1]["content"]
    # Custo deve ser string serializável (Decimal → str)
    assert isinstance(info["cost_usd"], str)
