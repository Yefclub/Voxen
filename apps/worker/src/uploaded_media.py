"""Helpers para jobs de upload de áudio/vídeo."""

from __future__ import annotations

import asyncio
import math
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlparse


@dataclass(frozen=True)
class UploadedMediaRef:
    upload_id: str
    filename: str


def sanitize_filename(raw: str) -> str:
    name = raw.replace("\\", "/").split("/")[-1].strip() or "arquivo"
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_")[:160]
    return safe or "arquivo"


def parse_upload_source_url(source_url: str) -> UploadedMediaRef | None:
    parsed = urlparse(source_url)
    if parsed.scheme != "upload" or not parsed.netloc or not parsed.path:
        return None
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", parsed.netloc):
        return None
    filename = sanitize_filename(unquote(parsed.path.lstrip("/")))
    return UploadedMediaRef(upload_id=parsed.netloc, filename=filename)


async def probe_duration_sec(path: Path) -> int:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        msg = stderr.decode("utf-8", errors="replace").strip() or "ffprobe falhou"
        raise RuntimeError(f"Não foi possível ler a duração do arquivo: {msg}")

    try:
        duration = float(stdout.decode("utf-8", errors="replace").strip())
    except ValueError as exc:
        raise RuntimeError("Não foi possível ler a duração do arquivo.") from exc
    if not math.isfinite(duration) or duration <= 0:
        raise RuntimeError("Arquivo sem duração de áudio/vídeo detectável.")
    return int(math.ceil(duration))


async def extract_audio_opus(source: Path, dest: Path) -> None:
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(source),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "libopus",
        "-b:a",
        "32k",
        "-y",
        str(dest),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        msg = stderr.decode("utf-8", errors="replace").strip() or "ffmpeg falhou"
        raise RuntimeError(f"Não foi possível extrair áudio do arquivo: {msg}")
