"""Extrator de mídia via yt-dlp: probe, subtitles, download de áudio opus."""

from __future__ import annotations

import os
import re
import secrets
import xml.etree.ElementTree
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse, urlsplit, urlunsplit

import requests
import structlog
import yt_dlp
from youtube_transcript_api._api import YouTubeTranscriptApi
from youtube_transcript_api._errors import NoTranscriptFound, YouTubeTranscriptApiException
from youtube_transcript_api.proxies import GenericProxyConfig

from . import voxen_settings
from .transcript_md import Segment

logger = structlog.get_logger(__name__)

MAX_DURATION_SEC = 4 * 60 * 60  # 4h conforme spec 002
PREFERRED_TRANSCRIPT_LANGS = ("pt", "pt-BR", "pt-PT", "en", "en-US", "en-GB")


@dataclass(frozen=True)
class VideoProbe:
    video_id: str
    title: str
    channel: str | None
    duration_sec: int
    published_at: datetime | None
    thumbnail_url: str | None
    language_hint: str | None
    available_subtitles: dict[str, list[dict[str, Any]]]
    automatic_captions: dict[str, list[dict[str, Any]]]


@dataclass(frozen=True)
class TranscriptFetch:
    probe: VideoProbe
    segments: tuple[Segment, ...]
    language: str


def _parse_upload_date(raw: str | None) -> datetime | None:
    if not raw or len(raw) != 8:
        return None
    try:
        return datetime.strptime(raw, "%Y%m%d").replace(tzinfo=UTC)
    except ValueError:
        return None


async def fetch_youtube_transcript(url: str) -> TranscriptFetch | None:
    """Tenta buscar transcript/legenda do YouTube sem baixar midia.

    Best-effort por design: qualquer falha cai no pipeline normal do yt-dlp.
    Isso evita transformar bloqueio/rate-limit do endpoint de transcripts em
    falha definitiva antes de tentar os fallbacks existentes.
    """
    video_id = _youtube_video_id(url)
    if video_id is None:
        return None

    base_opts = await _runtime_options()
    proxy_url = base_opts.get("proxy")

    import asyncio

    return await asyncio.to_thread(_fetch_youtube_transcript_sync, video_id, proxy_url)


def _fetch_youtube_transcript_sync(video_id: str, proxy_url: str | None) -> TranscriptFetch | None:
    try:
        api = YouTubeTranscriptApi(proxy_config=_transcript_proxy_config(proxy_url))
        try:
            fetched: Any = api.fetch(video_id, languages=PREFERRED_TRANSCRIPT_LANGS)
        except NoTranscriptFound:
            fetched = _fetch_any_transcript(api, video_id)
            if fetched is None:
                return None

        segments = tuple(
            Segment(start_sec=float(snippet.start), text=_clean_cue_line(snippet.text))
            for snippet in fetched
            if snippet.text.strip()
        )
        if not segments:
            return None

        metadata = _fetch_youtube_oembed(video_id, proxy_url)
        duration_sec = _fetched_transcript_duration_sec(fetched)
        language = getattr(fetched, "language_code", None) or "auto"
        probe = VideoProbe(
            video_id=video_id,
            title=metadata.get("title") or "(sem título)",
            channel=metadata.get("author_name"),
            duration_sec=duration_sec,
            published_at=None,
            thumbnail_url=metadata.get("thumbnail_url")
            or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
            language_hint=language,
            available_subtitles={},
            automatic_captions={},
        )
        return TranscriptFetch(probe=probe, segments=segments, language=language.split("-")[0])
    except (
        OSError,
        requests.RequestException,
        YouTubeTranscriptApiException,
        xml.etree.ElementTree.ParseError,
    ):
        return None


def _fetch_any_transcript(api: YouTubeTranscriptApi, video_id: str) -> Any | None:
    transcript_list = api.list(video_id)
    for transcript in transcript_list:
        return transcript.fetch()
    return None


def _fetched_transcript_duration_sec(fetched: Any) -> int:
    max_end = 0.0
    for snippet in fetched:
        max_end = max(max_end, float(snippet.start) + float(snippet.duration))
    return max(1, int(max_end + 0.999))


def _fetch_youtube_oembed(video_id: str, proxy_url: str | None) -> dict[str, str]:
    url = f"https://www.youtube.com/watch?v={video_id}"
    query = urlencode({"url": url, "format": "json"})
    try:
        resp = requests.get(
            f"https://www.youtube.com/oembed?{query}",
            timeout=10,
            proxies=_requests_proxy_dict(proxy_url),
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException:
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): str(v) for k, v in data.items() if isinstance(v, str)}


def _transcript_proxy_config(proxy_url: str | None) -> GenericProxyConfig | None:
    if not _is_supported_proxy(proxy_url):
        return None
    return GenericProxyConfig(http_url=proxy_url, https_url=proxy_url)


