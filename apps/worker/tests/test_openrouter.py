from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

import httpx

from src.openrouter import (
    _resolve_folder_decision,
    _resolve_title_decision,
    analyze_x_url,
    classify_content_folder,
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
    assert "Responda apenas com KEEP" in str(client.payload["messages"])


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


async def test_generate_content_title_ptbr_prompt_forces_translation() -> None:
    # Título de origem bom, mas em inglês: o prompt PT-BR deve pedir tradução
    # (KEEP só se já estiver em português), não manter o inglês.
    client = CaptureClient()

    result = await generate_content_title(
        content="Deep dive into the final arc of the anime and Eren's fate.",
        source_label="Vídeo YOUTUBE",
        fallback_title="Attack on Titan — Final Explained",
        api_key="sk-test",
        model="openai/gpt-4.1-mini",
        language="pt-BR",
        client=client,  # type: ignore[arg-type]
    )

    msgs = str(client.payload["messages"])
    assert "português do Brasil" in msgs
    assert "TRADUZIR" in msgs
    assert "já estiver em português do Brasil" in msgs
    # O modelo retornou um título novo (não KEEP) → é usado.
    assert result.title == "Resumo do post"


def test_resolve_title_decision_keep_variants() -> None:
    assert _resolve_title_decision("KEEP", "Título Bom do Canal") == "Título Bom do Canal"
    assert _resolve_title_decision("manter", "Título Bom do Canal") == "Título Bom do Canal"
    assert (
        _resolve_title_decision("Título Bom do Canal", "Título Bom do Canal")
        == "Título Bom do Canal"
    )
    assert (
        _resolve_title_decision("Novo título editorial", "arquivo.mp4") == "Novo título editorial"
    )


def test_resolve_folder_decision_reuses_existing_and_none() -> None:
    existing = ["Anime", "Produtividade", "Machine Learning", "IA"]
    assert _resolve_folder_decision("NONE", existing) is None
    assert _resolve_folder_decision("anime", existing) == "Anime"
    assert _resolve_folder_decision("História do Brasil", existing) == "História do Brasil"
    # Não colidir substring curta ("ia" em "história")
    assert _resolve_folder_decision("História do Brasil", ["IA"]) == "História do Brasil"


def test_resolve_folder_decision_strips_meta_and_rejects_garbage() -> None:
    assert _resolve_folder_decision("The content is about Alibaba Cloud", []) == "Alibaba Cloud"
    assert _resolve_folder_decision('{"folder":"HyperDX"}', []) == "HyperDX"
    assert _resolve_folder_decision("The content is about HyperDX, an", []) == "HyperDX"
    assert (
        _resolve_folder_decision("The content is about an Elden Ring game", []) == "Elden Ring game"
    )
    assert _resolve_folder_decision("The content is about using Claude Code", []) == "Claude Code"
    assert _resolve_folder_decision('The content is about "Loop Engineer"', []) == "Loop Engineer"
    assert _resolve_folder_decision('The content is about "Observe", a', []) == "Observe"
    assert _resolve_folder_decision("The user wants me to categorize the", []) is None
    assert _resolve_folder_decision("The user wants me to categorize", []) is None
    assert _resolve_folder_decision("The user is asking me to categorize", []) is None
    assert _resolve_folder_decision("The user is explaining why they stopped", []) is None
    assert _resolve_folder_decision("The content is about a library called", []) is None
    assert _resolve_folder_decision("The content is about a tool called", []) is None
    assert _resolve_folder_decision("The content is about an open-source", []) is None
    assert _resolve_folder_decision("The content is about a shift from", []) is None
    assert _resolve_folder_decision("The content is about UX engineering for", []) is None


async def test_classify_content_folder_payload() -> None:
    client = FolderClient()
    result = await classify_content_folder(
        title="Análise do final de Attack on Titan",
        content="Discussão sobre o mangá e o anime, Eren e Mikasa.",
        existing_folders=["Anime", "Produtividade"],
        api_key="sk-test",
        model="openai/gpt-4.1-mini",
        client=client,  # type: ignore[arg-type]
    )
    assert result.folder_name == "Anime"
    assert client.payload is not None
    messages = str(client.payload["messages"])
    assert "folder" in messages.lower() or "Folder" in messages or "pasta" in messages.lower()


class FolderClient:
    def __init__(self) -> None:
        self.payload: dict[str, Any] | None = None

    async def post(
        self,
        url: str,
        *,
        headers: dict[str, str],
        json: dict[str, Any],
    ) -> httpx.Response:
        self.payload = json
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": '{"folder":"Anime"}'}}],
                "usage": {
                    "cost": "0.001",
                    "prompt_tokens": 30,
                    "completion_tokens": 2,
                },
            },
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
