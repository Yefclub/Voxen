"""Small, privacy-safe observability helpers shared by ingestion paths."""

from __future__ import annotations

from typing import Any

from . import video_url


def source_kind_for_log(source_url: str, job_type: str) -> str:
    detected = video_url.detect_source(source_url)
    if detected:
        return detected
    if source_url.lower().startswith("upload://"):
        return "UPLOAD"
    if job_type == "SCRAPE_WEB":
        return "WEB"
    return "UNKNOWN"


def log_openrouter_route(log: Any, purpose: str, primary_model: str, selected_model: str) -> None:  # noqa: ANN401
    if selected_model != primary_model:
        log.warning(
            "openrouter-model-fallback-used",
            purpose=purpose,
            primary_model=primary_model,
            selected_model=selected_model,
        )