def _requests_proxy_dict(proxy_url: str | None) -> dict[str, str] | None:
    if not _is_supported_proxy(proxy_url):
        return None
    assert proxy_url is not None  # garantido por _is_supported_proxy
    return {"http": proxy_url, "https": proxy_url}


# Esquemas de proxy aceitos. yt-dlp suporta SOCKS nativamente; para os caminhos
# que usam `requests` (oEmbed) e `youtube-transcript-api` (GenericProxyConfig →
# requests por baixo), o SOCKS depende do PySocks (extra `requests[socks]`).
# Prefira `socks5h://` (resolução de DNS via proxy) para evitar vazar consultas
# DNS pelo host local; `socks5://` também é aceito.
_SUPPORTED_PROXY_SCHEMES = ("http://", "https://", "socks5://", "socks5h://")


def _is_supported_proxy(proxy_url: str | None) -> bool:
    return bool(proxy_url and proxy_url.startswith(_SUPPORTED_PROXY_SCHEMES))


def _mask_proxy(url: str) -> str:
    """Remove o userinfo (usuário:senha) de uma URL de proxy para log seguro.

    Preserva esquema + host + porta. Ex.: `socks5h://127.0.0.1:1080` continua
    legível; `http://user:pass@host:8080` vira `http://host:8080`. NUNCA devolve
    a string crua quando há risco de userinfo embutido — robusto a URL malformada.
    """
    try:
        parsed = urlsplit(url)
    except ValueError:
        return "<proxy oculto>"

    scheme = parsed.scheme
    # Só confiamos no parse quando o esquema é um proxy conhecido. Sem esquema
    # ("user:secret@host:1080" cai inteiro em .path) OU pseudo-esquema — ex.:
    # "myuser:senha@host:1080", onde urlsplit lê "myuser" como scheme e o
    # username VAZARIA no fallback `f"{scheme}://..."` — caem aqui e são ocultados.
    if f"{scheme}://" not in _SUPPORTED_PROXY_SCHEMES:
        return "<proxy oculto>"

    try:
        host = parsed.hostname
        port = parsed.port
    except ValueError:
        # Porta inválida / parse de netloc falhou: não arrisca vazar userinfo.
        return f"{scheme}://<host oculto>"

    if not host:
        return f"{scheme}://<host oculto>"

    netloc = f"{host}:{port}" if port is not None else host
    return urlunsplit((scheme, netloc, "", "", ""))


def _youtube_video_id(url: str) -> str | None:
    try:
        u = urlparse(url)
    except ValueError:
        return None
    if u.scheme not in ("http", "https") or not u.hostname:
        return None

    host = u.hostname.lower()
    for prefix in ("www.", "m.", "mobile.", "music."):
        if host.startswith(prefix):
            host = host[len(prefix) :]
            break

    video_id: str | None
    if host == "youtu.be":
        video_id = u.path.lstrip("/").split("/")[0]
    elif host == "youtube.com":
        path = u.path.rstrip("/")
        if path == "/watch":
            values = parse_qs(u.query).get("v")
            video_id = values[0] if values else None
        elif path.startswith(("/shorts/", "/embed/", "/v/")):
            video_id = path.split("/")[2]
        else:
            video_id = None
    else:
        video_id = None

    if video_id and re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        return video_id
    return None


async def probe(url: str) -> VideoProbe:
    """Extrai metadata SEM baixar áudio (`skip_download=True`)."""
    base_opts = await _runtime_options()
    opts = {
        **base_opts,
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
        "writesubtitles": False,
        "writeautomaticsub": False,
    }
    # yt-dlp é sync — chamamos em thread pra não bloquear o loop
    import asyncio

    info = await asyncio.to_thread(_extract_info, url, opts)
    return VideoProbe(
        video_id=info["id"],
        title=info.get("title") or "(sem título)",
        channel=info.get("channel") or info.get("uploader"),
        duration_sec=int(info.get("duration") or 0),
        published_at=_parse_upload_date(info.get("upload_date")),
        thumbnail_url=info.get("thumbnail"),
        language_hint=info.get("language"),
        available_subtitles=info.get("subtitles") or {},
        automatic_captions=info.get("automatic_captions") or {},
    )


def _extract_info(url: str, opts: dict[str, Any]) -> dict[str, Any]:
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
        if info is None:
            raise RuntimeError("yt-dlp não retornou metadata")
        # extract_info pode devolver playlist; pegamos primeiro item
        if "entries" in info and info["entries"]:
            return info["entries"][0]  # type: ignore[no-any-return]
        return info  # type: ignore[no-any-return]


