"""Scraper de páginas web via Trafilatura (spec 004).

Baixa HTML, respeita robots.txt, extrai conteúdo principal + metadata em
markdown limpo. Sem JS-heavy/SPAs (cobertura ~80% das páginas — blogs, news,
docs, wikis). Sites JS-only retornam conteúdo curto → Job FAILED.

Trafilatura: MIT, F1=0.958 em benchmarks (vs Readability 0.947, Newspaper4k
0.949, Goose3 0.896). Output markdown nativo.

Proteção SSRF: bloqueia hostname privado/loopback/metadata IMDS + DNS interno
docker; segue redirects manualmente revalidando cada hop.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx
import structlog
import trafilatura
from trafilatura.metadata import Document

log = structlog.get_logger(__name__)

USER_AGENT = "VoxenBot/1.0 (+https://github.com/Yefclub/Voxen)"
MIN_CONTENT_CHARS = 200
REQUEST_TIMEOUT = httpx.Timeout(connect=10.0, read=20.0, write=10.0, pool=5.0)
MAX_REDIRECTS = 5
MAX_BODY_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_ROBOTS_BYTES = 256 * 1024  # 256 KB

# Hostnames bloqueados literais — serviços internos do compose voxen-net
# (impede ataque por DNS interno do docker).
_BLOCKED_HOSTNAMES = frozenset(
    {
        "localhost",
        "postgres",
        "redis",
        "minio",
        "chat",
        "web",
        "worker",
        "minio-init",
    }
)


class ScraperError(Exception):
    """Base — falha esperada do scraper que vira errorMsg do Job."""


class RobotsBlockedError(ScraperError):
    """robots.txt do site proíbe acesso."""


class FetchBlockedError(ScraperError):
    """Site retornou 403/429/4xx OU URL aponta pra host privado/interno."""


class FetchTransientError(ScraperError):
    """Timeout, 5xx, rede — retry vale a pena."""


class EmptyContentError(ScraperError):
    """Conteúdo extraído curto demais — provavelmente paywall/JS-heavy."""


def _is_private_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _resolve_and_validate(host: str) -> set[str]:
    """Resolve hostname → set de IPs públicos. Levanta FetchBlockedError se
    algum IP for privado/interno. Retorna o set pra ser usado em validação
    pós-GET (detectar DNS rebinding via response.extensions).
    """
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as e:
        raise FetchBlockedError(f"Host não resolve: {host}") from e
    ips: set[str] = set()
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if _is_private_ip(ip):
            raise FetchBlockedError("Host privado/interno não permitido. Use URL pública.")
        ips.add(str(ip))
    if not ips:
        raise FetchBlockedError(f"Nenhum IP resolvido pra {host}.")
    return ips


def _assert_public_host(url: str) -> set[str]:
    """Bloqueia SSRF — rejeita hosts privados, loopback, metadata IMDS e
    nomes internos do docker network. Retorna o set de IPs públicos resolvidos
    (pra validação pós-GET contra DNS rebinding).

    Raises FetchBlockedError com mensagem segura (sem vazar detalhes do alvo).
    """
    try:
        parsed = urlparse(url)
    except ValueError as e:
        raise FetchBlockedError("URL malformada.") from e
    if parsed.scheme not in ("http", "https"):
        raise FetchBlockedError("Esquema não suportado — use http ou https.")
    host = (parsed.hostname or "").lower()
    if not host:
        raise FetchBlockedError("URL sem hostname.")
    if host in _BLOCKED_HOSTNAMES:
        raise FetchBlockedError("Host interno não permitido. Use URL pública.")
    return _resolve_and_validate(host)


def _assert_peer_ip_public(response: httpx.Response, expected_ips: set[str]) -> None:
    """Pós-GET: extrai o IP do peer e bloqueia se for privado.

    Defesa contra DNS rebinding: o atacante faz domínio público resolver
    momentaneamente pra IP privado/interno. Aqui pegamos o IP REAL usado pela
    conexão e bloqueamos se for privado — esse é o vetor que importa.

    **NÃO** comparamos contra `expected_ips` (set pré-resolvido):
    - Sites grandes (CDN/load balancer) têm N IPs públicos via round-robin
    - getaddrinfo pode retornar subset diferente a cada call
    - Peer IP fora do set inicial mas público = legítimo, não rebinding
    - Comparação estrita gerava false positives bloqueando sites reais

    `expected_ips` mantido na assinatura por compat (logado pra debug).

    httpx 0.27+ expõe `response.extensions['network_stream']` que tem
    `get_extra_info('server_addr')` → (ip, port).
    """
    _ = expected_ips  # mantido por compat
    stream = response.extensions.get("network_stream")
    if stream is None:
        return
    try:
        server_addr = stream.get_extra_info("server_addr")
    except Exception:  # noqa: BLE001
        return
    if not server_addr:
        return
    peer_ip_str = server_addr[0] if isinstance(server_addr, tuple) else server_addr
    try:
        peer_ip = ipaddress.ip_address(peer_ip_str)
    except (ValueError, TypeError):
        return
    if _is_private_ip(peer_ip):
        raise FetchBlockedError("DNS rebinding detectado — conexão caiu em IP privado/interno.")


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
    """Baixa a URL (com SSRF protection + redirect manual), valida robots,
    extrai via Trafilatura.

    Raises:
        FetchBlockedError: URL aponta pra host privado/interno, 4xx do alvo,
                           ou esquema inválido
        RobotsBlockedError: robots.txt proíbe acesso
        FetchTransientError: timeout/5xx (retry)
        EmptyContentError: conteúdo < MIN_CONTENT_CHARS
    """
    expected_ips = _assert_public_host(url)

    # Lê admin_email opcional pra header `From:` (RFC 7231 §5.5.1 — boa-prática
    # pra sites identificarem o operador do bot). Best-effort: se settings DB
    # estiver inacessível, segue sem o header.
    admin_email: str | None = None
    try:
        from . import voxen_settings

        admin_email = await voxen_settings.get_admin_email()
    except Exception:  # noqa: BLE001
        admin_email = None

    await _check_robots(url)

    final_url, html = await _fetch_with_manual_redirects(
        url, admin_email=admin_email, expected_ips=expected_ips
    )

    extracted_md = trafilatura.extract(
        html,
        url=final_url,
        output_format="markdown",
        include_links=True,
        include_images=False,
        include_tables=True,
        include_comments=False,
        favor_precision=True,
        with_metadata=True,
    )
    if not extracted_md or len(extracted_md.strip()) < MIN_CONTENT_CHARS:
        raise EmptyContentError("Conteúdo insuficiente — página vazia, paywall, ou JS-heavy.")

    plain = (
        trafilatura.extract(
            html,
            url=final_url,
            output_format="txt",
            include_links=False,
            include_images=False,
            favor_precision=True,
        )
        or extracted_md
    )

    metadata = trafilatura.extract_metadata(html, default_url=final_url)
    title, site_name, author, published, thumb, lang = _unpack_metadata(metadata, final_url)

    return ScrapeResult(
        url=final_url,
        title=title,
        site_name=site_name,
        author=author,
        published_at=published,
        thumbnail_url=thumb,
        language=lang,
        markdown=extracted_md,
        plain_text=plain,
    )


async def _fetch_with_manual_redirects(
    url: str,
    *,
    admin_email: str | None = None,
    expected_ips: set[str] | None = None,
) -> tuple[str, str]:
    """Faz GET seguindo até MAX_REDIRECTS, **revalidando** cada hop contra SSRF.

    Retorna (URL final, body). Limita o body a MAX_BODY_BYTES.
    `admin_email`, se passado, vira header `From:` (boa-prática RFC 7231).
    `expected_ips`: set de IPs pré-validados pra detecção de DNS rebinding
    pós-GET (response.extensions.network_stream). Se None, pula a checagem.
    """
    current = url
    current_expected = expected_ips
    headers: dict[str, str] = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,*/*;q=0.8",
    }
    if admin_email:
        headers["From"] = admin_email
    async with httpx.AsyncClient(
        timeout=REQUEST_TIMEOUT,
        follow_redirects=False,
        headers=headers,
    ) as client:
        for _ in range(MAX_REDIRECTS + 1):
            try:
                res = await client.get(current)
            except (httpx.TimeoutException, httpx.NetworkError) as e:
                raise FetchTransientError(f"Rede/timeout: {e}") from e

            # Pós-GET: detecta DNS rebinding TOCTOU (peer IP ≠ IPs validados)
            if current_expected is not None:
                _assert_peer_ip_public(res, current_expected)

            # Redirect manual (3xx com Location)
            if res.status_code in (301, 302, 303, 307, 308):
                location = res.headers.get("Location")
                if not location:
                    raise FetchBlockedError("Redirect sem Location.")
                next_url = urljoin(current, location)
                current_expected = _assert_public_host(next_url)
                current = next_url
                continue

            if res.status_code in (403, 429):
                raise FetchBlockedError(
                    f"Site bloqueou acesso (HTTP {res.status_code}). "
                    "Sites com proteção anti-bot não são suportados."
                )
            if 400 <= res.status_code < 500:
                raise FetchBlockedError(f"Site retornou HTTP {res.status_code}.")
            if 500 <= res.status_code < 600:
                raise FetchTransientError(f"Servidor retornou HTTP {res.status_code}.")

            content_length = res.headers.get("Content-Length")
            if content_length and int(content_length) > MAX_BODY_BYTES:
                raise FetchBlockedError(
                    f"Página grande demais ({content_length} bytes; máx {MAX_BODY_BYTES})."
                )
            body = res.content
            if len(body) > MAX_BODY_BYTES:
                raise FetchBlockedError(
                    f"Página grande demais ({len(body)} bytes; máx {MAX_BODY_BYTES})."
                )
            try:
                text = body.decode(res.encoding or "utf-8", errors="replace")
            except (LookupError, UnicodeDecodeError):
                text = body.decode("utf-8", errors="replace")
            if not text.strip():
                raise EmptyContentError("HTML vazio.")
            return str(res.url), text

    raise FetchBlockedError(f"Excesso de redirects (>{MAX_REDIRECTS}).")


def _unpack_metadata(
    metadata: Document | None, url: str
) -> tuple[str, str | None, str | None, datetime | None, str | None, str | None]:
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
    """Best-effort robots.txt. SSRF-protected. Falha silenciosa = permitir."""
    try:
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.hostname:
            raise FetchBlockedError("URL malformada.")
        robots_url = f"{parsed.scheme}://{parsed.hostname}/robots.txt"
        # Re-valida o host (retorna IPs pra detecção pós-GET de DNS rebinding)
        robots_ips = _assert_public_host(robots_url)
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=5.0, write=5.0, pool=5.0),
            follow_redirects=False,
            headers={"User-Agent": USER_AGENT},
        ) as client:
            try:
                res = await client.get(robots_url)
            except (httpx.TimeoutException, httpx.NetworkError):
                return  # permite
            # Detecta rebinding tb no robots fetch (defesa em profundidade)
            _assert_peer_ip_public(res, robots_ips)
        if res.status_code != 200:
            return
        body = res.content[:MAX_ROBOTS_BYTES]
        text = body.decode(res.encoding or "utf-8", errors="replace")
        parser = RobotFileParser()
        parser.parse(text.splitlines())
        if not parser.can_fetch(USER_AGENT, url):
            raise RobotsBlockedError("robots.txt do site proíbe scraping.")
    except (RobotsBlockedError, FetchBlockedError):
        raise
    except Exception:  # noqa: BLE001 — robots é best-effort
        log.debug("robots-check-failed-silently", url=url)
        return


# Compat com tests que possam ter referenciado o helper antigo
__all__ = [
    "ScrapeResult",
    "fetch_and_extract",
    "ScraperError",
    "RobotsBlockedError",
    "FetchBlockedError",
    "FetchTransientError",
    "EmptyContentError",
]

# Silencia warning de import unused (asyncio mantido pra uso futuro de gather)
_ = asyncio
