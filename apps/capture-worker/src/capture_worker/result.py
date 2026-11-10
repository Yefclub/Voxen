"""The `/v1/extract` response shape and small normalizers."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any


def empty_result(platform: str, canonical_url: str, extractor: str) -> dict[str, Any]:
    return {
        "platform": platform,
        "canonicalUrl": canonical_url,
        "platformId": None,
        "title": None,
        "author": None,
        "channel": None,
        "publishedAt": None,
        "durationSec": None,
        "language": None,
        "description": None,
        "text": None,
        "textKind": "none",
        "segments": [],
        "hasAudio": False,
        "hasVideo": False,
        "images": [],
        "comments": [],
        "extractor": extractor,
    }


def language_code(value: object) -> str | None:
    """ISO 639-1 (two lowercase letters) or None."""
    if not isinstance(value, str):
        return None
    base = re.split(r"[-_]", value.strip().lower(), maxsplit=1)[0]
    return base if re.fullmatch(r"[a-z]{2}", base) else None


def iso_from_timestamp(value: object) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        return datetime.fromtimestamp(float(value), tz=UTC).isoformat().replace("+00:00", "Z")
    except (OverflowError, OSError, ValueError):
        return None


def iso_date(value: object) -> str | None:
    """Accepts YYYYMMDD, YYYY-MM-DD or an ISO datetime string."""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if re.fullmatch(r"\d{8}", text):
        text = f"{text[:4]}-{text[4:6]}-{text[6:]}"
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).isoformat().replace("+00:00", "Z")


def clean_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text or None
