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


async def get_embeddings_enabled(default: bool = False) -> bool:
    """Setting cifrada `embeddings_enabled` = true/false. Default False."""
    enc = await db.get_setting_enc("embeddings_enabled")
    if enc is None:
        return default
    try:
        raw = decrypt(enc, get_master_key()).strip().lower()
    except Exception:
        return default
    return raw in {"1", "true", "yes", "on"}


async def get_embedding_model(default: str = "openai/text-embedding-3-small") -> str:
    enc = await db.get_setting_enc("embedding_model")
    if enc is None:
        return default
    try:
        value = decrypt(enc, get_master_key()).strip()
    except Exception:
        return default
    return value or default


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


async def get_default_chat_model() -> str | None:
    enc = await db.get_setting_enc("default_chat_model")
    if enc is None:
        return None
    return decrypt(enc, get_master_key())


async def get_default_vision_model() -> str | None:
    enc = await db.get_setting_enc("default_vision_model")
    if enc is None:
        return None
    return decrypt(enc, get_master_key())


async def get_default_document_model() -> str | None:
    enc = await db.get_setting_enc("default_document_model")
    if enc is None:
        return None
    return decrypt(enc, get_master_key())


async def get_first_setting(keys: tuple[str, ...]) -> str | None:
    for key in keys:
        enc = await db.get_setting_enc(key)
        if enc is not None:
            return decrypt(enc, get_master_key())
    return None


async def get_default_x_analysis_model() -> str | None:
    return await get_first_setting(
        (
            "default_x_analysis_model",
            "default_grok_model",
            "default_x_model",
            "x_analysis_model",
        )
    )


async def get_yt_dlp_proxy_urls() -> str | None:
    enc = await db.get_setting_enc("yt_dlp_proxy_urls")
    if enc is None:
        return None
    return decrypt(enc, get_master_key())


async def get_yt_dlp_cookies() -> str | None:
    """Conteúdo do cookies.txt (formato Netscape) para extração autenticada.

    Secret cifrado (mesma master key). Quando setado, o worker materializa o
    conteúdo num arquivo temporário 600 e passa via `cookiefile` ao yt-dlp.
    NUNCA logar o retorno desta função.
    """
    enc = await db.get_setting_enc("yt_dlp_cookies")
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


async def get_summary_timeout_sec(default: float = 120.0) -> float:
    """Timeout da chamada OpenRouter para resumo best-effort no worker."""
    enc = await db.get_setting_enc("summary_timeout_sec")
    if enc is None:
        return default
    try:
        value = float(decrypt(enc, get_master_key()).strip())
    except ValueError:
        return default
    if value < 30 or value > 600:
        return default
    return value


async def get_app_language() -> str:
    """Idioma da instância: pt-BR (default) ou en."""
    enc = await db.get_setting_enc("app_language")
    if enc is None:
        return "pt-BR"
    try:
        value = decrypt(enc, get_master_key()).strip()
    except Exception:
        return "pt-BR"
    return "en" if value == "en" else "pt-BR"
