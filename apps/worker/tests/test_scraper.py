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
    body = html.encode("utf-8")
    response.content = body
    response.encoding = "utf-8"
    response.url = "https://example.com/post"
    response.headers = {"Content-Length": str(len(body))}
    return response


@pytest.fixture
def _no_robots(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pula robots.txt + SSRF check (testes não-SSRF não dependem de DNS real)."""

    async def _noop(url: str) -> None:
        return

    def _public_noop(url: str) -> None:
        return

    monkeypatch.setattr(scraper, "_check_robots", _noop)
    monkeypatch.setattr(scraper, "_assert_public_host", _public_noop)


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


# ---------------------------------------------------------------------------
# SSRF protection tests — rejeitar IPs privados, loopback, metadata IMDS,
# nomes internos do docker network.
# ---------------------------------------------------------------------------


def _mock_dns(monkeypatch: pytest.MonkeyPatch, ip: str) -> None:
    """Faz getaddrinfo retornar IP fixo (sem rede)."""
    import socket

    def fake_getaddrinfo(host: str, port: object, *args: object, **kw: object) -> list:
        return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", (ip, 0))]

    monkeypatch.setattr(scraper.socket, "getaddrinfo", fake_getaddrinfo)


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1",  # loopback
        "10.0.0.1",  # rede privada
        "172.16.0.1",  # rede privada
        "192.168.0.1",  # rede privada
        "169.254.169.254",  # link-local (metadata IMDS AWS/GCP/Azure)
        "0.0.0.0",  # noqa: S104 — string de teste, não bind socket; representa unspecified
        "224.0.0.1",  # multicast
    ],
)
async def test_ssrf_blocks_private_ips(monkeypatch: pytest.MonkeyPatch, ip: str) -> None:
    _mock_dns(monkeypatch, ip)
    with pytest.raises(scraper.FetchBlockedError):
        await scraper.fetch_and_extract("https://example.com/")


@pytest.mark.parametrize(
    "host", ["localhost", "chat", "postgres", "redis", "garage", "web", "worker"]
)
async def test_ssrf_blocks_internal_hostnames(host: str) -> None:
    with pytest.raises(scraper.FetchBlockedError):
        await scraper.fetch_and_extract(f"http://{host}/anything")


async def test_ssrf_blocks_non_http_scheme() -> None:
    with pytest.raises(scraper.FetchBlockedError):
        await scraper.fetch_and_extract("file:///etc/passwd")
    with pytest.raises(scraper.FetchBlockedError):
        await scraper.fetch_and_extract("ftp://example.com/")


async def test_redirect_to_private_ip_is_blocked(
    monkeypatch: pytest.MonkeyPatch, _no_robots: None
) -> None:
    """Site público que faz 302 pra IP privado → bloqueia no 2º hop."""
    import socket

    # Primeira chamada: example.com resolve pra IP público falso (1.2.3.4)
    # Segunda: o redirect aponta pra http://10.0.0.1/ → bloqueio
    call_count = {"n": 0}

    def fake_getaddrinfo(host: str, *args: object, **kw: object) -> list:
        call_count["n"] += 1
        if host == "example.com":
            return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("1.2.3.4", 0))]
        # qualquer outro host (10.0.0.1 etc) — devolve o próprio
        return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", (host, 0))]

    monkeypatch.setattr(scraper.socket, "getaddrinfo", fake_getaddrinfo)

    redirect_response = MagicMock()
    redirect_response.status_code = 302
    redirect_response.headers = {"Location": "http://10.0.0.1/internal"}

    async def fake_get(self: httpx.AsyncClient, url: str) -> object:
        return redirect_response

    with patch.object(httpx.AsyncClient, "get", fake_get):
        with pytest.raises(scraper.FetchBlockedError):
            await scraper.fetch_and_extract("https://example.com/")
