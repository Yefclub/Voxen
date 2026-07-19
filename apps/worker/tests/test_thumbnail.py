"""Testes do espelhamento de capas remotas."""

from __future__ import annotations

from src.thumbnail import (
    _host_allowed,
    public_preview_path,
    thumbnail_key,
)


def test_thumbnail_key_path() -> None:
    assert thumbnail_key("u1", "t1", "jpg") == "workspaces/u1/transcripts/t1/thumbnail.jpg"


def test_public_preview_path() -> None:
    assert public_preview_path("abc") == "/api/transcripts/abc/preview"


def test_host_allowed_tiktok_and_yt() -> None:
    assert _host_allowed("p16-common-sign.tiktokcdn.com")
    assert _host_allowed("i.ytimg.com")
    assert not _host_allowed("127.0.0.1")
    assert not _host_allowed("evil.example.com")
