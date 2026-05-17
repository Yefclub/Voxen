"""Testes do scraper Trafilatura (sem rede — usa HTML estático)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from src import scraper

# HTML mínimo válido pra Trafilatura extrair
SAMPLE_HTML = """<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <title>Como aprender Python rápido</title>
  <meta name="author" content="João Silva">
  <meta property="og:site_name" content="Blog Tech">
  <meta property="og:image" content="https://example.com/cover.jpg">
  <meta property="article:published_time" content="2026-01-15">
</head>
<body>
  <nav>Menu — Home About</nav>
  <article>
    <h1>Como aprender Python rápido</h1>
    <p>Python é uma linguagem de programação versátil e poderosa, usada em ciência
    de dados, web development, automação e muito mais. Neste artigo vamos cobrir
    os fundamentos essenciais para você começar a programar em Python de forma
    eficiente. Vamos abordar instalação, sintaxe básica, estruturas de dados
    fundamentais como listas e dicionários, e como organizar seu código em
    funções e módulos. Ao final você terá uma base sólida pra continuar aprendendo
    e construir seus próprios projetos. A comunidade Python é uma das mais
    acolhedoras e há muito material gratuito disponível na internet.</p>
  </article>
  <footer>© 2026 Blog Tech</footer>
</body>
</html>
"""


async def _fake_get(html: str, status: int = 200) -> AsyncMock:
    response = MagicMock()
    response.status_code = status
    response.text = html
    return response


@pytest.fixture
def _no_robots(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pula a checagem de robots.txt nos testes (sem rede)."""

    async def _noop(url: str) -> None:
        return

    monkeypatch.setattr(scraper, "_check_robots", _noop)


async def test_fetch_and_extract_happy_path(_no_robots: None) -> None:
    async def fake_get(self: httpx.AsyncClient, url: str) -> object:
        return await _fake_get(SAMPLE_HTML)

    with patch.object(httpx.AsyncClient, "get", fake_get):
        result = await scraper.fetch_and_extract("https://example.com/post")

    assert result.title.startswith("Como aprender")
    assert "Python" in result.markdown
    assert len(result.plain_text) > 200
    assert result.url == "https://example.com/post"


async def test_empty_content_raises(_no_robots: None) -> None:
    async def fake_get(self: httpx.AsyncClient, url: str) -> object:
        return await _fake_get("<html><body><p>oi</p></body></html>")

    with patch.object(httpx.AsyncClient, "get", fake_get):
        with pytest.raises(scraper.EmptyContentError):
            await scraper.fetch_and_extract("https://example.com/short")


async def test_blocked_403(_no_robots: None) -> None:
    async def fake_get(self: httpx.AsyncClient, url: str) -> object:
        return await _fake_get("", status=403)

    with patch.object(httpx.AsyncClient, "get", fake_get):
        with pytest.raises(scraper.FetchBlockedError):
            await scraper.fetch_and_extract("https://blocked.example.com/")


async def test_transient_5xx(_no_robots: None) -> None:
    async def fake_get(self: httpx.AsyncClient, url: str) -> object:
        return await _fake_get("", status=503)

    with patch.object(httpx.AsyncClient, "get", fake_get):
        with pytest.raises(scraper.FetchTransientError):
            await scraper.fetch_and_extract("https://flaky.example.com/")
