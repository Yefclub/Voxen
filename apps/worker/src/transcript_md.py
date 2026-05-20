"""Geração do `.md` no formato canônico (docs/TRANSCRIPT-FORMAT.md)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any

import yaml


@dataclass(frozen=True)
class Segment:
    """Trecho de transcrição com timestamp inicial em segundos."""

    start_sec: float
    text: str


@dataclass(frozen=True)
class TranscriptDoc:
    """Conteúdo + metadata pronto pra virar Markdown + linhas do DB."""

    transcript_id: str
    user_id: str
    source: str  # YOUTUBE | INSTAGRAM | TIKTOK | X | WEB | UPLOAD
    url: str
    video_id: str
    title: str
    channel: str | None
    author: str | None
    duration_sec: int
    published_at: datetime | None
    thumbnail_url: str | None
    language: str
    transcription_method: str  # API | SUBTITLES | SCRAPE | VISION | DOCUMENT | X_SEARCH
    model: str | None
    cost_usd: Decimal | None
    segments: tuple[Segment, ...]
    transcribed_at: datetime


def _format_ts(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"


def _timestamp_link(source: str, url: str, video_id: str, seconds: float) -> str | None:
    """Link clicável pro segundo exato. Cada plataforma tem sintaxe própria.

    - YouTube: `?t=Ns` funciona em youtu.be e youtube.com
    - Instagram/TikTok: NÃO suportam deeplink pra segundo via URL pública;
      caímos pro `url` da página inteira (o user clica e procura)
    """
    if source == "YOUTUBE":
        return f"https://youtu.be/{video_id}?t={int(seconds)}"
    if source == "UPLOAD":
        return None
    # Instagram/TikTok: sem deeplink de timestamp na URL pública
    return url


def build_frontmatter(doc: TranscriptDoc) -> dict[str, Any]:
    fm: dict[str, Any] = {
        "id": doc.transcript_id,
        "workspace_id": doc.user_id,
        "source": doc.source.lower(),
        "url": doc.url,
        "title": doc.title,
        "duration_sec": doc.duration_sec,
        "language": doc.language,
        "transcription_method": doc.transcription_method.lower(),
        "transcribed_at": doc.transcribed_at.isoformat(),
    }
    if doc.channel:
        fm["channel"] = doc.channel
    if doc.author:
        fm["author"] = doc.author
    if doc.published_at:
        fm["published_at"] = doc.published_at.isoformat()
    if doc.thumbnail_url:
        fm["thumbnail"] = doc.thumbnail_url
    if doc.model:
        fm["model"] = doc.model
    if doc.cost_usd is not None:
        fm["cost_usd"] = float(doc.cost_usd)
    return fm


def render_markdown(doc: TranscriptDoc) -> str:
    """Monta o `.md` completo (frontmatter + cabeçalho + corpo)."""
    fm = build_frontmatter(doc)
    fm_yaml = yaml.safe_dump(fm, allow_unicode=True, sort_keys=False).rstrip()
    parts: list[str] = [f"---\n{fm_yaml}\n---", ""]

    if doc.thumbnail_url:
        parts.append(f"![thumbnail]({doc.thumbnail_url})")
        parts.append("")

    parts.append(f"# {doc.title}")
    parts.append("")
    if doc.source == "UPLOAD":
        meta_bits: list[str] = ["Arquivo enviado"]
    elif doc.source == "WEB":
        meta_bits = [f"[Página original]({doc.url})"]
    elif doc.source == "X" and doc.transcription_method == "X_SEARCH":
        meta_bits = [f"[Post original]({doc.url})"]
    else:
        meta_bits = [f"[Vídeo original]({doc.url})"]
    if doc.channel:
        meta_bits.append(doc.channel)
    if doc.transcription_method not in {"VISION", "DOCUMENT", "X_SEARCH"}:
        duration_min = doc.duration_sec // 60
        duration_rem = doc.duration_sec % 60
        meta_bits.append(f"{duration_min}m{duration_rem:02d}s")
    if doc.published_at:
        meta_bits.append(f"publicado em {doc.published_at.date().isoformat()}")
    parts.append("> " + " — ".join(meta_bits))
    parts.append("")
    if doc.transcription_method == "VISION":
        parts.append("## Descrição visual")
        parts.append("")
        for seg in doc.segments:
            text = seg.text.strip()
            if text:
                parts.append(text)
                parts.append("")
        return "\n".join(parts).rstrip() + "\n"

    if doc.transcription_method == "DOCUMENT":
        parts.append("## Análise do documento")
        parts.append("")
        for seg in doc.segments:
            text = seg.text.strip()
            if text:
                parts.append(text)
                parts.append("")
        return "\n".join(parts).rstrip() + "\n"

    if doc.transcription_method == "X_SEARCH":
        parts.append("## Análise do X")
        parts.append("")
        for seg in doc.segments:
            text = seg.text.strip()
            if text:
                parts.append(text)
                parts.append("")
        return "\n".join(parts).rstrip() + "\n"

    parts.append("## Transcrição")
    parts.append("")

    for seg in doc.segments:
        ts = _format_ts(seg.start_sec)
        link = _timestamp_link(doc.source, doc.url, doc.video_id, seg.start_sec)
        if link:
            parts.append(f"[{ts}]({link}) {seg.text.strip()}")
        else:
            parts.append(f"[{ts}] {seg.text.strip()}")
        parts.append("")

    return "\n".join(parts).rstrip() + "\n"


def render_plain_text(doc: TranscriptDoc) -> str:
    """Corpo sem timestamps nem frontmatter — usado pra FTS no Postgres."""
    return "\n\n".join(seg.text.strip() for seg in doc.segments if seg.text.strip())
