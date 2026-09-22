from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest

from src.x_post import (
    XCaptureError,
    fetch_x_post,
    parse_x_post_payload,
    render_x_post_context,
    render_x_post_markdown,
    select_x_content,
    syndication_token,
)

SAMPLE_ID = "2102049978592219344"

SAMPLE_PAYLOAD: dict[str, Any] = {
    "__typename": "Tweet",
    "id_str": SAMPLE_ID,
    "text": "Product design cheat sheet; bookmark this:\n\n- Font: SF Pro",
    "created_at": "2026-09-21T14:59:03.000Z",
    "lang": "fr",
    "possibly_sensitive": False,
    "favorite_count": 291,
    "conversation_count": 13,
    "user": {"name": "rico", "screen_name": "_heyrico"},
    "mediaDetails": [
        {
            "type": "photo",
            "media_url_https": "https://pbs.twimg.com/media/HSv7T10asAA66R-.jpg",
            "expanded_url": "https://x.com/_heyrico/status/2102049978592219344/photo/1",
        }
    ],
}


class MockTransport(httpx.AsyncBaseTransport):
    def __init__(self, response: httpx.Response | Exception) -> None:
        self.response = response
        self.requests: list[httpx.Request] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


async def _fetch_with(response: httpx.Response | Exception) -> tuple[Any, MockTransport]:
    transport = MockTransport(response)
    async with httpx.AsyncClient(transport=transport) as client:
        capture = await fetch_x_post(SAMPLE_ID, client=client)
    return capture, transport


def test_syndication_token_is_stable_base36_and_non_empty() -> None:
    token = syndication_token(SAMPLE_ID)

    assert token
    assert re.fullmatch(r"[0-9a-z]{1,12}", token)
    assert syndication_token(SAMPLE_ID) == token


def test_parse_payload_extracts_author_metrics_and_media() -> None:
    post = parse_x_post_payload(SAMPLE_ID, SAMPLE_PAYLOAD)

    assert post is not None
    assert post.text.startswith("Product design cheat sheet")
    assert post.author_name == "rico"
    assert post.author_handle == "_heyrico"
    assert post.channel == "@_heyrico"
    assert post.created_at == datetime(2026, 9, 21, 14, 59, 3, tzinfo=UTC)
    assert post.like_count == 291
    assert post.reply_count == 13
    assert post.lang == "fr"
    assert post.permalink == f"https://x.com/i/status/{SAMPLE_ID}"
    assert post.preview_url == "https://pbs.twimg.com/media/HSv7T10asAA66R-.jpg"
    assert [item.kind for item in post.media] == ["photo"]


def test_parse_payload_prefers_note_tweet_text_for_long_posts() -> None:
    payload = {
        **SAMPLE_PAYLOAD,
        "text": "Texto truncado…",
        "note_tweet": {"text": "Texto completo do post longo."},
    }

    post = parse_x_post_payload(SAMPLE_ID, payload)

    assert post is not None
    assert post.text == "Texto completo do post longo."


def test_parse_payload_rejects_foreign_shapes_and_empty_posts() -> None:
    assert parse_x_post_payload(SAMPLE_ID, {}) is None
    assert parse_x_post_payload(SAMPLE_ID, {"__typename": "Tweet"}) is None
    assert (
        parse_x_post_payload(SAMPLE_ID, {**SAMPLE_PAYLOAD, "id_str": "999999999999999999"}) is None
    )
    without_content = {**SAMPLE_PAYLOAD, "text": "   ", "mediaDetails": []}
    assert parse_x_post_payload(SAMPLE_ID, without_content) is None


def test_parse_media_only_accepts_https_twimg_hosts() -> None:
    payload = {
        **SAMPLE_PAYLOAD,
        "mediaDetails": [
            {"type": "photo", "media_url_https": "http://pbs.twimg.com/a.jpg"},
            {"type": "photo", "media_url_https": "https://evil.example.com/a.jpg"},
            {"type": "photo", "media_url_https": "https://pbs.twimg.com/a.jpg#ok"},
        ],
    }

    post = parse_x_post_payload(SAMPLE_ID, payload)

    assert post is not None
    assert [item.url for item in post.media] == ["https://pbs.twimg.com/a.jpg#ok"]


