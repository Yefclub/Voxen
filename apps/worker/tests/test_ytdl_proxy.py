"""Testes dos helpers de proxy do worker (http/https + socks5/socks5h)."""

from __future__ import annotations

import pytest

from src import ytdl
from src.youtube_captions import _requests_proxy_dict, _transcript_proxy_config
from src.ytdl import _is_supported_proxy, _proxy_log_category


class _Logger:
    def __init__(self) -> None:
        self.entries: list[tuple[str, dict[str, object]]] = []

    def info(self, event: str, **kwargs: object) -> None:
        self.entries.append((event, kwargs))


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
    logger = _Logger()
    proxy = "socks5h://user:pass@residential.example:1080"
    monkeypatch.setattr(
        ytdl.voxen_settings,
        "get_yt_dlp_proxy_urls",
        AsyncMock(return_value=proxy),
    )
    monkeypatch.setattr(ytdl, "logger", logger)
    opts = await ytdl._runtime_options()
    assert opts["proxy"] == proxy
    assert logger.entries == [("proxy-active", {"proxy_kind": "SOCKS5H"})]
    assert "residential.example" not in repr(logger.entries)
    assert "user" not in repr(logger.entries)
    assert "pass" not in repr(logger.entries)


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("http://user:secret@host.com:8080", "HTTP"),
        ("https://host.com:8080", "HTTPS"),
        ("socks5://user:secret@host.com:1080", "SOCKS5"),
        ("socks5h://user:secret@residential.example:1080", "SOCKS5H"),
    ],
)
def test_proxy_log_category_is_closed(url: str, expected: str) -> None:
    category = _proxy_log_category(url)
    assert category == expected
    assert "host.com" not in category
    assert "residential.example" not in category
    assert "user" not in category
    assert "secret" not in category


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("garbage", "UNKNOWN"),
        ("://nope", "UNKNOWN"),
        ("http://user:secret@", "HTTP"),
        ("myuser:secret@no-scheme:1080", "UNKNOWN"),
        ("user:secret@no-scheme:1080", "UNKNOWN"),
        ("", "UNKNOWN"),
    ],
)
def test_proxy_log_category_malformed_never_leaks_credential(
    url: str,
    expected: str,
) -> None:
    category = _proxy_log_category(url)
    assert category == expected
    assert "secret" not in category
    assert "myuser" not in category
    assert "user" not in category
