from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

import httpx

from src.openrouter import analyze_x_url, transcribe_audio


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