def test_parse_media_picks_highest_bitrate_mp4_variant() -> None:
    payload = {
        **SAMPLE_PAYLOAD,
        "mediaDetails": [
            {
                "type": "video",
                "media_url_https": "https://pbs.twimg.com/thumb.jpg",
                "video_info": {
                    "variants": [
                        {
                            "content_type": "application/x-mpegURL",
                            "url": "https://video.twimg.com/x.m3u8",
                        },
                        {
                            "content_type": "video/mp4",
                            "bitrate": 256000,
                            "url": "https://video.twimg.com/low.mp4",
                        },
                        {
                            "content_type": "video/mp4",
                            "bitrate": 832000,
                            "url": "https://video.twimg.com/high.mp4",
                        },
                    ]
                },
            }
        ],
    }

    post = parse_x_post_payload(SAMPLE_ID, payload)

    assert post is not None
    assert [(item.kind, item.url) for item in post.media] == [
        ("video", "https://video.twimg.com/high.mp4")
    ]


def test_render_context_lists_metadata_and_text() -> None:
    post = parse_x_post_payload(SAMPLE_ID, SAMPLE_PAYLOAD)
    assert post is not None

    context = render_x_post_context(post)

    assert "Autor: rico (@_heyrico)" in context
    assert "Publicado em: 2026-09-21T14:59:03+00:00" in context
    assert f"Link: https://x.com/i/status/{SAMPLE_ID}" in context
    assert "Métricas: 291 curtidas, 13 respostas" in context
    assert "Foto: https://pbs.twimg.com/media/HSv7T10asAA66R-.jpg" in context
    assert "Texto do post:" in context
    assert "Product design cheat sheet" in context


def test_render_markdown_flags_capture_without_analysis() -> None:
    post = parse_x_post_payload(SAMPLE_ID, SAMPLE_PAYLOAD)
    assert post is not None

    markdown = render_x_post_markdown(post)

    assert markdown.startswith("Conteúdo capturado diretamente do X.")
    assert "Product design cheat sheet" in markdown
    assert markdown.endswith("\n")


def test_select_prefers_analysis_and_never_fabricates_without_content() -> None:
    selection = select_x_content(
        capture_markdown="captura real",
        analysis_text="análise do modelo",
        analysis_accessible=True,
    )
    assert (selection.content, selection.source, selection.unavailable) == (
        "análise do modelo",
        "analysis",
        False,
    )

    capture_only = select_x_content(
        capture_markdown="captura real",
        analysis_text=None,
        analysis_accessible=None,
    )
    assert (capture_only.content, capture_only.source, capture_only.unavailable) == (
        "captura real",
        "capture",
        False,
    )

    rejected = select_x_content(
        capture_markdown=None,
        analysis_text="não consegui acessar o post",
        analysis_accessible=False,
    )
    assert (rejected.content, rejected.source, rejected.unavailable) == ("", "none", True)

    empty = select_x_content(capture_markdown=None, analysis_text="   ", analysis_accessible=None)
    assert empty.unavailable is True


def test_select_ignores_model_denial_when_capture_exists() -> None:
    selection = select_x_content(
        capture_markdown="captura real",
        analysis_text="ACESSO: INDISPONIVEL",
        analysis_accessible=False,
    )

    assert (selection.content, selection.source, selection.unavailable) == (
        "captura real",
        "capture",
        False,
    )


async def test_fetch_rejects_invalid_status_ids_without_network() -> None:
    transport = MockTransport(httpx.Response(200, json=SAMPLE_PAYLOAD))
    async with httpx.AsyncClient(transport=transport) as client:
        assert await fetch_x_post("abc", client=client) is None
    assert transport.requests == []


async def test_fetch_parses_successful_payload() -> None:
    capture, transport = await _fetch_with(httpx.Response(200, json=SAMPLE_PAYLOAD))

    assert capture is not None
    assert capture.status_id == SAMPLE_ID
    request = transport.requests[0]
    assert request.url.params["id"] == SAMPLE_ID
    assert request.url.params["token"]


async def test_fetch_returns_none_for_removed_or_restricted_post() -> None:
    capture, _ = await _fetch_with(httpx.Response(200, json={}))

    assert capture is None


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, text="<html>error</html>"),
        httpx.Response(503, json={"erro": "indisponível"}),
        httpx.ConnectTimeout("timeout"),
        httpx.ConnectError("network down"),
    ],
)
async def test_fetch_raises_sanitized_capture_error(
    response: httpx.Response | Exception,
) -> None:
    with pytest.raises(XCaptureError):
        await _fetch_with(response)
