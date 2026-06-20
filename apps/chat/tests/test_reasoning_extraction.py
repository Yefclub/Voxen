"""Testes para extract_reasoning_text — parse de reasoning do delta de streaming.

Cobre os critérios de aceite da spec 052 (reasoning string + reasoning_details).
"""

from __future__ import annotations

from typing import Any

from src.main import extract_reasoning_text


class _Delta:
    """Mock de delta de streaming com atributos arbitrários (estilo OpenAI SDK)."""

    def __init__(self, **kwargs: Any) -> None:
        # Defaults pra getattr não estourar AttributeError nos campos esperados.
        self.reasoning: Any = None
        self.reasoning_details: Any = None
        for k, v in kwargs.items():
            setattr(self, k, v)


class _Detail:
    """Mock de item de reasoning_details como objeto (não dict)."""

    def __init__(self, **kwargs: Any) -> None:
        for k, v in kwargs.items():
            setattr(self, k, v)


# ---------------------------------------------------------------------------
# REQ-1 — reasoning string
# ---------------------------------------------------------------------------


def test_reasoning_string_emits() -> None:
    delta = _Delta(reasoning="pensando alto")
    assert extract_reasoning_text(delta) == "pensando alto"


def test_reasoning_empty_string_returns_none() -> None:
    delta = _Delta(reasoning="")
    assert extract_reasoning_text(delta) is None


# ---------------------------------------------------------------------------
# REQ-2 — reasoning_details (lista) com text / summary
# ---------------------------------------------------------------------------


def test_reasoning_details_text_emits() -> None:
    delta = _Delta(reasoning_details=[{"type": "reasoning.text", "text": "passo 1"}])
    assert extract_reasoning_text(delta) == "passo 1"


def test_reasoning_details_summary_emits() -> None:
    delta = _Delta(reasoning_details=[{"type": "reasoning.summary", "summary": "resumo do plano"}])
    assert extract_reasoning_text(delta) == "resumo do plano"


def test_reasoning_details_multiple_items_concatenated() -> None:
    delta = _Delta(
        reasoning_details=[
            {"type": "reasoning.text", "text": "a"},
            {"type": "reasoning.summary", "summary": "b"},
        ]
    )
    assert extract_reasoning_text(delta) == "ab"


def test_reasoning_details_text_preferred_over_summary_same_item() -> None:
    delta = _Delta(reasoning_details=[{"type": "reasoning.text", "text": "T", "summary": "S"}])
    assert extract_reasoning_text(delta) == "T"


def test_reasoning_details_object_item() -> None:
    delta = _Delta(reasoning_details=[_Detail(type="reasoning.text", text="via objeto")])
    assert extract_reasoning_text(delta) == "via objeto"


# ---------------------------------------------------------------------------
# REQ-3 — prioridade da string quando ambos vêm
# ---------------------------------------------------------------------------


def test_reasoning_string_preferred_when_both_present() -> None:
    delta = _Delta(
        reasoning="string ganha",
        reasoning_details=[{"type": "reasoning.text", "text": "nao deve aparecer"}],
    )
    assert extract_reasoning_text(delta) == "string ganha"


# ---------------------------------------------------------------------------
# REQ-4 / REQ-5 — robustez: None / vazio / malformado / cifrado
# ---------------------------------------------------------------------------


def test_no_reasoning_at_all_returns_none() -> None:
    assert extract_reasoning_text(_Delta()) is None


def test_reasoning_details_none_returns_none() -> None:
    assert extract_reasoning_text(_Delta(reasoning_details=None)) is None


def test_reasoning_details_empty_list_returns_none() -> None:
    assert extract_reasoning_text(_Delta(reasoning_details=[])) is None


def test_reasoning_details_encrypted_item_ignored() -> None:
    delta = _Delta(reasoning_details=[{"type": "reasoning.encrypted", "data": "ZW5jcnlwdGVk"}])
    assert extract_reasoning_text(delta) is None


def test_reasoning_details_item_without_text_or_summary_ignored() -> None:
    delta = _Delta(reasoning_details=[{"type": "reasoning.text", "index": 0}])
    assert extract_reasoning_text(delta) is None


def test_reasoning_details_mixed_valid_and_empty() -> None:
    delta = _Delta(
        reasoning_details=[
            {"type": "reasoning.text"},  # sem texto — ignorado
            {"type": "reasoning.text", "text": "vale"},
        ]
    )
    assert extract_reasoning_text(delta) == "vale"


def test_reasoning_details_malformed_does_not_raise() -> None:
    # Não-iterável onde se espera lista → try/except devolve None, sem estourar.
    delta = _Delta(reasoning_details=42)
    assert extract_reasoning_text(delta) is None


def test_reasoning_details_item_wrong_type_does_not_raise() -> None:
    # Item inteiro no meio da lista: getattr(...) devolve None, sem estourar.
    delta = _Delta(reasoning_details=[123, {"type": "reasoning.text", "text": "ok"}])
    assert extract_reasoning_text(delta) == "ok"
