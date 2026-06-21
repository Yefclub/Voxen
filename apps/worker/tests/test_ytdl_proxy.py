"""Testes dos helpers de proxy do worker (http/https + socks5/socks5h)."""

from __future__ import annotations

import pytest

from src import ytdl
from src.ytdl import (
    _is_supported_proxy,
    _mask_proxy,
    _requests_proxy_dict,
    _transcript_proxy_config,
)


@pytest.mark.parametrize(
    "url",
    [
        "http://proxy.example:8080",
        "https://user:pass@proxy.example:8080",
        "socks5://proxy.example:1080",
        "socks5h://user:pass@proxy.example:1080",
    ],
)
def test_is_supported_proxy_accepts_known_schemes(url: str) -> None:
    assert _is_supported_proxy(url) is True


@pytest.mark.parametrize(
    "url",
    [
        None,
        "",
        "   ",
        "ftp://proxy.example:21",
        "socks4://proxy.example:1080",
        "proxy.example:1080",
        "garbage",
    ],
)
def test_is_supported_proxy_rejects_unsupported(url: str | None) -> None:
    assert _is_supported_proxy(url) is False


def test_requests_proxy_dict_for_socks5h() -> None:
    proxy = "socks5h://user:pass@proxy.example:1080"
    assert _requests_proxy_dict(proxy) == {"http": proxy, "https": proxy}


def test_requests_proxy_dict_for_http() -> None:
    proxy = "http://proxy.example:8080"
    assert _requests_proxy_dict(proxy) == {"http": proxy, "https": proxy}


def test_requests_proxy_dict_none_for_missing() -> None:
    assert _requests_proxy_dict(None) is None
    assert _requests_proxy_dict("") is None
    assert _requests_proxy_dict("ftp://nope") is None


def test_transcript_proxy_config_for_socks5h() -> None:
    proxy = "socks5h://user:pass@proxy.example:1080"
    config = _transcript_proxy_config(proxy)
    assert config is not None
    # GenericProxyConfig expõe as URLs montadas via to_requests_dict()
    assert config.to_requests_dict() == {"http": proxy, "https": proxy}


def test_transcript_proxy_config_none_for_missing() -> None:
    assert _transcript_proxy_config(None) is None
    assert _transcript_proxy_config("") is None
    assert _transcript_proxy_config("socks4://nope") is None


async def test_runtime_options_applies_socks5_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    from unittest.mock import AsyncMock

    monkeypatch.delenv("YTDLP_PROXY_URLS", raising=False)
    monkeypatch.delenv("YTDLP_PROXY_URL", raising=False)
    monkeypatch.setattr(
        ytdl.voxen_settings,
        "get_yt_dlp_proxy_urls",
        AsyncMock(return_value="socks5h://user:pass@proxy.example:1080"),
    )
    opts = await ytdl._runtime_options()
    assert opts["proxy"] == "socks5h://user:pass@proxy.example:1080"


def test_mask_proxy_keeps_credential_free_socks_url() -> None:
    # Sem userinfo: a URL é logável tal qual (host:porta legíveis).
    assert _mask_proxy("socks5h://127.0.0.1:1080") == "socks5h://127.0.0.1:1080"


def test_mask_proxy_strips_userinfo() -> None:
    masked = _mask_proxy("http://user:secret@host.com:8080")
    assert "user" not in masked
    assert "secret" not in masked
    assert "host.com:8080" in masked
    assert masked == "http://host.com:8080"


def test_mask_proxy_strips_userinfo_socks5h() -> None:
    masked = _mask_proxy("socks5h://alice:hunter2@residential.example:1080")
    assert "alice" not in masked
    assert "hunter2" not in masked
    assert masked == "socks5h://residential.example:1080"


def test_mask_proxy_without_port() -> None:
    masked = _mask_proxy("http://user:pw@host.com")
    assert "user" not in masked
    assert "pw" not in masked
    assert masked == "http://host.com"


@pytest.mark.parametrize(
    "url",
    [
        "garbage",
        "://nope",
        "http://user:secret@",
        # Sem esquema: "myuser" é lido como scheme por urlsplit — não pode vazar.
        "myuser:secret@no-scheme:1080",
        "user:secret@no-scheme:1080",
        "",
    ],
)
def test_mask_proxy_malformed_never_leaks_credential(url: str) -> None:
    # Robusto a URL malformada: nunca lança e nunca devolve a string crua com
    # userinfo embutido — nem a senha NEM o usuário (metade do par de credencial).
    masked = _mask_proxy(url)
    assert "secret" not in masked
    assert "myuser" not in masked
    assert "user" not in masked
    assert isinstance(masked, str)
