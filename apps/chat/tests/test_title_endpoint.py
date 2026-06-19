"""Testes do endpoint /title — título de conversa gerado por IA (#9)."""

from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from src import main


class _FakeOpenAI:
    """Stub do AsyncOpenAI: captura kwargs e devolve uma completion fixa."""

    response: Any = None
    seen: dict[str, Any] = {}

    def __init__(self, **kwargs: Any) -> None:
        _FakeOpenAI.seen["init"] = kwargs
        create = AsyncMock(return_value=_FakeOpenAI.response)

        async def _create(**call_kwargs: Any) -> Any:
            _FakeOpenAI.seen["create"] = call_kwargs
            return _FakeOpenAI.response

        create.side_effect = _create
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=create))


def _install(monkeypatch: pytest.MonkeyPatch, *, api_key: str, model: str) -> None:
    monkeypatch.setattr(
        main.voxen_settings, "get_openrouter_api_key", AsyncMock(return_value=api_key)
    )
    monkeypatch.setattr(
        main.voxen_settings, "get_default_chat_model", AsyncMock(return_value=model)
    )
    monkeypatch.setattr(main, "AsyncOpenAI", _FakeOpenAI)


def test_title_strips_quotes_and_registers_cost(monkeypatch: pytest.MonkeyPatch) -> None:
    _FakeOpenAI.seen = {}
    _FakeOpenAI.response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content='  "Resumo do vídeo"  '))],
        usage=SimpleNamespace(prompt_tokens=8, completion_tokens=4, cost="0.0001"),
    )
    _install(monkeypatch, api_key="sk", model="google/gemini-flash:online")
    insert_cost = AsyncMock()
    monkeypatch.setattr(main.db, "insert_cost_event", insert_cost)

    client = TestClient(main.app)
    response = client.post("/title", headers={"X-Voxen-User-Id": "u1"}, json={"message": "Oi Vox"})

    assert response.status_code == 200
    assert response.json() == {"title": "Resumo do vídeo"}
    # `:online` é removido antes da chamada (sufixo de 7 chars).
    assert _FakeOpenAI.seen["create"]["model"] == "google/gemini-flash"
    insert_cost.assert_awaited_once_with(
        user_id="u1",
        model="google/gemini-flash",
        tokens_in=8,
        tokens_out=4,
        cost_usd=Decimal("0.0001"),
        meta={"source": "title"},
    )


def test_title_empty_message_skips_model(monkeypatch: pytest.MonkeyPatch) -> None:
    _install(monkeypatch, api_key="sk", model="google/gemini-flash")
    insert_cost = AsyncMock()
    monkeypatch.setattr(main.db, "insert_cost_event", insert_cost)

    client = TestClient(main.app)
    response = client.post("/title", json={"message": "   "})

    assert response.status_code == 200
    assert response.json() == {"title": ""}
    insert_cost.assert_not_awaited()


def test_title_without_setup_returns_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    _install(monkeypatch, api_key="", model="")

    client = TestClient(main.app)
    response = client.post("/title", json={"message": "Oi Vox"})

    assert response.status_code == 200
    assert response.json() == {"title": ""}
