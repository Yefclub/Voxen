"""Shared OpenRouter transport policy for retries, errors, and audio routing."""

from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from email.utils import parsedate_to_datetime
from pathlib import Path

import httpx

OR_BASE_URL = "https://openrouter.ai/api/v1"


class OpenrouterAuthError(Exception):
    """401/403 da OpenRouter — admin precisa revalidar a key."""


class OpenrouterTransientError(Exception):
    """Erro temporário da OpenRouter que aceita nova tentativa."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        retry_after: float | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.retry_after = retry_after


def unexpected_response_error(status_code: int) -> RuntimeError:
    """Cria erro acionável sem propagar o corpo não confiável do provedor."""
    return RuntimeError(f"OpenRouter retornou uma resposta inesperada (HTTP {status_code}).")


def retry_after_seconds(value: str | None, *, now: datetime | None = None) -> float | None:
    if not value:
        return None
    try:
        delay = float(value)
    except ValueError:
        try:
            target = parsedate_to_datetime(value)
            if target.tzinfo is None:
                target = target.replace(tzinfo=UTC)
            delay = (target - (now or datetime.now(UTC))).total_seconds()
        except (TypeError, ValueError, OverflowError):
            return None
    return delay if 0 < delay <= 60 else None


def raise_for_openrouter_status(response: httpx.Response) -> None:
    if response.is_success:
        return
    status = response.status_code
    if status in (401, 403):
        raise OpenrouterAuthError(f"OpenRouter rejeitou a key (HTTP {status})")
    if status in (408, 429) or 500 <= status < 600:
        raise OpenrouterTransientError(
            f"OpenRouter temporariamente indisponível (HTTP {status}).",
            status_code=status,
            retry_after=retry_after_seconds(response.headers.get("Retry-After")),
        )
    raise unexpected_response_error(status)


def payload_with_fallback(
    payload: dict[str, object], fallback_model: str | None
) -> dict[str, object]:
    primary = payload.get("model")
    if not fallback_model or fallback_model == primary:
        return payload
    return {**payload, "models": [fallback_model]}


@dataclass(frozen=True)
class TranscriptionResult:
    text: str
    cost_usd: Decimal
    model: str


async def transcribe_audio(
    *,
    audio_path: Path,
    api_key: str,
    model: str,
    fallback_model: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> TranscriptionResult:
    """Transcreve áudio, tentando a alternativa somente em falha temporária."""
    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient(timeout=180.0)
    try:
        audio_format = audio_path.suffix.lower().lstrip(".") or "ogg"
        if audio_format == "oga":
            audio_format = "ogg"
        encoded_audio = base64.b64encode(audio_path.read_bytes()).decode("ascii")
        candidates = [model]
        if fallback_model and fallback_model != model:
            candidates.append(fallback_model)
        response: httpx.Response | None = None
        selected_model = model
        last_transient: OpenrouterTransientError | None = None
        for candidate in candidates:
            selected_model = candidate
            try:
                response = await client.post(
                    f"{OR_BASE_URL}/audio/transcriptions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "model": candidate,
                        "input_audio": {"data": encoded_audio, "format": audio_format},
                        "response_format": "json",
                    },
                )
                raise_for_openrouter_status(response)
                break
            except (httpx.TimeoutException, httpx.NetworkError, httpx.ProtocolError) as exc:
                last_transient = OpenrouterTransientError("Rede/timeout da OpenRouter.")
                if candidate == candidates[-1]:
                    raise last_transient from exc
            except OpenrouterTransientError as exc:
                last_transient = exc
                if candidate == candidates[-1]:
                    raise
                if exc.retry_after is not None:
                    await asyncio.sleep(exc.retry_after)
        if response is None or not response.is_success:
            assert last_transient is not None
            raise last_transient
        body = response.json()
        usage = body.get("usage", {})
        cost_value = usage.get("cost") or usage.get("total_cost") or "0"
        try:
            cost = Decimal(str(cost_value))
        except (ValueError, ArithmeticError):
            cost = Decimal("0")
        return TranscriptionResult(
            text=body.get("text", ""),
            cost_usd=cost,
            model=str(body.get("model") or selected_model),
        )
    finally:
        if owns_client:
            await client.aclose()
