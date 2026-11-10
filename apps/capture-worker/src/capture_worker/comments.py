"""Top-level comments: normalization, ranking and the TikTok public comment API.

Comments are best effort. Every fetch failure is logged and turns into an
empty list; it never fails the capture.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any
from urllib.parse import urlencode

from . import config, http
from .errors import CaptureError, redact
from .result import iso_from_timestamp

log = logging.getLogger("capture_worker.comments")

TIKTOK_COMMENTS_URL = "https://www.tiktok.com/api/comment/list/?{query}"
_DELETED = {"[deleted]", "[removed]"}
_TIKTOK_ID = re.compile(r"\d{1,25}")


def _count(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return max(int(value), 0)


def _clean(value: object, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    return text[:limit].rstrip()


def _rank(entry: tuple[int | None, float | None, str | None, dict[str, Any]]) -> tuple:
    """Likes desc, then publishedAt desc, then id asc; unknown values last."""
    likes, timestamp, comment_id, _ = entry
    return (
        likes is None,
        -(likes or 0),
        timestamp is None,
        -(timestamp or 0.0),
        comment_id is None,
        comment_id or "",
    )


def normalize(raw: object) -> list[dict[str, Any]]:
    """yt-dlp-style comment dicts (`id`, `author`, `text`, `like_count`,
    `timestamp`, `parent`) -> at most MAX_COMMENTS
    `{author, text, likes, publishedAt}` in ranking order. Replies, empty and
    deleted comments are dropped."""
    if not isinstance(raw, list):
        return []
    ranked: list[tuple[int | None, float | None, str | None, dict[str, Any]]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        parent = item.get("parent")
        if parent not in (None, "root"):
            continue
        text = _clean(item.get("text"), config.MAX_COMMENT_CHARS)
        if not text or text.lower() in _DELETED:
            continue
        likes = _count(item.get("like_count"))
        published = iso_from_timestamp(item.get("timestamp"))
        timestamp = float(item["timestamp"]) if published else None
        comment_id = item.get("id")
        ranked.append(
            (
                likes,
                timestamp,
                str(comment_id)
                if isinstance(comment_id, (str, int)) and comment_id != ""
                else None,
                {
                    "author": _clean(item.get("author"), config.MAX_COMMENT_AUTHOR_CHARS),
                    "text": text,
                    "likes": likes,
                    "publishedAt": published,
                },
            )
        )
    ranked.sort(key=_rank)
    return [entry[3] for entry in ranked[: config.MAX_COMMENTS]]


def from_tiktok(payload: object) -> list[dict[str, Any]]:
    """TikTok `/api/comment/list/` payload -> normalized comments."""
    if not isinstance(payload, dict):
        return []
    raw: list[dict[str, Any]] = []
    for item in payload.get("comments") or []:
        if not isinstance(item, dict):
            continue
        user = item.get("user") if isinstance(item.get("user"), dict) else {}
        # Top-level comments have no reply target; status 1 is a visible comment.
        if item.get("reply_id") not in (None, "0", 0) or item.get("status") not in (None, 1):
            continue
        raw.append(
            {
                "id": item.get("cid"),
                "author": user.get("unique_id") or user.get("nickname"),
                "text": item.get("text"),
                "like_count": item.get("digg_count"),
                "timestamp": item.get("create_time"),
            }
        )
    return normalize(raw)


async def tiktok(video_id: object) -> list[dict[str, Any]]:
    """Top comments from TikTok's public comment API (no login, no signature)."""
    if not isinstance(video_id, str) or not _TIKTOK_ID.fullmatch(video_id):
        return []
    query = urlencode(
        {"aweme_id": video_id, "count": config.MAX_COMMENTS, "cursor": 0, "aid": 1988}
    )
    try:
        fetched = await http.fetch(
            TIKTOK_COMMENTS_URL.format(query=query),
            max_bytes=config.MAX_COMMENTS_JSON_BYTES,
            headers={"Referer": "https://www.tiktok.com/"},
        )
        return from_tiktok(json.loads(fetched.body or b"null"))
    except CaptureError as exc:
        log.info("tiktok comments unavailable: %s", exc.code)
    except ValueError as exc:
        log.info("tiktok comments unparseable: %s", redact(str(exc), 200))
    return []
