"""Testes puros do extrator grounded (spec 104)."""

from __future__ import annotations

from src.brain_extract import is_grounded, parse_grounded_payload, slugify_label


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
        {"label": "LangExtract", "excerpt": "LangExtract extrai entidades com trechos literais", "confidence": 0.9},
        {"label": "Inventado", "excerpt": "texto que nao existe no fonte", "confidence": 0.9}
      ],
      "claims": [
        {"label": "Voxen usa OpenRouter", "excerpt": "O Voxen usa OpenRouter para o chat", "confidence": 0.8}
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
