"""Cliente HTTP do OpenRouter — transcrição de áudio e análise visual."""

from __future__ import annotations

import base64
import mimetypes
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path

import httpx

OR_BASE_URL = "https://openrouter.ai/api/v1"


class OpenrouterAuthError(Exception):
    """401/403 da OpenRouter — admin precisa revalidar a key."""


class OpenrouterTransientError(Exception):
    """5xx / timeout / network — retry vale a pena."""


@dataclass(frozen=True)
class TranscriptionResult:
    text: str
    cost_usd: Decimal
    model: str


@dataclass(frozen=True)
class VisionAnalysisResult:
    text: str
    cost_usd: Decimal
    model: str
    tokens_in: int
    tokens_out: int


async def transcribe_audio(
    *,
    audio_path: Path,
    api_key: str,
    model: str,
    client: httpx.AsyncClient | None = None,
) -> TranscriptionResult:
    """Envia áudio pra OpenRouter `/audio/transcriptions` (compatível Whisper).

    Joga `OpenrouterAuthError` em 401/403 (permanente), `OpenrouterTransientError`
    em 5xx/timeout/rede (retry vale a pena), outros erros viram `RuntimeError`.
    """
    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient(timeout=120.0)
    try:
        with audio_path.open("rb") as fh:
            files = {"file": (audio_path.name, fh, "audio/ogg")}
            data = {"model": model, "response_format": "json"}
            try:
                res = await client.post(
                    f"{OR_BASE_URL}/audio/transcriptions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    data=data,
                    files=files,
                )
            except (httpx.TimeoutException, httpx.NetworkError) as e:
                raise OpenrouterTransientError(f"Rede/timeout: {e}") from e
        if res.status_code in (401, 403):
            raise OpenrouterAuthError(f"OpenRouter rejeitou a key (HTTP {res.status_code})")
        if 500 <= res.status_code < 600:
            raise OpenrouterTransientError(f"OpenRouter {res.status_code}")
        if not res.is_success:
            raise RuntimeError(f"OpenRouter erro inesperado HTTP {res.status_code}: {res.text}")
        body = res.json()
        text = body.get("text", "")
        # OpenRouter ecoa custo em headers `x-ratelimit-...` ou no corpo `usage`.
        usage = body.get("usage", {})
        cost_str = usage.get("cost") or usage.get("total_cost") or "0"
        try:
            cost = Decimal(str(cost_str))
        except (ValueError, ArithmeticError):
            cost = Decimal("0")
        return TranscriptionResult(text=text, cost_usd=cost, model=model)
    finally:
        if owns_client:
            await client.aclose()


async def analyze_image(
    *,
    image_path: Path,
    api_key: str,
    model: str,
    prompt: str,
    client: httpx.AsyncClient | None = None,
) -> VisionAnalysisResult:
    """Analisa uma imagem via `/chat/completions` multimodal do OpenRouter."""
    mime = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
    if mime not in {"image/png", "image/jpeg", "image/webp", "image/gif"}:
        raise RuntimeError(f"Formato de imagem não suportado: {mime}")

    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient(timeout=120.0)
    try:
        data_url = f"data:{mime};base64,{base64.b64encode(image_path.read_bytes()).decode('ascii')}"
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Você analisa imagens para uma base de conhecimento pessoal. "
                        "Responda em português do Brasil, com descrição objetiva, "
                        "texto visível/OCR quando houver e pontos relevantes para busca futura."
                    ),
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                },
            ],
            "usage": {"include": True},
        }
        try:
            res = await client.post(
                f"{OR_BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json=payload,
            )
        except (httpx.TimeoutException, httpx.NetworkError) as e:
            raise OpenrouterTransientError(f"Rede/timeout: {e}") from e

        if res.status_code in (401, 403):
            raise OpenrouterAuthError(f"OpenRouter rejeitou a key (HTTP {res.status_code})")
        if 500 <= res.status_code < 600:
            raise OpenrouterTransientError(f"OpenRouter {res.status_code}")
        if not res.is_success:
            raise RuntimeError(f"OpenRouter erro inesperado HTTP {res.status_code}: {res.text}")

        body = res.json()
        choices = body.get("choices") or []
        message = (choices[0] if choices else {}).get("message") or {}
        content = message.get("content") or ""
        if isinstance(content, list):
            text = "\n".join(
                str(part.get("text") or "")
                for part in content
                if isinstance(part, dict) and part.get("type") == "text"
            )
        else:
            text = str(content)

        usage = body.get("usage") or {}
        cost_raw = usage.get("cost") or "0"
        try:
            cost = Decimal(str(cost_raw))
        except (ValueError, ArithmeticError):
            cost = Decimal("0")
        return VisionAnalysisResult(
            text=text.strip(),
            cost_usd=cost,
            model=model,
            tokens_in=int(usage.get("prompt_tokens") or 0),
            tokens_out=int(usage.get("completion_tokens") or 0),
        )
    finally:
        if owns_client:
            await client.aclose()
