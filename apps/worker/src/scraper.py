"""Scraper de páginas web via Trafilatura (spec 004).

Baixa HTML, respeita robots.txt, extrai conteúdo principal + metadata em
markdown limpo. Sem JS-heavy/SPAs (cobertura ~80% das páginas — blogs, news,
docs, wikis). Sites JS-only retornam conteúdo curto → Job FAILED.

Trafilatura: MIT, F1=0.958 em benchmarks (vs Readability 0.947, Newspaper4k
0.949, Goose3 0.896). Output markdown nativo.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx
import structlog
import trafilatura
from trafilatura.metadata import Document

log = structlog.get_logger(__name__)

USER_AGENT = "VoxenBot/1.0 (+https://github.com/YefClub-Org/Voxen)"
MIN_CONTENT_CHARS = 200
REQUEST_TIMEOUT = 30.0


class ScraperError(Exception):
    """Base — falha esperada do scraper que vira errorMsg do Job."""


class RobotsBlockedError(ScraperError):
    """robots.txt do site proíbe acesso."""


class FetchBlockedError(ScraperError):
    """Site retornou 403/429/4xx → não retentar."""


class FetchTransientError(ScraperError):
    """Timeout, 5xx, rede — retry vale a pena."""


class EmptyContentError(ScraperError):
    """Conteúdo extraído curto demais — provavelmente paywall/JS-heavy."""


@dataclass(frozen=True)
class ScrapeResult:
    url: str
    title: str
    site_name: str | None
    author: str | None
    published_at: datetime | None
    thumbnail_url: str | None
    language: str | None
    markdown: str
    plain_text: str


async def fetch_and_extract(url: str) -> ScrapeResult:
    """Baixa a URL, valida robots.txt, extrai via Trafilatura, retorna ScrapeResult.

    Raises:
        RobotsBlockedError: robots.txt proíbe acesso
        FetchBlockedError: 403/429/4xx (permanente)
        FetchTransientError: timeout/5xx (retry)
        EmptyContentError: conteúdo < MIN_CONTENT_CHARS
    """
    await _check_robots(url)

    async with httpx.AsyncClient(
        timeout=REQUEST_TIMEOUT,
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*;q=0.8"},
    ) as client:
        try:
            res = await client.get(url)
        except (httpx.TimeoutException, httpx.NetworkError) as e:
            raise FetchTransientError(f"Rede/timeout: {e}") from e

    if res.status_code in (403, 429):
        raise FetchBlockedError(
            f"Site bloqueou acesso (HTTP {res.status_code}). "
            "Sites com proteção anti-bot não são suportados."
        )
    if 400 <= res.status_code < 500:
        raise FetchBlockedError(f"Site retornou HTTP {res.status_code}.")
    if 500 <= res.status_code < 600:
        raise FetchTransientError(f"Servidor retornou HTTP {res.status_code}.")

    html = res.text
    if not html:
        raise EmptyContentError("HTML vazio.")

    # Trafilatura: extração + metadata em uma chamada só
    extracted_md = trafilatura.extract(
        html,
        url=url,
        output_format="markdown",
        include_links=True,
        include_images=False,
        include_tables=True,
        include_comments=False,
        favor_precision=True,
        with_metadata=True,
    )
    if not extracted_md or len(extracted_md.strip()) < MIN_CONTENT_CHARS:
        raise EmptyContentError(
            "Conteúdo insuficiente — página vazia, paywall, ou JS-heavy."
        )

    # Plain text separado pra FTS (sem markdown syntax)
    plain = trafilatura.extract(
        html,
        url=url,
        output_format="txt",
        include_links=False,
        include_images=False,
        favor_precision=True,
    ) or extracted_md

    # Metadata estruturada
    metadata = trafilatura.extract_metadata(html, default_url=url)
    title, site_name, author, published, thumb, lang = _unpack_metadata(metadata, url)

    return ScrapeResult(
        url=url,
        title=title,
        site_name=site_name,
        author=author,
        published_at=published,
        thumbnail_url=thumb,
        language=lang,
        markdown=extracted_md,
        plain_text=plain,
    )


def _unpack_metadata(
    metadata: Document | None, url: str
) -> tuple[str, str | None, str | None, datetime | None, str | None, str | None]:
    """Extrai campos da Document do Trafilatura com defaults."""
    if metadata is None:
        return _hostname_title(url), None, None, None, None, None
    title = (metadata.title or "").strip() or _hostname_title(url)
    site_name = (metadata.sitename or "").strip() or None
    author = (metadata.author or "").strip() or None
    thumb = (metadata.image or "").strip() or None
    lang = (metadata.language or "").strip() or None
    published: datetime | None = None
    if metadata.date:
        try:
            # Trafilatura devolve YYYY-MM-DD; aceita ISO completo também
            published = datetime.fromisoformat(metadata.date)
        except ValueError:
            published = None
    return title, site_name, author, published, thumb, lang


def _hostname_title(url: str) -> str:
    try:
        return urlparse(url).hostname or url
    except ValueError:
        return url


async def _check_robots(url: str) -> None:
    """Best-effort robots.txt. Falha silenciosa = permitir (não bloquear por bug)."""
    try:
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.hostname:
            raise FetchBlockedError("URL malformada.")
        robots_url = f"{parsed.scheme}://{parsed.hostname}/robots.txt"
        async with httpx.AsyncClient(
            timeout=5.0,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
        ) as client:
            try:
                res = await client.get(robots_url)
            except (httpx.TimeoutException, httpx.NetworkError):
                return  # falha silenciosa = permite
        if res.status_code != 200:
            return
        parser = RobotFileParser()
        parser.parse(res.text.splitlines())
        if not parser.can_fetch(USER_AGENT, url):
            raise RobotsBlockedError("robots.txt do site proíbe scraping.")
    except RobotsBlockedError:
        raise
    except Exception:  # noqa: BLE001 — robots é best-effort
        log.debug("robots-check-failed-silently", url=url)
        return