def pick_subtitle_lang(probe_info: VideoProbe) -> tuple[str, str] | None:
    """Retorna (lang, format) se há legenda manual ou auto. Prefere PT, depois EN, depois qq."""
    pools: list[dict[str, list[dict[str, Any]]]] = [
        probe_info.available_subtitles,
        probe_info.automatic_captions,
    ]
    for pool in pools:
        for lang in ("pt", "pt-BR", "pt-PT", "en", "en-US"):
            if lang in pool:
                fmt = _best_subtitle_format(pool[lang])
                if fmt:
                    return lang, fmt
        # Fallback: qualquer idioma disponível
        for lang, formats in pool.items():
            fmt = _best_subtitle_format(formats)
            if fmt:
                return lang, fmt
    return None


def _best_subtitle_format(formats: list[dict[str, Any]]) -> str | None:
    """Prefere vtt; fallback srt; depois json3."""
    by_ext = {f["ext"]: f for f in formats if "ext" in f}
    for ext in ("vtt", "srt", "json3"):
        if ext in by_ext:
            return ext
    return None


async def download_subtitle(url: str, lang: str, fmt: str, out_dir: Path) -> Path:
    """Baixa apenas a legenda. Retorna path do arquivo .vtt/.srt.

    yt-dlp pode salvar com qualquer das variantes (`pt`, `pt-BR`, `pt-orig`,
    etc). Tentamos vários lang codes na requisição e fazemos glob amplo
    `*.{fmt}` no diretório dedicado do job.
    """
    import asyncio

    # Inclui variantes do lang pedido + base (pt-BR → pt)
    base_opts = await _runtime_options()
    lang_variants = list(dict.fromkeys([lang, lang.split("-")[0]]))
    out_template = str(out_dir / "%(id)s.%(ext)s")
    opts = {
        **base_opts,
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": lang_variants,
        "subtitlesformat": fmt,
        "quiet": True,
        "no_warnings": True,
        "outtmpl": out_template,
    }
    # download=True faz o yt-dlp escrever os arquivos de legenda.
    # Com skip_download=True, NÃO baixa o vídeo, apenas as legendas.
    await asyncio.to_thread(_run_download, url, opts)
    # tmpdir é exclusivo do job, então `*.{fmt}` é seguro
    candidates = sorted(out_dir.glob(f"*.{fmt}"))
    if not candidates:
        all_files = sorted(p.name for p in out_dir.iterdir())
        raise RuntimeError(
            f"Legenda não baixada (esperado *.{fmt} em {out_dir}). Arquivos: {all_files}"
        )
    return candidates[0]


async def download_audio_opus(url: str, out_dir: Path) -> Path:
    """Extrai áudio como opus mono 16kHz 32kbps (spec 002)."""
    import asyncio

    base_opts = await _runtime_options()
    out_template = str(out_dir / "%(id)s.%(ext)s")
    opts = {
        **base_opts,
        # Prefere áudio puro; senão o melhor formato que TENHA faixa de áudio
        # (`best*[acodec!=none]`) antes de cair no `best` genérico — evita baixar
        # um rendition só-vídeo (ex.: alguns reels do Instagram) que faria o
        # FFmpegExtractAudio estourar no ffprobe ("unable to obtain file audio codec").
        "format": "bestaudio/best*[acodec!=none]/best",
        "outtmpl": out_template,
        "quiet": True,
        "no_warnings": True,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "opus",
                "preferredquality": "32",
            },
        ],
        "postprocessor_args": [
            "-ac",
            "1",
            "-ar",
            "16000",
            "-b:a",
            "32k",
        ],
    }
    await asyncio.to_thread(_run_download, url, opts)
    files = list(out_dir.glob("*.opus")) + list(out_dir.glob("*.ogg"))
    if not files:
        raise RuntimeError("Áudio opus não foi gerado")
    return files[0]


def _run_download(url: str, opts: dict[str, Any]) -> None:
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])


