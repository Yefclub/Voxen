"""Voxen Worker — ARQ entrypoint.

Implementação completa virá em PRs subsequentes conforme .specs/.
MVP atual: settings ARQ + 1 job placeholder pra validar o boot.
"""

from __future__ import annotations

import os
from typing import Any

import structlog
from arq.connections import RedisSettings

log = structlog.get_logger(__name__)


async def placeholder_job(ctx: dict[str, Any], message: str) -> str:
    """Job placeholder — substituir por download_and_transcribe em PR futuro."""
    log.info("placeholder_job", message=message)
    return f"ok: {message}"


def _redis_settings_from_url(url: str) -> RedisSettings:
    """Converte redis:// URL em RedisSettings."""
    # MVP: parser simples. ARQ tem RedisSettings.from_dsn em versões novas.
    from urllib.parse import urlparse

    parsed = urlparse(url)
    return RedisSettings(
        host=parsed.hostname or "redis",
        port=parsed.port or 6379,
        password=parsed.password,
        database=int(parsed.path.lstrip("/") or "0"),
    )


class WorkerSettings:
    """ARQ worker settings."""

    functions = [placeholder_job]
    redis_settings = _redis_settings_from_url(
        os.environ.get("REDIS_URL", "redis://redis:6379/0")
    )
    max_jobs = 4
    job_timeout = 1800  # 30 min — chunking + transcribe pode demorar
    keep_result = 3600
