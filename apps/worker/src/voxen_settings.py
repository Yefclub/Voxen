"""Acesso a Settings cifrados — decifra valueEnc com a master key."""

from __future__ import annotations

import os
from pathlib import Path

from . import db
from .voxen_crypto import decrypt, load_master_key, load_master_key_value

_master_key_cache: bytes | None = None


def get_master_key() -> bytes:
    global _master_key_cache
    if _master_key_cache is None:
        env_key = os.environ.get("MASTER_KEY", "").strip()
        if env_key:
            _master_key_cache = load_master_key_value(env_key)
        else:
            path = os.environ.get("MASTER_KEY_PATH", "/data/master.key")
            _master_key_cache = load_master_key(Path(path))
    return _master_key_cache


async def get_openrouter_api_key() -> str | None:
    enc = await db.get_setting_enc("openrouter_api_key")
    if enc is None:
        return None
    return decrypt(enc, get_master_key())


async def get_default_transcription_model() -> str | None:
    enc = await db.get_setting_enc("default_transcription_model")
    if enc is None:
        return None
    return decrypt(enc, get_master_key())


async def get_admin_email() -> str | None:
    """Email do admin do deploy — opcional. Quando setado, scraper inclui
    `From: <email>` no User-Agent (boa-prática RFC 7231 §5.5.1).
    """
    enc = await db.get_setting_enc("admin_email")
    if enc is None:
        return None
    return decrypt(enc, get_master_key())


async def get_telegram_bot_token() -> str | None:
    """Bot Telegram token (cifrado em Settings). Necessário pra automations
    com delivery=TELEGRAM."""
    enc = await db.get_setting_enc("telegram_bot_token")
    if enc is None:
        return None
    return decrypt(enc, get_master_key())
