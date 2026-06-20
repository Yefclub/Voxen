"""Testes dos helpers de proxy do worker (http/https + socks5/socks5h)."""

from __future__ import annotations

import pytest

from src import ytdl
from src.ytdl import _is_supported_proxy, _requests_proxy_dict, _transcript_proxy_config


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
