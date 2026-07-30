"""Testes puros do extrator grounded (spec 104)."""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from src import openrouter
from src.brain_extract import (
    extract_grounded_concepts,
    is_grounded,
    parse_grounded_payload,
    slugify_label,
)


def test_is_grounded_requires_substring() -> None:
    source = "O Docker facilita o deploy com containers isolados no servidor."
    assert is_grounded("Docker facilita o deploy", source)
    assert not is_grounded("Kubernetes orquestra pods", source)
    assert not is_grounded("curto", source)


def test_parse_keeps_only_grounded_items() -> None:
    source = (
        "LangExtract extrai entidades com trechos literais. "
        "O Voxen usa OpenRouter para o chat e a transcrição."
    )
    raw = """
    {
      "entities": [
        {
          "label": "LangExtract",
          "excerpt": "LangExtract extrai entidades com trechos literais",
          "confidence": 0.9
        },
        {
          "label": "Inventado",
          "excerpt": "texto que nao existe no fonte",
          "confidence": 0.9
        }
      ],
      "claims": [
        {
          "label": "Voxen usa OpenRouter",
          "excerpt": "O Voxen usa OpenRouter para o chat",
          "confidence": 0.8
        }
      ]
    }
    """
    items = parse_grounded_payload(raw, source)
    labels = {item.label for item in items}
    assert "LangExtract" in labels
    assert "Voxen usa OpenRouter" in labels
    assert "Inventado" not in labels


def test_slugify() -> None:
    assert slugify_label("Estúdio Ghibli") == "estudio-ghibli"


class _ExternalErrorClient:
    async def post(
        self,
        url: str,
        *,
        headers: dict[str, str],
        json: dict[str, Any],
    ) -> httpx.Response:
        return httpx.Response(
            502,
            text="Bearer body-secret sk-or-v1-secret socks5h://user:pass@127.0.0.1:1080",
        )


async def test_grounded_extraction_does_not_propagate_upstream_body() -> None:
    with pytest.raises(openrouter.OpenrouterTransientError) as raised:
        await extract_grounded_concepts(
            title="Título",
            content="Conteúdo suficiente para a extração estruturada.",
            api_key="sk-test",
            model="x-ai/grok-4.5",
            client=_ExternalErrorClient(),  # type: ignore[arg-type]
        )

    assert str(raised.value) == "OpenRouter 502"
    assert "body-secret" not in str(raised.value)
