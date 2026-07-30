"""Testes do espelhamento de capas remotas."""

from __future__ import annotations

import pytest

from src import thumbnail
from src.thumbnail import (
    _host_allowed,
    public_preview_path,
    thumbnail_key,
)


class _Logger:
    def __init__(self) -> None:
        self.entries: list[tuple[str, dict[str, object]]] = []

    def info(self, event: str, **kwargs: object) -> None:
        self.entries.append((event, kwargs))


def test_thumbnail_key_path() -> None:
    assert thumbnail_key("u1", "t1", "jpg") == "workspaces/u1/transcripts/t1/thumbnail.jpg"


def test_public_preview_path() -> None:
    assert public_preview_path("abc") == "/api/transcripts/abc/preview"


def test_host_allowed_tiktok_and_yt() -> None:
    assert _host_allowed("p16-common-sign.tiktokcdn.com")
    assert _host_allowed("i.ytimg.com")
    assert not _host_allowed("127.0.0.1")
    assert not _host_allowed("evil.example.com")


async def test_disallowed_thumbnail_host_is_not_logged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logger = _Logger()
    monkeypatch.setattr(thumbnail, "log", logger)

    result = await thumbnail.mirror_remote_thumbnail(
        remote_url="https://cliente-acme-fusao-secreta.example/capa.png",
        user_id="user-1",
        transcript_id="transcript-1",
    )

    assert result is None
    assert logger.entries == [
        (
            "thumbnail-host-skipped",
            {"reason": "host_not_allowed"},
        )
    ]
    assert "cliente-acme" not in repr(logger.entries)
