"""Lê settings cifrados do DB usando a master key."""

from __future__ import annotations

import os
from pathlib import Path

from . import db
from .voxen_crypto import decrypt, load_master_key

_master_key: bytes | None = None


def get_master_key() -> bytes:
    global _master_key
    if _master_key is None:
        path = os.environ.get("MASTER_KEY_PATH", "/data/master.key")
        _master_key = load_master_key(Path(path))
    return _master_key


async def get_openrouter_api_key() -> str | None:
    enc = await db.get_setting_enc("openrouter_api_key")
    if enc is None:
        return None
    return decrypt(enc, get_master_key())


async def get_default_chat_model() -> str | None:
    enc = await db.get_setting_enc("default_chat_model")
    if enc is None:
        return None
    return decrypt(enc, get_master_key())


async def get_default_transcription_model() -> str | None:
    enc = await db.get_setting_enc("default_transcription_model")
    if enc is None:
        return None
    return decrypt(enc, get_master_key())


async def get_summary_timeout_sec(default: float = 90.0) -> float:
    """Timeout do call summarize-transcript pra OpenRouter. Opcional via setting.

    Útil pra modelos lentos ou textos longos. Retorna default (90s) se setting
    ausente ou inválida.
    """
    enc = await db.get_setting_enc("summary_timeout_sec")
    if enc is None:
        return default
    try:
        value = decrypt(enc, get_master_key())
        return float(value)
    except (ValueError, Exception):  # noqa: BLE001
        return default
