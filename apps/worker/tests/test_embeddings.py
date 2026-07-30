from __future__ import annotations

from typing import Any

import httpx
import pytest

from src import openrouter
from src.embeddings import embed_text


class _ExternalErrorClient:
    async def post(
        self,
        url: str,
        *,
        headers: dict[str, str],
        json: dict[str, Any],
    ) -> httpx.Response:
        return httpx.Response(
            401,
            text="Bearer body-secret sk-or-v1-secret socks5h://user:pass@127.0.0.1:1080",
        )


async def test_embedding_does_not_propagate_upstream_body() -> None:
    with pytest.raises(openrouter.OpenrouterAuthError) as raised:
        await embed_text(
            text="Conteúdo suficiente para solicitar um embedding remoto.",
            api_key="sk-test",
            client=_ExternalErrorClient(),  # type: ignore[arg-type]
        )

    assert str(raised.value) == "OpenRouter rejeitou a chave (HTTP 401)."
    assert "body-secret" not in str(raised.value)
