from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import pytest

from src import tiktok_ingestion, tiktok_player


class _Response:
    def __init__(
        self,
        *,
        status_code: int = 200,
        payload: dict[str, Any] | None = None,
        content: bytes | None = None,
        headers: dict[str, str] | None = None,
        url: str = "https://www.tiktok.com/player/api/v1/items",
    ) -> None:
        self.status_code = status_code
        self._content = content if content is not None else json.dumps(payload or {}).encode()
        self.headers = headers or {"content-type": "application/json"}
        self.url = url

    @property
    def content(self) -> bytes:
        return self._content

    def json(self) -> dict[str, Any]:
        return json.loads(self._content)

    def iter_content(self, chunk_size: int) -> list[bytes]:
        return [
            self._content[offset : offset + chunk_size]
            for offset in range(0, len(self._content), chunk_size)
        ]

    def close(self) -> None:
        pass


class _Session:
    def __init__(self, responses: list[_Response]) -> None:
        self.responses = responses
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.proxies: dict[str, str] = {}

    def get(self, url: str, **kwargs: Any) -> _Response:
        self.calls.append((url, kwargs))
        return self.responses.pop(0)

    def close(self) -> None:
        pass


def _item_payload(media_url: str = "https://v16-webapp-prime.tiktok.com/video/path") -> dict:
    return {
        "status_code": 0,
        "results": [{"code": "ok", "id_str": "7672827813124164872"}],
        "items": [
            {
                "id_str": "7672827813124164872",
                "desc": "Official player fallback",
                "author_info": {"nickname": "Author", "unique_id": "author"},
                "video_info": {
                    "meta": {"duration": 127},
                    "url_list": [media_url],
                    "cover": {"url_list": ["https://p16-common-sign.tiktokcdn.com/cover.jpeg"]},
                },
            }
        ],
    }


def test_fetch_item_uses_official_player_for_canonical_url(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _Session([_Response(payload=_item_payload())])
    monkeypatch.setattr(tiktok_player.requests, "Session", lambda: session)

    item = tiktok_player.fetch_item_sync("https://www.tiktok.com/@author/video/7672827813124164872")

    assert item.video_id == "7672827813124164872"
    assert item.duration_sec == 127
    assert item.author == "Author"
    assert item.media_url.startswith("https://v16-webapp-prime.tiktok.com/")
    assert len(session.calls) == 1
    assert session.calls[0][0] == "https://www.tiktok.com/player/api/v1/items"


def test_fetch_item_resolves_short_url_through_official_oembed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _Session(
        [
            _Response(payload={"embed_product_id": "7672827813124164872"}),
            _Response(payload=_item_payload()),
        ]
    )
    monkeypatch.setattr(tiktok_player.requests, "Session", lambda: session)

    item = tiktok_player.fetch_item_sync("https://vt.tiktok.com/ZSVJHUMAG")

    assert item.video_id == "7672827813124164872"
    assert [call[0] for call in session.calls] == [
        "https://www.tiktok.com/oembed",
        "https://www.tiktok.com/player/api/v1/items",
    ]


def test_fetch_item_rejects_non_tiktok_media_host(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _Session([_Response(payload=_item_payload("https://attacker.invalid/video.mp4"))])
    monkeypatch.setattr(tiktok_player.requests, "Session", lambda: session)

    with pytest.raises(tiktok_player.TikTokPlayerError, match="host"):
        tiktok_player.fetch_item_sync("https://www.tiktok.com/@author/video/7672827813124164872")


@pytest.mark.parametrize(
    "malformed_url",
    [
        "https://tiktok.com:bad/video.mp4",
        "https://[not-an-ipv6-address]/video.mp4",
    ],
)
def test_fetch_item_normalizes_malformed_media_urls(
    monkeypatch: pytest.MonkeyPatch,
    malformed_url: str,
) -> None:
    session = _Session([_Response(payload=_item_payload(malformed_url))])
    monkeypatch.setattr(tiktok_player.requests, "Session", lambda: session)

    with pytest.raises(tiktok_player.TikTokPlayerError, match="media"):
        tiktok_player.fetch_item_sync("https://www.tiktok.com/@author/video/7672827813124164872")


def test_download_media_rejects_oversized_response_before_writing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    response = _Response(
        content=b"not-downloaded",
        headers={
            "content-type": "video/mp4",
            "content-length": str(tiktok_player.MAX_MEDIA_BYTES + 1),
        },
        url="https://v16-webapp-prime.tiktok.com/video/path",
    )
    session = _Session([response])
    monkeypatch.setattr(tiktok_player.requests, "Session", lambda: session)
    item = tiktok_player.PlayerItem(
        video_id="7672827813124164872",
        title="Title",
        author="Author",
        author_handle="author",
        duration_sec=10,
        thumbnail_url=None,
        canonical_url="https://www.tiktok.com/@author/video/7672827813124164872",
        media_url="https://v16-webapp-prime.tiktok.com/video/path",
    )

    with pytest.raises(tiktok_player.TikTokPlayerError, match="grande"):
        tiktok_player.download_media_sync(item, tmp_path / "video.mp4")

    assert not (tmp_path / "video.mp4").exists()


def test_download_media_normalizes_malformed_redirect(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    response = _Response(
        status_code=302,
        headers={"location": "https://tiktok.com:bad/video.mp4"},
        url="https://v16-webapp-prime.tiktok.com/video/path",
    )
    session = _Session([response])
    monkeypatch.setattr(tiktok_player.requests, "Session", lambda: session)
    item = tiktok_player.PlayerItem(
        video_id="7672827813124164872",
        title="Title",
        author="Author",
        author_handle="author",
        duration_sec=10,
        thumbnail_url=None,
        canonical_url="https://www.tiktok.com/@author/video/7672827813124164872",
        media_url="https://v16-webapp-prime.tiktok.com/video/path",
    )

    with pytest.raises(tiktok_player.TikTokPlayerError, match="media"):
        tiktok_player.download_media_sync(item, tmp_path / "video.mp4")

    assert not (tmp_path / "video.mp4").exists()


async def test_download_player_audio_converts_and_removes_source(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    item = tiktok_player.PlayerItem(
        video_id="7672827813124164872",
        title="Title",
        author="Author",
        author_handle="author",
        duration_sec=10,
        thumbnail_url=None,
        canonical_url="https://www.tiktok.com/@author/video/7672827813124164872",
        media_url="https://v16-webapp-prime.tiktok.com/video/path",
    )
    monkeypatch.setattr(tiktok_ingestion, "_proxy_url", AsyncMock(return_value=None))

    def fake_download(_item: object, destination: Path, **_kwargs: object) -> None:
        destination.write_bytes(b"video")

    async def fake_extract(_source: Path, destination: Path) -> None:
        destination.write_bytes(b"opus")

    monkeypatch.setattr(tiktok_ingestion.tiktok_player, "download_media_sync", fake_download)
    extract = AsyncMock(side_effect=fake_extract)
    monkeypatch.setattr(tiktok_ingestion.uploaded_media, "extract_audio_opus", extract)

    result = await tiktok_ingestion.download_player_audio(item, tmp_path)

    assert result == tmp_path / "7672827813124164872.opus"
    assert result.read_bytes() == b"opus"
    assert not (tmp_path / "7672827813124164872.player.mp4").exists()
