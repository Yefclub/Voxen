"""Validação estrutural de áudio com ffprobe antes da transcrição (spec 046).

Barra cedo arquivos vazios/corrompidos/sem faixa de áudio ANTES de chamar a API
da OpenRouter, evitando download/chunking/tokens desperdiçados.

Degradação graceful: se o binário `ffprobe` sumir ou retornar JSON inesperado, a
validação NÃO bloqueia o job — registra um warning e deixa a transcrição seguir
(deixa a API decidir), pra não derrubar produção se a imagem mudar.
"""

from __future__ import annotations

import asyncio
import json
import math
from pathlib import Path
from typing import Any

import structlog

from .ytdl import MAX_DURATION_SEC

logger = structlog.get_logger(__name__)

# Limite de tamanho do arquivo de áudio que vai pra API. O worker comprime áudio
# pra opus mono 16kHz / 32kbps (ver `uploaded_media.extract_audio_opus` e
# `ytdl.download_audio_opus`); 4h nesse bitrate dão ~58 MB. 1 GiB é um teto de
# sanidade folgado — acima disso o arquivo certamente está errado (vídeo cru,
# corrupção), não um áudio comprimido legítimo.
MAX_AUDIO_BYTES = 1024 * 1024 * 1024  # 1 GiB

# Teto pro ffprobe responder. ffprobe lê só headers, então é rápido; se passar
# disso, o arquivo/FS está patológico — matamos o processo e caímos na
# degradação graceful (deixa a API decidir) em vez de pendurar o job.
FFPROBE_TIMEOUT_SEC = 30.0


class AudioValidationError(Exception):
    """Áudio reprovado pelo ffprobe — não deve ser enviado pra API.

    O pipeline converte isso em `PermanentError` (não retentável): um arquivo
    estruturalmente inválido não melhora com retry.
    """


async def validate_audio_for_transcription(path: Path) -> None:
    """Valida `path` com ffprobe antes de mandar pra API de transcrição.

    Levanta `AudioValidationError` (com mensagem clara em PT-BR) quando o arquivo
    é estruturalmente inválido: ausente, vazio, grande demais, sem stream de
    áudio, ou com duração inválida/fora do limite.

    Degradação graceful: se o `ffprobe` não estiver disponível ou retornar saída
    inesperada, registra um warning e retorna sem erro — a transcrição segue.
    """
    if not path.exists():
        logger.warning("audio-validation-failed", reason="missing", path=str(path))
        raise AudioValidationError("Arquivo de áudio não encontrado para transcrição.")

    size_bytes = path.stat().st_size
    if size_bytes <= 0:
        logger.warning("audio-validation-failed", reason="empty", path=str(path))
        raise AudioValidationError("Arquivo de áudio vazio — nada para transcrever.")
    if size_bytes > MAX_AUDIO_BYTES:
        logger.warning(
            "audio-validation-failed",
            reason="too_large",
            path=str(path),
            size_bytes=size_bytes,
        )
        raise AudioValidationError(
            "Arquivo de áudio grande demais para transcrição. Envie uma mídia menor ou mais curta."
        )

    info = await _run_ffprobe(path)
    if info is None:
        # ffprobe ausente ou saída inesperada → degrada graceful (não bloqueia).
        logger.warning("audio-validation-skipped", path=str(path), size_bytes=size_bytes)
        return

    if not _has_audio_stream(info):
        logger.warning("audio-validation-failed", reason="no_audio_stream", path=str(path))
        raise AudioValidationError(
            "O arquivo não contém faixa de áudio reproduzível para transcrição."
        )

    duration = _extract_duration(info)
    if duration is None or not math.isfinite(duration) or duration <= 0:
        logger.warning(
            "audio-validation-failed",
            reason="invalid_duration",
            path=str(path),
            duration=duration,
        )
        raise AudioValidationError(
            "Áudio com duração zero ou indetectável — nada para transcrever."
        )
    if duration > MAX_DURATION_SEC:
        logger.warning(
            "audio-validation-failed",
            reason="too_long",
            path=str(path),
            duration=duration,
        )
        raise AudioValidationError("Áudio excede a duração máxima de 4 horas.")

    logger.info(
        "audio-validated",
        path=str(path),
        size_bytes=size_bytes,
        duration_sec=int(duration),
    )


async def _run_ffprobe(path: Path) -> dict[str, Any] | None:
    """Roda `ffprobe ... -show_format -show_streams` e devolve o JSON parseado.

    Retorna `None` (sinal de degradação graceful) quando o binário não existe ou
    a saída não é JSON parseável. Erros de retorno do próprio ffprobe (arquivo
    ilegível) também caem em `None` — o arquivo segue pra API decidir.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        logger.warning("ffprobe-not-found", path=str(path))
        return None

    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=FFPROBE_TIMEOUT_SEC)
    except TimeoutError:
        proc.kill()
        await proc.wait()
        logger.warning("ffprobe-timeout", path=str(path), timeout_sec=FFPROBE_TIMEOUT_SEC)
        return None
    if proc.returncode != 0:
        msg = stderr.decode("utf-8", errors="replace").strip() or "ffprobe falhou"
        logger.warning(
            "ffprobe-nonzero-exit",
            path=str(path),
            returncode=proc.returncode,
            error=msg,
        )
        return None

    try:
        parsed = json.loads(stdout.decode("utf-8", errors="replace"))
    except (ValueError, UnicodeDecodeError):
        logger.warning("ffprobe-invalid-json", path=str(path))
        return None

    if not isinstance(parsed, dict):
        logger.warning("ffprobe-unexpected-output", path=str(path))
        return None
    return parsed


def _has_audio_stream(info: dict[str, Any]) -> bool:
    streams = info.get("streams")
    if not isinstance(streams, list):
        return False
    return any(isinstance(s, dict) and s.get("codec_type") == "audio" for s in streams)


def _extract_duration(info: dict[str, Any]) -> float | None:
    """Extrai duração (segundos) do format ou, em fallback, de um stream de áudio."""
    candidates: list[Any] = []
    fmt = info.get("format")
    if isinstance(fmt, dict):
        candidates.append(fmt.get("duration"))
    streams = info.get("streams")
    if isinstance(streams, list):
        for s in streams:
            if isinstance(s, dict) and s.get("codec_type") == "audio":
                candidates.append(s.get("duration"))
    for raw in candidates:
        if raw is None:
            continue
        try:
            return float(raw)
        except (TypeError, ValueError):
            continue
    return None
