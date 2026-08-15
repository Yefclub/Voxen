"""One-line, secret-safe structured logging for container runtimes."""

from __future__ import annotations

import json
import logging
import os
import re
import sys
from collections.abc import MutableMapping
from datetime import UTC, datetime
from typing import Any

import structlog

_BUILD_ID = re.compile(r"^[A-Za-z0-9._+-]{1,128}$")
_LEVELS = {
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARNING": logging.WARNING,
    "ERROR": logging.ERROR,
    "CRITICAL": logging.CRITICAL,
}


class _SafeJsonFormatter(logging.Formatter):
    """Describe a stdlib record without serializing its provider-controlled message."""

    def format(self, record: logging.LogRecord) -> str:
        logger_name = (
            record.name if re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", record.name) else "unknown"
        )
        return json.dumps(
            {
                "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
                "level": record.levelname.lower(),
                "service": "voxen-worker",
                "event": "stdlib-log",
                "logger": logger_name,
            },
            sort_keys=True,
            separators=(",", ":"),
        )


def _runtime_context(
    _logger: Any, _method_name: str, event_dict: MutableMapping[str, Any]
) -> MutableMapping[str, Any]:
    event_dict.setdefault("service", "voxen-worker")
    version = os.getenv("VOXEN_VERSION", "").strip()
    git_sha = (os.getenv("VOXEN_GIT_SHA") or os.getenv("GIT_SHA") or "").strip()
    if _BUILD_ID.fullmatch(version):
        event_dict.setdefault("version", version)
    if _BUILD_ID.fullmatch(git_sha):
        event_dict.setdefault("git_sha", git_sha)
    return event_dict


def configure_logging() -> None:
    """Configure structlog once for JSON ingestion by Docker and Easypanel."""
    level = _LEVELS.get(os.getenv("LOG_LEVEL", "INFO").strip().upper(), logging.INFO)
    root = logging.getLogger()
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(_SafeJsonFormatter())
    root.handlers = [handler]
    root.setLevel(level)
    logging.captureWarnings(True)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True, key="timestamp"),
            _runtime_context,
            structlog.processors.JSONRenderer(sort_keys=True),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
