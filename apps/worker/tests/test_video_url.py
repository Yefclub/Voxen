"""Testes do detector de source pela URL canonical (sem rede)."""

from __future__ import annotations

import pytest

from src import video_url


@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://youtu.be/dQw4w9WgXcQ", "YOUTUBE"),
        ("https://www.youtube.com/watch?v=abc", "YOUTUBE"),
        ("https://music.youtube.com/watch?v=abc", "YOUTUBE"),
        ("https://www.instagram.com/reel/Abc123_XYZ/", "INSTAGRAM"),
        ("https://instagram.com/p/abc/", "INSTAGRAM"),
        ("https://www.tiktok.com/@user/video/7123456789012345678", "TIKTOK"),
        ("https://vm.tiktok.com/ZMabc/", "TIKTOK"),
        ("https://vt.tiktok.com/Xyz/", "TIKTOK"),
    ],
)
def test_detects_source(url: str, expected: str) -> None:
    assert video_url.detect_source(url) == expected


@pytest.mark.parametrize(
    "url",
    [
        "https://vimeo.com/12345",
        "https://example.com/video",
        "ftp://youtu.be/abc",
        "",
        "not a url",
    ],
)
def test_rejects_unsupported(url: str) -> None:
    assert video_url.detect_source(url) is None
