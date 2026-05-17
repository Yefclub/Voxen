"""Chunking de áudio em janelas de 10min com 1s de overlap (spec 002)."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path

CHUNK_SEC = 10 * 60  # 10 minutos
OVERLAP_SEC = 1


@dataclass(frozen=True)
class AudioChunk:
    """Janela de áudio com offset global (segundos desde o início do vídeo)."""

    path: Path
    start_sec: int
    duration_sec: int


async def split_audio(
    source: Path,
    out_dir: Path,
    total_duration_sec: int,
    chunk_sec: int = CHUNK_SEC,
    overlap_sec: int = OVERLAP_SEC,
) -> list[AudioChunk]:
    """Usa ffmpeg pra cortar `source` em chunks de `chunk_sec` segundos.

    Se total <= chunk_sec, retorna um único chunk apontando para `source` (sem split).
    """
    if total_duration_sec <= chunk_sec:
        return [AudioChunk(path=source, start_sec=0, duration_sec=total_duration_sec)]

    step = chunk_sec - overlap_sec
    chunks: list[AudioChunk] = []
    idx = 0
    cursor = 0
    while cursor < total_duration_sec:
        remaining = total_duration_sec - cursor
        dur = min(chunk_sec, remaining)
        out_path = out_dir / f"chunk_{idx:04d}.opus"
        await _ffmpeg_segment(source, out_path, cursor, dur)
        chunks.append(AudioChunk(path=out_path, start_sec=cursor, duration_sec=dur))
        idx += 1
        if remaining <= chunk_sec:
            break
        cursor += step
    return chunks


async def _ffmpeg_segment(source: Path, dest: Path, start_sec: int, duration_sec: int) -> None:
    """Roda ffmpeg em subprocess assíncrono pra recortar [start, start+duration]."""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        str(start_sec),
        "-t",
        str(duration_sec),
        "-i",
        str(source),
        "-c",
        "copy",
        "-y",
        str(dest),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        err = stderr.decode(errors="replace")
        raise RuntimeError(f"ffmpeg falhou (rc={proc.returncode}): {err}")
