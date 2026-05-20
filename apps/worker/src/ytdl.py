"""Wrapper yt-dlp: probe, subtitles, download de áudio opus."""

from __future__ import annotations

import os
import re
import secrets
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yt_dlp

from . import voxen_settings
from .transcript_md import Segment

MAX_DURATION_SEC = 4 * 60 * 60  # 4h conforme spec 002


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


@dataclass
class RuntimeYtdlpOptions:
    opts: dict[str, Any]
    cookie_file: Path | None = None

    def cleanup(self) -> None:
        if self.cookie_file:
            try:
                self.cookie_file.unlink(missing_ok=True)
            except OSError:
                pass


def _parse_upload_date(raw: str | None) -> datetime | None:
    if not raw or len(raw) != 8:
        return None
    try:
        return datetime.strptime(raw, "%Y%m%d").replace(tzinfo=UTC)
    except ValueError:
        return None


async def probe(url: str) -> VideoProbe:
    """Extrai metadata SEM baixar áudio (`skip_download=True`)."""
    runtime = await _runtime_options()
    opts = {
        **runtime.opts,
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
        "writesubtitles": False,
        "writeautomaticsub": False,
    }
    # yt-dlp é sync — chamamos em thread pra não bloquear o loop
    import asyncio

    try:
        info = await asyncio.to_thread(_extract_info, url, opts)
    finally:
        runtime.cleanup()
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
    runtime = await _runtime_options(cookie_dir=out_dir)
    lang_variants = list(dict.fromkeys([lang, lang.split("-")[0]]))
    out_template = str(out_dir / "%(id)s.%(ext)s")
    opts = {
        **runtime.opts,
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
    try:
        await asyncio.to_thread(_run_download, url, opts)
    finally:
        runtime.cleanup()
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

    runtime = await _runtime_options(cookie_dir=out_dir)
    out_template = str(out_dir / "%(id)s.%(ext)s")
    opts = {
        **runtime.opts,
        "format": "bestaudio/best",
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
    try:
        await asyncio.to_thread(_run_download, url, opts)
    finally:
        runtime.cleanup()
    files = list(out_dir.glob("*.opus")) + list(out_dir.glob("*.ogg"))
    if not files:
        raise RuntimeError("Áudio opus não foi gerado")
    return files[0]


def _run_download(url: str, opts: dict[str, Any]) -> None:
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])


async def _runtime_options(cookie_dir: Path | None = None) -> RuntimeYtdlpOptions:
    """Opções comuns do yt-dlp, com config runtime cifrada no DB.

    Proxies/cookies são opcionais e controlados pelo operador do deploy. Não
    usamos listas públicas automáticas: elas são instáveis, inseguras e tendem
    a piorar bloqueios do YouTube.
    """
    opts: dict[str, Any] = {
        "retries": 3,
        "fragment_retries": 3,
        "extractor_retries": 3,
        "socket_timeout": 30,
        "noplaylist": True,
        "geo_bypass": True,
    }

    youtube_clients_raw = (
        await voxen_settings.get_yt_dlp_youtube_clients()
        or os.environ.get("YTDLP_YOUTUBE_CLIENTS")
        or ""
    )
    youtube_clients = _parse_youtube_clients(youtube_clients_raw)
    if youtube_clients:
        opts["extractor_args"] = {"youtube": {"player_client": youtube_clients}}

    user_agent = (
        await voxen_settings.get_yt_dlp_user_agent() or os.environ.get("YTDLP_USER_AGENT") or ""
    ).strip()
    if user_agent:
        opts["http_headers"] = {"User-Agent": user_agent}

    proxy_urls_raw = (
        await voxen_settings.get_yt_dlp_proxy_urls()
        or os.environ.get("YTDLP_PROXY_URLS")
        or os.environ.get("YTDLP_PROXY_URL")
        or ""
    )
    proxy_urls = [line.strip() for line in re.split(r"[\n,]+", proxy_urls_raw) if line.strip()]
    if proxy_urls:
        opts["proxy"] = secrets.choice(proxy_urls)

    cookie_file_env = os.environ.get("YTDLP_COOKIES_FILE", "").strip()
    if cookie_file_env:
        opts["cookiefile"] = cookie_file_env
        return RuntimeYtdlpOptions(opts=opts)

    cookies_txt = (await voxen_settings.get_yt_dlp_cookies_txt() or "").strip()
    if not cookies_txt:
        return RuntimeYtdlpOptions(opts=opts)

    cookie_path: Path
    if cookie_dir is None:
        tmp = tempfile.NamedTemporaryFile(  # noqa: SIM115
            mode="w",
            encoding="utf-8",
            prefix="voxen-ytdlp-cookies-",
            suffix=".txt",
            delete=False,
        )
        with tmp:
            tmp.write(_normalize_cookie_text(cookies_txt))
        cookie_path = Path(tmp.name)
    else:
        cookie_path = cookie_dir / "cookies.txt"
        cookie_path.write_text(_normalize_cookie_text(cookies_txt), encoding="utf-8")
    opts["cookiefile"] = str(cookie_path)
    return RuntimeYtdlpOptions(opts=opts, cookie_file=cookie_path)


def _parse_youtube_clients(raw: str) -> list[str]:
    allowed = {"web", "mweb", "android", "ios", "tv", "tv_embedded", "web_embedded"}
    clients = []
    for item in re.split(r"[\s,;]+", raw.strip().lower()):
        if item in allowed and item not in clients:
            clients.append(item)
    return clients


def _normalize_cookie_text(cookies_txt: str) -> str:
    normalized = cookies_txt.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized.startswith(("# HTTP Cookie File", "# Netscape HTTP Cookie File")):
        normalized = "# Netscape HTTP Cookie File\n" + normalized
    return normalized + "\n"


# ============================================================================
# VTT/SRT parser
# ============================================================================

_TS_RE = re.compile(r"(\d{2}):(\d{2}):(\d{2})[.,](\d{3})")


def parse_vtt_or_srt(content: str) -> tuple[Segment, ...]:
    """Parser minimal: extrai (start_sec, text) de cada cue. Funciona p/ ambos."""
    segments: list[Segment] = []
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
        text = " ".join(_clean_cue_line(ln) for ln in lines[text_start:])
        text = text.strip()
        if text:
            segments.append(Segment(start_sec=start_sec, text=text))
    return tuple(segments)


_TAG_RE = re.compile(r"<[^>]+>")


def _clean_cue_line(line: str) -> str:
    """Remove tags <c>, timestamps inline e prefixos de speaker simples."""
    line = _TAG_RE.sub("", line)
    return line.strip()
