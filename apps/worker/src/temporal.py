"""Small, dependency-free temporal value helpers."""

from datetime import UTC, datetime


def parse_iso_timestamp(value: object) -> str | None:
    """Accept an explicit timezone-aware ISO timestamp and normalize it to UTC."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(UTC).isoformat().replace("+00:00", "Z")
