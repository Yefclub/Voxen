from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, cast
from unittest.mock import AsyncMock

import asyncpg
import pytest

from src import db, voxen_settings
from src.voxen_crypto import encrypt

KEY = b"k" * 32


async def test_openrouter_key_and_model_are_decrypted_from_one_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    read = AsyncMock(
        return_value={
            "openrouter_api_key": encrypt("sk-test", KEY),
            "default_chat_model": encrypt("x-ai/grok-4.5", KEY),
        }
    )
    monkeypatch.setattr(voxen_settings.db, "get_settings_enc", read)
    monkeypatch.setattr(voxen_settings, "_master_key_cache", KEY)

    config = await voxen_settings.get_openrouter_model_config(
        ("default_chat_model", "legacy_chat_model")
    )

    assert config == voxen_settings.OpenRouterModelConfig(
        api_key="sk-test",
        model="x-ai/grok-4.5",
    )
    read.assert_awaited_once_with(
        (
            "openrouter_api_key",
            "default_chat_model",
            "legacy_chat_model",
        )
    )


class _FakeConnection:
    def __init__(self) -> None:
        self.fetch_calls: list[tuple[str, tuple[object, ...]]] = []

    async def fetch(self, query: str, *args: object) -> list[dict[str, Any]]:
        self.fetch_calls.append((query, args))
        return [
            {"key": "openrouter_api_key", "valueEnc": "key-enc"},
            {"key": "default_chat_model", "valueEnc": "model-enc"},
        ]


async def test_bulk_settings_reader_uses_one_select_and_deduplicates_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn = _FakeConnection()

    @asynccontextmanager
    async def fake_connection() -> AsyncIterator[asyncpg.Connection]:
        yield cast(asyncpg.Connection, conn)

    monkeypatch.setattr(db, "connection", fake_connection)

    values = await db.get_settings_enc(
        ("openrouter_api_key", "default_chat_model", "openrouter_api_key")
    )

    assert values == {
        "openrouter_api_key": "key-enc",
        "default_chat_model": "model-enc",
    }
    assert len(conn.fetch_calls) == 1
    query, args = conn.fetch_calls[0]
    assert "key = ANY($1::text[])" in query
    assert args == (["openrouter_api_key", "default_chat_model"],)
