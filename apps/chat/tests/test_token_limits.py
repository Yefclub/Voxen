"""Testes para src/token_limits.py — funções puras de estimativa e gatilho.

Cobre os critérios de aceite REQ-1 (estimativa) e REQ-2 (trigger).
"""

from __future__ import annotations

from src.token_limits import (
    DEFAULT_LIMIT,
    DEFAULT_THRESHOLD,
    estimate_messages_tokens,
    estimate_tokens,
    get_context_limit,
    should_compact,
)

# ---------------------------------------------------------------------------
# estimate_tokens
# ---------------------------------------------------------------------------


def test_estimate_tokens_empty() -> None:
    assert estimate_tokens("") == 0


def test_estimate_tokens_basic() -> None:
    # "abcdefgh" = 8 chars / 4 = 2 tokens
    assert estimate_tokens("abcdefgh") == 2


def test_estimate_tokens_short_returns_at_least_1() -> None:
    # Qualquer string não-vazia retorna >= 1 (não pode ser 0)
    assert estimate_tokens("x") == 1


# ---------------------------------------------------------------------------
# get_context_limit
# ---------------------------------------------------------------------------


def test_get_context_limit_known_model() -> None:
    assert get_context_limit("openai/gpt-4o") == 128_000
    assert get_context_limit("anthropic/claude-sonnet-4") == 1_000_000


def test_get_context_limit_unknown_model_returns_default() -> None:
    assert get_context_limit("acme/totally-fake-model") == DEFAULT_LIMIT


def test_get_context_limit_strips_suffix() -> None:
    # Sufixos do OR (:online, :nitro, :beta) não devem quebrar lookup
    assert get_context_limit("openai/gpt-4o:online") == 128_000
    assert get_context_limit("openai/gpt-4o:nitro") == 128_000


# ---------------------------------------------------------------------------
# estimate_messages_tokens
# ---------------------------------------------------------------------------


def test_estimate_messages_empty_list() -> None:
    assert estimate_messages_tokens([]) == 0


def test_estimate_messages_string_content() -> None:
    # 1 mensagem "abcdefgh" (8 chars / 4 = 2 tokens) + 4 overhead = 6
    msgs = [{"role": "user", "content": "abcdefgh"}]
    assert estimate_messages_tokens(msgs) == 6


def test_estimate_messages_multimodal_text() -> None:
    # Multimodal só text — soma só os text parts
    msgs = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "abcdefgh"},  # 2 tokens
                {"type": "text", "text": "wxyz"},  # 1 token
            ],
        }
    ]
    # 2 + 1 + 4 overhead = 7
    assert estimate_messages_tokens(msgs) == 7


def test_estimate_messages_multimodal_image() -> None:
    msgs = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "abcd"},  # 1 token
                {"type": "image_url", "image_url": {"url": "data:..."}},  # 800
            ],
        }
    ]
    # 1 + 800 + 4 overhead = 805
    assert estimate_messages_tokens(msgs) == 805


def test_estimate_messages_overhead_per_message() -> None:
    # 3 mensagens vazias → 4 * 3 = 12 (só overhead)
    msgs = [
        {"role": "user", "content": ""},
        {"role": "assistant", "content": ""},
        {"role": "user", "content": ""},
    ]
    assert estimate_messages_tokens(msgs) == 12


# ---------------------------------------------------------------------------
# should_compact
# ---------------------------------------------------------------------------


def test_should_compact_below_threshold() -> None:
    # gpt-4o tem limite 128k. 50% = 64000. Threshold default 70% = 89600.
    assert should_compact(50_000, "openai/gpt-4o") is False


def test_should_compact_at_threshold() -> None:
    # 70% de 128k = 89600 → True
    assert should_compact(89_600, "openai/gpt-4o") is True


def test_should_compact_above_threshold() -> None:
    assert should_compact(120_000, "openai/gpt-4o") is True


def test_should_compact_respects_custom_threshold() -> None:
    # Modelo 100k, threshold 50% → 50000
    assert should_compact(49_000, "anthropic/claude-3-opus", threshold=0.50) is False
    assert should_compact(100_001, "anthropic/claude-3-opus", threshold=0.50) is True


def test_should_compact_unknown_model_uses_default_limit() -> None:
    # DEFAULT_LIMIT = 32000, threshold 70% = 22400
    assert should_compact(20_000, "fake/model") is False
    assert should_compact(22_400, "fake/model") is True


def test_default_threshold_is_conservative() -> None:
    # Documenta a decisão de spec: 0.70, não 0.80
    assert DEFAULT_THRESHOLD == 0.70