async def _runtime_options() -> dict[str, Any]:
    """Opções base do yt-dlp.

    A única configuração runtime suportada é um proxy opcional controlado pelo
    operador do deploy (setting `yt_dlp_proxy_urls`, ou env `YTDLP_PROXY_URLS`).
    Aceita `http(s)://` e `socks5(h)://` (prefira `socks5h://` p/ DNS via proxy).
    Em deploys home-lab (IP residencial), o proxy normalmente não é necessário.
    Em VPS o YouTube tende a bloquear; o fluxo recomendado é upload manual ou
    proxy residencial controlado pelo operador.
    """
    opts: dict[str, Any] = {
        "retries": 3,
        "fragment_retries": 3,
        "extractor_retries": 3,
        "socket_timeout": 30,
        "noplaylist": True,
        "geo_bypass": True,
    }

    bgutil_base_url = (
        os.environ.get("YTDLP_BGUTIL_BASE_URL") or os.environ.get("YTDLP_POT_PROVIDER_URL") or ""
    ).strip()
    if bgutil_base_url:
        opts["extractor_args"] = {
            "youtube": {"player_client": ["mweb"]},
            "youtubepot-bgutilhttp": {"base_url": [bgutil_base_url]},
        }

    proxy_urls_raw = (
        await voxen_settings.get_yt_dlp_proxy_urls()
        or os.environ.get("YTDLP_PROXY_URLS")
        or os.environ.get("YTDLP_PROXY_URL")
        or ""
    )
    proxy_urls = [line.strip() for line in re.split(r"[\n,]+", proxy_urls_raw) if line.strip()]
    if proxy_urls:
        opts["proxy"] = secrets.choice(proxy_urls)
        # Observabilidade: torna auto-evidente nos logs quando o job sai por
        # proxy (ex.: túnel residencial socks5h). MASCARADO — nunca loga
        # credenciais. Silêncio (sem esta linha) = sem proxy.
        logger.info("proxy-active", proxy=_mask_proxy(opts["proxy"]))

    # Browser impersonation (curl_cffi). Plataformas como TikTok exigem imitar o
    # TLS/JA3 de um browser real; o extractor pede impersonation sozinho e, com
    # o backend `curl_cffi` instalado (extra yt-dlp[curl-cffi]), ele escolhe um
    # alvo automaticamente — por isso o caso comum não precisa de config. O env
    # `YTDLP_IMPERSONATE` (ex.: "chrome", "chrome-124:windows-10") força um alvo
    # específico quando uma plataforma quebra com o padrão.
    impersonate_raw = (os.environ.get("YTDLP_IMPERSONATE") or "").strip()
    if impersonate_raw and impersonate_raw.lower() not in ("0", "false", "off", "none"):
        try:
            from yt_dlp.networking.impersonate import ImpersonateTarget

            opts["impersonate"] = ImpersonateTarget.from_str(impersonate_raw)
        except (ImportError, ValueError, AttributeError):
            # curl_cffi ausente, alvo inválido ou API do yt-dlp mudou: segue sem
            # forçar — o extractor ainda pode auto-selecionar se houver backend.
            pass

    return opts


# ============================================================================
# VTT/SRT parser
# ============================================================================

_TS_RE = re.compile(r"(\d{2}):(\d{2}):(\d{2})[.,](\d{3})")


def parse_vtt_or_srt(content: str) -> tuple[Segment, ...]:
    """Parser minimal: extrai (start_sec, text) de cada cue. Funciona p/ ambos.

    Legendas automáticas do YouTube usam "rolling captions": cada cue repete
    a(s) linha(s) do cue anterior e acrescenta a nova. Sem dedup, o texto sai
    duplicado 2-3x (ver .specs/029). Removemos o overlap linha-a-linha: o
    maior sufixo do cue anterior que é prefixo do atual é descartado.
    """
    segments: list[Segment] = []
    prev_lines: list[str] = []
    blocks = re.split(r"\n\s*\n", content.strip())
    for block in blocks:
        lines = [ln for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue
        # Skip cabeçalho WEBVTT
        if lines[0].strip().upper().startswith("WEBVTT"):
            continue
        # Skip cue id (linha de número solto antes do timecode em SRT)
        ts_line = None
        text_start = 0
        for i, ln in enumerate(lines):
            if "-->" in ln:
                ts_line = ln
                text_start = i + 1
                break
        if ts_line is None:
            continue
        match = _TS_RE.search(ts_line)
        if not match:
            continue
        h, m, s, ms = match.groups()
        start_sec = int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000
        cue_lines = [cleaned for ln in lines[text_start:] if (cleaned := _clean_cue_line(ln))]
        new_lines = _drop_rolling_overlap(prev_lines, cue_lines)
        prev_lines = cue_lines
        text = " ".join(new_lines).strip()
        if text:
            segments.append(Segment(start_sec=start_sec, text=text))
    return tuple(segments)


def _drop_rolling_overlap(prev_lines: list[str], cue_lines: list[str]) -> list[str]:
    """Remove do início do cue o maior bloco de linhas repetido do cue anterior.

    Ex: prev=["A", "B"], cue=["B", "C"] → ["C"]. Cues 100% repetidos viram
    lista vazia (não geram segmento). Legendas normais (sem rolling) raramente
    repetem linhas consecutivas, então saem intactas.
    """
    for k in range(min(len(prev_lines), len(cue_lines)), 0, -1):
        if prev_lines[-k:] == cue_lines[:k]:
            return cue_lines[k:]
    return cue_lines


_TAG_RE = re.compile(r"<[^>]+>")


def _clean_cue_line(line: str) -> str:
    """Remove tags <c>, timestamps inline e prefixos de speaker simples."""
    line = _TAG_RE.sub("", line)
    return line.strip()
