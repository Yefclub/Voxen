"""Reparo one-off de transcrições poluídas por rolling captions (spec 029).

Legendas automáticas do YouTube baixadas em VTT repetiam cada linha 2-3x
porque o parser não removia o overlap dos cues (corrigido em ytdl.py).
Este script repara as transcrições JÁ INDEXADAS, in-place:

  1. Re-obtém a legenda do vídeo (mesmos caminhos do pipeline).
  2. Re-parseia com o parser corrigido.
  3. Regera markdown + plainText e atualiza a MESMA row/mesmo mdPath —
     ids preservados, vínculos de notas e nós do Brain intactos; o trigger
     de FTS recalcula o searchVector no UPDATE.

Uso (dentro do container, envs de DB/S3 presentes):

    python -m src.repair_rolling --dry-run   # só relata
    python -m src.repair_rolling             # aplica

Transcrições cuja legenda não puder ser re-baixada (rate limit etc.) são
puladas e reportadas — rode de novo mais tarde.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

import structlog

from . import db, storage, ytdl
from .safe_diagnostics import error_diagnostic
from .transcript_md import Segment, TranscriptDoc, render_markdown, render_plain_text

log = structlog.get_logger(__name__)


def looks_rolling(plain_text: str) -> bool:
    """Heurística de diagnóstico: muitos parágrafos consecutivos com overlap."""
    paras = [p.strip() for p in plain_text.split("\n\n") if p.strip()]
    if len(paras) < 4:
        return False
    overlapping = sum(
        1
        for a, b in zip(paras, paras[1:], strict=False)
        if a in b or b in a or (len(a) > 20 and b.startswith(a[-20:]))
    )
    return overlapping / (len(paras) - 1) > 0.3


async def _fresh_segments(url: str, user_id: str) -> tuple[tuple[Segment, ...], str] | None:
    """Mesmos caminhos do pipeline: transcript API → fallback VTT/SRT."""
    fetch = await ytdl.fetch_youtube_transcript(url)
    if fetch is not None:
        return fetch.segments, fetch.language
    probe = await ytdl.probe(url, user_id=user_id)
    pick = ytdl.pick_subtitle_lang(probe)
    if pick is None:
        return None
    lang, fmt = pick
    with tempfile.TemporaryDirectory(prefix="voxen-repair-") as tmp:
        sub_path = await ytdl.download_subtitle(url, lang, fmt, Path(tmp), user_id=user_id)
        content = sub_path.read_text(encoding="utf-8")
    return ytdl.parse_vtt_or_srt(content), lang.split("-")[0]


def _parse_transcribed_at(frontmatter: Any, fallback: datetime) -> datetime:
    # asyncpg sem codec jsonb devolve a coluna como string JSON crua —
    # decodifica antes de ler o campo (achado do review do PR #242).
    if isinstance(frontmatter, str):
        try:
            frontmatter = json.loads(frontmatter)
        except ValueError:
            frontmatter = None
    if isinstance(frontmatter, dict):
        raw = frontmatter.get("transcribed_at")
        if isinstance(raw, str):
            try:
                return datetime.fromisoformat(raw)
            except ValueError:
                pass
    return fallback


async def repair(dry_run: bool) -> None:
    async with db.connection() as conn:
        rows = await conn.fetch(
            """
            SELECT id, "userId", source, url, title, channel, author, "durationSec",
                   "publishedAt", "thumbnailUrl", language, model, "costUsd",
                   "mdPath", "plainText", frontmatter, "createdAt"
            FROM "Transcript"
            WHERE "transcriptionMethod" = 'SUBTITLES'
              AND source = 'YOUTUBE'
              AND status <> 'TRASH'
            ORDER BY "createdAt"
            """
        )
    log.info("repair-start", total=len(rows), dry_run=dry_run)

    repaired = skipped = clean = 0
    for row in rows:
        tid = row["id"]
        dirty = looks_rolling(row["plainText"])
        if not dirty:
            clean += 1
            log.info("repair-skip-clean", transcript_id=tid)
            continue
        try:
            fresh = await _fresh_segments(row["url"], row["userId"])
        except Exception as e:  # noqa: BLE001
            skipped += 1
            log.warning(
                "repair-fetch-failed",
                transcript_id=tid,
                **error_diagnostic(e, "REPAIR_FETCH_FAILED"),
            )
            continue
        if fresh is None:
            skipped += 1
            log.warning("repair-no-subtitles", transcript_id=tid)
            continue
        segments, language = fresh
        doc = TranscriptDoc(
            transcript_id=tid,
            user_id=row["userId"],
            source=row["source"],
            url=row["url"],
            video_id=ytdl._youtube_video_id(row["url"]) or "",  # noqa: SLF001
            title=row["title"],
            channel=row["channel"],
            author=row["author"],
            duration_sec=row["durationSec"],
            published_at=row["publishedAt"],
            thumbnail_url=row["thumbnailUrl"],
            language=language or row["language"],
            transcription_method="SUBTITLES",
            model=row["model"],
            cost_usd=row["costUsd"],
            segments=segments,
            transcribed_at=_parse_transcribed_at(row["frontmatter"], row["createdAt"]),
        )
        md_content = render_markdown(doc)
        plain_text = render_plain_text(doc)
        before, after = len(row["plainText"]), len(plain_text)
        if dry_run:
            log.info(
                "repair-dry-run",
                transcript_id=tid,
                chars_before=before,
                chars_after=after,
            )
            continue
        await storage.put_markdown(key=row["mdPath"], content=md_content)
        async with db.connection() as conn:
            await conn.execute(
                'UPDATE "Transcript" SET "plainText" = $2, "updatedAt" = NOW() WHERE id = $1',
                tid,
                plain_text,
            )
        repaired += 1
        log.info(
            "repair-done",
            transcript_id=tid,
            chars_before=before,
            chars_after=after,
        )
        # Gentileza com o rate limit do YouTube entre downloads
        await asyncio.sleep(2)

    log.info("repair-finished", repaired=repaired, clean=clean, skipped=skipped)


def main() -> None:
    parser = argparse.ArgumentParser(description="Repara transcrições com rolling captions.")
    parser.add_argument("--dry-run", action="store_true", help="Só relata, não altera nada.")
    args = parser.parse_args()
    asyncio.run(repair(dry_run=args.dry_run))


if __name__ == "__main__":
    main()
