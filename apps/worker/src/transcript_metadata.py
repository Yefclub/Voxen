"""Serialization helpers for persisted transcript metadata."""

from __future__ import annotations

import json

from .transcript_md import TranscriptDoc, build_frontmatter


def frontmatter_json(
    doc: TranscriptDoc,
    *,
    original_object_key: str | None = None,
    original_filename: str | None = None,
    original_mime_type: str | None = None,
    preview_object_key: str | None = None,
    preview_mime_type: str | None = None,
) -> str:
    frontmatter = build_frontmatter(doc)
    if original_object_key:
        frontmatter["original"] = {
            "objectKey": original_object_key,
            "filename": original_filename,
            "mimeType": original_mime_type,
        }
    if preview_object_key:
        frontmatter["preview"] = {
            "objectKey": preview_object_key,
            "mimeType": preview_mime_type,
        }
    return json.dumps(frontmatter, default=str)
