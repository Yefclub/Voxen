"""Testes dos endpoints de transcrição de voz e resumo (#38)."""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from src import main


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict[str, Any], text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self) -> dict[str, Any]:
        return self._payload


class _FakeAsyncClient:
    response: _FakeResponse
    seen: dict[str, Any] = {}

    def __init__(self, **kwargs: Any) -> None:
        self.seen["timeout"] = kwargs.get("timeout")

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, *_exc: object) -> bool:
        return False

    async def post(self, url: str, **kwargs: Any) -> _FakeResponse:
        self.seen["url"] = url
        self.seen["kwargs"] = kwargs
        return self.response


def _install_fake_client(monkeypatch: pytest.MonkeyPatch, response: _FakeResponse) -> None:
    _FakeAsyncClient.response = response
    _FakeAsyncClient.seen = {}
    monkeypatch.setattr(main.httpx, "AsyncClient", _FakeAsyncClient)


def test_voice_transcribe_posts_audio_to_openrouter(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_fake_client(monkeypatch, _FakeResponse(200, {"text": "  Olá mundo  "}))
    monkeypatch.setattr(main.voxen_settings, "get_openrouter_api_key", AsyncMock(return_value="sk"))
    monkeypatch.setattr(
        main.voxen_settings,
        "get_default_transcription_model",
        AsyncMock(return_value="openai/whisper-large-v3"),
    )
    insert_cost = AsyncMock()
    monkeypatch.setattr(main.db, "insert_cost_event", insert_cost)

    client = TestClient(main.app)
    response = client.post(
        "/voice-transcribe",
        headers={
            "X-Voxen-User-Id": "u1",
            "X-Voxen-Audio-Name": "voz.webm",
            "Content-Type": "audio/webm",
        },
        content=b"audio-bytes",
    )

    assert response.status_code == 200
    assert response.json() == {"text": "Olá mundo"}
    assert _FakeAsyncClient.seen["timeout"] == 60.0
    kwargs = _FakeAsyncClient.seen["kwargs"]
    assert kwargs["data"]["model"] == "openai/whisper-large-v3"
    assert kwargs["files"]["file"][0] == "voz.webm"
    insert_cost.assert_awaited_once_with(
        user_id="u1",
        model="openai/whisper-large-v3",
        tokens_in=0,
        tokens_out=0,
        cost_usd=Decimal("0"),
        kind="TRANSCRIBE",
        meta={"source": "chat_voice"},
    )


def test_voice_transcribe_rejects_empty_audio(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main.voxen_settings, "get_openrouter_api_key", AsyncMock(return_value="sk"))
    monkeypatch.setattr(
        main.voxen_settings,
        "get_default_transcription_model",
        AsyncMock(return_value="openai/whisper-large-v3"),
    )

    client = TestClient(main.app)
    response = client.post("/voice-transcribe", headers={"X-Voxen-User-Id": "u1"}, content=b"")

    assert response.status_code == 400
    assert "Áudio vazio" in response.text


def test_summarize_transcript_persists_summary_and_cost(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_client(
        monkeypatch,
        _FakeResponse(
            200,
            {
                "choices": [{"message": {"content": "## TL;DR\nResumo"}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5, "cost": "0.0012"},
            },
        ),
    )
    monkeypatch.setattr(main.voxen_settings, "get_openrouter_api_key", AsyncMock(return_value="sk"))
    monkeypatch.setattr(
        main.voxen_settings,
        "get_default_chat_model",
        AsyncMock(return_value="openai/gpt-4o-mini"),
    )
    monkeypatch.setattr(
        main.voxen_settings,
        "get_summary_timeout_sec",
        AsyncMock(return_value=123.0),
    )
    fake_conn = MagicMock()
    fake_conn.execute = AsyncMock()
    fake_ctx = MagicMock()
    fake_ctx.__aenter__ = AsyncMock(return_value=fake_conn)
    fake_ctx.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(main.db, "connection", lambda: fake_ctx)
    insert_cost = AsyncMock()
    monkeypatch.setattr(main.db, "insert_cost_event", insert_cost)

    client = TestClient(main.app)
    response = client.post(
        "/summarize-transcript",
        headers={"X-Voxen-User-Id": "u1"},
        json={"transcript_id": "t1", "title": "Vídeo", "plain_text": "Texto da transcrição"},
    )

    assert response.status_code == 200
    assert response.json() == {"summary_md": "## TL;DR\nResumo"}
    assert _FakeAsyncClient.seen["timeout"] == 123.0
    fake_conn.execute.assert_awaited_once()
    insert_cost.assert_awaited_once_with(
        user_id="u1",
        model="openai/gpt-4o-mini",
        tokens_in=10,
        tokens_out=5,
        cost_usd=Decimal("0.0012"),
        meta={"source": "transcript_summary", "transcript_id": "t1"},
    )


def test_summarize_transcript_rejects_empty_text(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main.voxen_settings, "get_openrouter_api_key", AsyncMock(return_value="sk"))
    monkeypatch.setattr(
        main.voxen_settings,
        "get_default_chat_model",
        AsyncMock(return_value="openai/gpt-4o-mini"),
    )

    client = TestClient(main.app)
    response = client.post(
        "/summarize-transcript",
        headers={"X-Voxen-User-Id": "u1"},
        json={"transcript_id": "t1", "title": "Vídeo", "plain_text": "   "},
    )

    assert response.status_code == 422
    assert "Texto vazio" in response.text
