from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

import httpx

from src.openrouter import (
    _resolve_title_decision,
    analyze_x_url,
    generate_content_title,
    transcribe_audio,
)


class CaptureClient:
    def __init__(self) -> None:
        self.payload: dict[str, Any] | None = None
        self.url: str | None = None

    async def post(
        self,
        url: str,
        *,
        headers: dict[str, str],
        json: dict[str, Any],
    ) -> httpx.Response:
        assert headers["Authorization"] == "Bearer sk-test"
        self.url = url
        self.payload = json
        if url.endswith("/audio/transcriptions"):
            return httpx.Response(
                200,
                json={
                    "text": "Transcrição do áudio",
                    "usage": {
                        "cost": "0.002",
                    },
                },
            )
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "Resumo do post"}}],
                "usage": {
                    "cost": "0.001",
                    "prompt_tokens": 12,
                    "completion_tokens": 8,
                },
            },
        )


async def test_analyze_x_url_uses_native_x_search_with_media_understanding() -> None:
    client = CaptureClient()

    result = await analyze_x_url(
        url="https://x.com/i/status/1234567890",
        api_key="sk-test",
        model="x-ai/grok-4-fast",
        client=client,  # type: ignore[arg-type]
    )

    assert result.text == "Resumo do post"
    assert client.payload is not None
    assert client.payload["plugins"] == [{"id": "web", "engine": "native"}]
    assert client.payload["x_search_filter"] == {
        "enable_image_understanding": True,
        "enable_video_understanding": True,
    }


async def test_generate_content_title_uses_short_title_payload() -> None:
    client = CaptureClient()

    result = await generate_content_title(
        content="Conteúdo longo sobre estratégia de produto, métricas e roadmap.",
        source_label="Página web",
        fallback_title="arquivo-generico",
        api_key="sk-test",
        model="openai/gpt-4.1-mini",
        client=client,  # type: ignore[arg-type]
    )

    assert result.title == "Resumo do post"
    assert client.payload is not None
    assert client.payload["max_tokens"] == 48
    assert client.payload["temperature"] == 0.2
    assert "KEEP" in str(client.payload["messages"])
    assert "Responda apenas com KEEP ou com o título final." in str(client.payload["messages"])


async def test_generate_content_title_keeps_candidate_when_model_says_keep() -> None:
    client = KeepTitleClient()

    result = await generate_content_title(
        content="Episódio completo sobre o arco de Shingeki no Kyojin e o destino de Eren.",
        source_label="Vídeo YOUTUBE",
        fallback_title="Attack on Titan — Análise do final (sem spoilers leves)",
        api_key="sk-test",
        model="openai/gpt-4.1-mini",
        client=client,  # type: ignore[arg-type]
    )

    assert result.title == "Attack on Titan — Análise do final (sem spoilers leves)"


def test_resolve_title_decision_keep_variants() -> None:
    assert _resolve_title_decision("KEEP", "Título Bom do Canal") == "Título Bom do Canal"
    assert _resolve_title_decision("manter", "Título Bom do Canal") == "Título Bom do Canal"
    assert (
        _resolve_title_decision("Título Bom do Canal", "Título Bom do Canal")
        == "Título Bom do Canal"
    )
    assert (
        _resolve_title_decision("Novo título editorial", "arquivo.mp4")
        == "Novo título editorial"
    )


class KeepTitleClient:
    async def post(
        self,
        url: str,
        *,
        headers: dict[str, str],
        json: dict[str, Any],
    ) -> httpx.Response:
        assert headers["Authorization"] == "Bearer sk-test"
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "KEEP"}}],
                "usage": {
                    "cost": "0.001",
                    "prompt_tokens": 20,
                    "completion_tokens": 1,
                },
            },
        )


async def test_transcribe_audio_uses_openrouter_json_base64_payload(tmp_path: Path) -> None:
    audio_path = tmp_path / "chunk.ogg"
    audio_path.write_bytes(b"fake-audio")
    client = CaptureClient()

    result = await transcribe_audio(
        audio_path=audio_path,
        api_key="sk-test",
        model="openai/whisper-large-v3",
        client=client,  # type: ignore[arg-type]
    )

    assert result.text == "Transcrição do áudio"
    assert client.url is not None
    assert client.url.endswith("/audio/transcriptions")
    assert client.payload == {
        "model": "openai/whisper-large-v3",
        "input_audio": {
            "data": base64.b64encode(b"fake-audio").decode("ascii"),
            "format": "ogg",
        },
        "response_format": "json",
    }
