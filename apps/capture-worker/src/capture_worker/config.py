"""Runtime configuration. The worker's only secret is CAPTURE_WORKER_TOKEN."""

from __future__ import annotations

import os
import re

MIN_TOKEN_LENGTH = 32

PROXY_HOST = "127.0.0.1"
PROXY_PORT = 4750
LISTEN_PORT = 8080

HTTP_TIMEOUT_SEC = 30
EXTRACT_TIMEOUT_SEC = 180
AUDIO_TIMEOUT_SEC = 15 * 60
FFMPEG_TIMEOUT_SEC = 20 * 60

MAX_JSON_BODY = 16 * 1024
MAX_UPLOAD_BYTES = 500 * 1024 * 1024
MAX_PAGE_BYTES = 10 * 1024 * 1024
MAX_SUBTITLE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_SOURCE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_BYTES = int(1.5 * 1024 * 1024)
MAX_IMAGES = 4
MAX_AUDIO_SEC = 3 * 60 * 60
AUDIO_CHUNK_SEC = 20 * 60
# WAV (16 kHz mono s16le) feeds the local STT sidecar, which decodes WAV only.
WAV_CHUNK_SEC = 8 * 60
MAX_WAV_SEC = 60 * 60
MAX_DOWNLOAD_BYTES = 700 * 1024 * 1024
MAX_FRAMES_DOWNLOAD_BYTES = 300 * 1024 * 1024
FRAMES_TIMEOUT_SEC = 10 * 60
MIN_WEB_TEXT_CHARS = 200
MAX_PDF_PAGES = 1000
MAX_COMMENTS = 50
MAX_COMMENT_CHARS = 1000
MAX_COMMENT_AUTHOR_CHARS = 200
MAX_COMMENTS_JSON_BYTES = 4 * 1024 * 1024
COMMENTS_TIMEOUT_SEC = 60

PARSE_TIMEOUT_SEC = 120

DENO_PATH = "/usr/local/bin/deno"
FFMPEG_DIR = "/usr/local/bin"


def proxy_url() -> str:
    return os.environ.get("CAPTURE_EGRESS_PROXY", f"http://{PROXY_HOST}:{PROXY_PORT}")


def load_token() -> str:
    """Refuse to start without a strong token."""
    token = os.environ.get("CAPTURE_WORKER_TOKEN", "")
    # Example-file placeholders are long enough to pass a length check.
    placeholder = re.search(r"__|openssl|gere|change|example|placeholder", token, re.IGNORECASE)
    if (
        len(token) < MIN_TOKEN_LENGTH
        or placeholder
        or not re.fullmatch(r"[A-Za-z0-9+/=_-]+", token)
    ):
        raise SystemExit(
            f"CAPTURE_WORKER_TOKEN must be set and at least {MIN_TOKEN_LENGTH} characters long"
        )
    return token


def tmp_root() -> str:
    return os.environ.get("CAPTURE_TMP_DIR", "/tmp")  # noqa: S108 - tmpfs mount in the container
