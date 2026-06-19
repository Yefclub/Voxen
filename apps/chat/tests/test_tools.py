"""Testes dos parsers de URL no chat service (espelham video-url.ts).

Não testamos execute_tool fim-a-fim — requer DB + Redis. Aqui só os helpers
puros (_canonical_video_url, _normalize_web_url) que são pure functions.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from src import tools
from src.tools import (
    _build_web_search_payload,
    _canonical_video_url,
    _extract_url_citations,
    _normalize_web_url,
    execute_tool,
)

# ---------------------------------------------------------------------------
# _canonical_video_url
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://youtu.be/dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ"),
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ"),
        ("https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42", "https://youtu.be/dQw4w9WgXcQ"),
        ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ"),
        ("https://www.youtube.com/embed/dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ"),
        ("https://music.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ"),
    ],
)
def test_youtube_canonical(url: str, expected: str) -> None:
    assert _canonical_video_url(url) == expected


@pytest.mark.parametrize(
    "url,expected",
    [
        (
            "https://www.instagram.com/reel/Abc123_XYZ/",
            "https://www.instagram.com/reel/Abc123_XYZ/",
        ),
        ("https://instagram.com/p/Abc123/", "https://www.instagram.com/reel/Abc123/"),
        ("https://www.instagram.com/tv/Code/", "https://www.instagram.com/reel/Code/"),
        ("https://www.instagram.com/someuser/reel/Code/", "https://www.instagram.com/reel/Code/"),
    ],
)
def test_instagram_canonical(url: str, expected: str) -> None:
    assert _canonical_video_url(url) == expected


@pytest.mark.parametrize(
    "url,expected",
    [
        (
            "https://www.tiktok.com/@user/video/7123456789012345678",
            "https://www.tiktok.com/@user/video/7123456789012345678",
        ),
        ("https://vm.tiktok.com/ZMabc/", "https://vm.tiktok.com/ZMabc"),
        ("https://vt.tiktok.com/Xyz/", "https://vt.tiktok.com/Xyz"),
    ],
)
def test_tiktok_canonical(url: str, expected: str) -> None:
    assert _canonical_video_url(url) == expected


@pytest.mark.parametrize(
    "url,expected",
    [
        # status_id deve ter 6-32 dígitos (regex)
        ("https://x.com/jack/status/123456789012345", "https://x.com/i/status/123456789012345"),
        ("https://x.com/i/status/123456", "https://x.com/i/status/123456"),
        ("https://x.com/i/web/status/987654", "https://x.com/i/status/987654"),
        ("https://twitter.com/elon/status/424242", "https://x.com/i/status/424242"),
        ("https://mobile.twitter.com/u/status/111111", "https://x.com/i/status/111111"),
        ("https://www.x.com/u/status/777777", "https://x.com/i/status/777777"),
    ],
)
def test_x_canonical(url: str, expected: str) -> None:
    assert _canonical_video_url(url) == expected


@pytest.mark.parametrize(
    "url",
    [
        "https://vimeo.com/12345",
        "https://example.com/video",
        "ftp://youtu.be/dQw4w9WgXcQ",
        "",
        "not a url",
        "https://youtu.be/short",  # id curto demais
        "https://www.instagram.com/notreel/",  # path sem reel/p/tv
        "https://www.tiktok.com/justpath",  # sem @user/video
        "https://x.com/jack",  # sem status
        "https://twitter.com/home",  # sem status
        "https://x.com/jack/status/abc",  # status_id não numérico
    ],
)
def test_video_canonical_rejects(url: str) -> None:
    assert _canonical_video_url(url) is None


# ---------------------------------------------------------------------------
# _normalize_web_url (scraper)
# ---------------------------------------------------------------------------


def test_web_url_remove_fragment() -> None:
    # Fragment não afeta o conteúdo extraído — remove pra dedup consistente
    assert (
        _normalize_web_url("https://blog.example.com/post#section-2")
        == "https://blog.example.com/post"
    )


def test_web_url_preserve_query() -> None:
    # Query string PODE afetar conteúdo — preservar
    result = _normalize_web_url("https://blog.example.com/post?id=42")
    assert result == "https://blog.example.com/post?id=42"


@pytest.mark.parametrize(
    "url",
    [
        "ftp://example.com/file.txt",
        "file:///etc/passwd",
        "",
        "not a url",
        "//no-scheme.com",
    ],
)
def test_web_url_rejects(url: str) -> None:
    assert _normalize_web_url(url) is None


@pytest.mark.parametrize(
    "url,expected",
    [
        # Repo root → README via HEAD
        (
            "https://github.com/vercel/next.js",
            "https://raw.githubusercontent.com/vercel/next.js/HEAD/README.md",
        ),
        (
            "https://www.github.com/anthropics/sdk",
            "https://raw.githubusercontent.com/anthropics/sdk/HEAD/README.md",
        ),
        # /blob/<branch>/<path>
        (
            "https://github.com/facebook/react/blob/main/README.md",
            "https://raw.githubusercontent.com/facebook/react/main/README.md",
        ),
        (
            "https://github.com/owner/repo/blob/dev/docs/intro.md",
            "https://raw.githubusercontent.com/owner/repo/dev/docs/intro.md",
        ),
        # /tree/<branch>/<path> → README do dir
        (
            "https://github.com/owner/repo/tree/main/packages/cli",
            "https://raw.githubusercontent.com/owner/repo/main/packages/cli/README.md",
        ),
        # Gist
        (
            "https://gist.github.com/octocat/abc123def456",
            "https://gist.githubusercontent.com/octocat/abc123def456/raw",
        ),
    ],
)
def test_web_url_github_normalizes_to_raw(url: str, expected: str) -> None:
    assert _normalize_web_url(url) == expected


def test_web_url_news_sites_unchanged() -> None:
    """Sites de notícias estáticos passam sem normalização — Trafilatura
    extrai bem deles."""
    cases = [
        "https://g1.globo.com/tecnologia/noticia/2026/01/01/foo.ghtml",
        "https://www1.folha.uol.com.br/colunas/foo.shtml",
        "https://www.bbc.com/portuguese/foo",
        "https://techcrunch.com/2026/01/01/post/",
    ]
    for url in cases:
        # Espera retorno = input (apenas fragment removido se houver)
        assert _normalize_web_url(url) == url


# ---------------------------------------------------------------------------
# OpenRouter web_search server tool
# ---------------------------------------------------------------------------


def test_web_search_payload_uses_openrouter_server_tool() -> None:
    payload = _build_web_search_payload("openai/gpt-5.2:online", "notícias de IA hoje")

    assert payload["model"] == "openai/gpt-5.2"
    assert payload["tools"] == [
        {
            "type": "openrouter:web_search",
            "parameters": {"max_results": 8, "max_total_results": 15},
        }
    ]
    assert "plugins" not in payload


# ---------------------------------------------------------------------------
# search_transcripts — query expansion + scoping por userId (spec 047)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_search_transcripts_forwards_expanded_tsquery_and_user_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    async def fake_search(user_id, query, limit, tsquery_expr):  # type: ignore[no-untyped-def]
        captured["user_id"] = user_id
        captured["query"] = query
        captured["limit"] = limit
        captured["tsquery_expr"] = tsquery_expr
        return [{"id": "t1", "title": "A", "snippet": "x", "rank": 0.5}]

    monkeypatch.setattr(tools.db, "search_user_transcripts", fake_search)

    res = await execute_tool("search_transcripts", {"query": "marketing digital"}, "user-42")

    # Escopo por userId vindo do handler, nunca do args (R6)
    assert captured["user_id"] == "user-42"
    # Expansão é repassada e contém OR + prefix (R1)
    expr = str(captured["tsquery_expr"])
    assert "|" in expr and ":*" in expr
    assert res["results"][0]["id"] == "t1"


@pytest.mark.asyncio
async def test_search_transcripts_empty_query_does_not_hit_db(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    spy = AsyncMock()
    monkeypatch.setattr(tools.db, "search_user_transcripts", spy)

    res = await execute_tool("search_transcripts", {"query": "   "}, "user-1")

    assert "error" in res
    spy.assert_not_called()


@pytest.mark.asyncio
async def test_search_transcripts_dedupes_result_shape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A tsquery OR única já deduplica por linha no Postgres; o retorno preserva
    # uma entrada por id e mantém o contrato (id/title/snippet/rank).
    async def fake_search(user_id, query, limit, tsquery_expr):  # type: ignore[no-untyped-def]
        return [
            {"id": "t1", "title": "A", "snippet": "s1", "rank": 0.9},
            {"id": "t2", "title": "B", "snippet": "s2", "rank": 0.4},
        ]

    monkeypatch.setattr(tools.db, "search_user_transcripts", fake_search)

    res = await execute_tool("search_transcripts", {"query": "vendas"}, "u")

    ids = [r["id"] for r in res["results"]]
    assert ids == ["t1", "t2"]
    assert len(ids) == len(set(ids))
    assert set(res["results"][0]) == {"id", "title", "snippet", "rank"}


def test_extract_url_citations_from_openrouter_annotations() -> None:
    citations = _extract_url_citations(
        {
            "annotations": [
                {
                    "type": "url_citation",
                    "url_citation": {"url": "https://example.com/a", "title": "Fonte A"},
                },
                {"type": "other"},
            ]
        }
    )

    assert citations == [{"url": "https://example.com/a", "title": "Fonte A"}]
