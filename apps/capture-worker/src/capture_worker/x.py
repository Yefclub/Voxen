"""X/Twitter posts via the public syndication endpoint, with fxtwitter fallback."""

from __future__ import annotations

import json
import logging
from email.utils import parsedate_to_datetime
from typing import Any

from . import config, http, images
from .errors import (
    LOGIN_REQUIRED,
    NO_TEXT,
    REMOVED,
    UNKNOWN,
    CaptureError,
    classify_http_status,
    error,
)
from .result import clean_text, empty_result, iso_date, iso_from_timestamp, language_code
from .x_token import syndication_token

log = logging.getLogger("capture_worker.x")

SYNDICATION_URL = "https://cdn.syndication.twimg.com/tweet-result?id={id}&lang=en&token={token}"
FXTWITTER_URL = "https://api.fxtwitter.com/status/{id}"
_MAX_JSON = 2 * 1024 * 1024


async def extract(status_id: str, tmp_dir: str) -> dict[str, Any]:
    post: dict[str, Any] | None = None
    first_error: CaptureError | None = None
    try:
        post = await _syndication(status_id)
    except CaptureError as exc:
        first_error = exc
        log.info("syndication failed: %s", exc.code)
    # Long posts and articles are truncated in syndication; fxtwitter has them.
    if post is None or post.get("truncated"):
        try:
            post = await _fxtwitter(status_id) or post
        except CaptureError as exc:
            log.info("fxtwitter failed: %s", exc.code)
            if post is None:
                raise (first_error or exc) from None
    if post is None:
        raise first_error or error(UNKNOWN)
    return await _to_result(post, status_id, tmp_dir)


async def _get_json(url: str) -> Any:
    fetched = await http.fetch(url, max_bytes=_MAX_JSON, accept_status_errors=True)
    if fetched.status in (404, 410):
        raise error(REMOVED)
    if fetched.status in (401, 403):
        raise error(LOGIN_REQUIRED)
    if fetched.status >= 400:
        raise classify_http_status(fetched.status) or error(UNKNOWN)
    try:
        return json.loads(fetched.body or b"null")
    except ValueError as exc:
        raise error(UNKNOWN, retryable=True) from exc


async def _syndication(status_id: str) -> dict[str, Any] | None:
    data = await _get_json(SYNDICATION_URL.format(id=status_id, token=syndication_token(status_id)))
    if not isinstance(data, dict) or not data:
        raise error(REMOVED)
    return normalize_syndication(data)


def normalize_syndication(data: dict[str, Any]) -> dict[str, Any]:
    typename = data.get("__typename")
    if typename == "TweetTombstone":
        raise error(REMOVED)
    if typename == "TweetUnavailable" or data.get("reason") == "Protected":
        raise error(LOGIN_REQUIRED)
    if "text" not in data and "full_text" not in data:
        raise error(REMOVED)
    user = data.get("user") or {}
    photos: list[str] = []
    video_poster: str | None = None
    has_video = False
    for media in data.get("mediaDetails") or []:
        kind = media.get("type")
        if kind == "photo" and media.get("media_url_https"):
            photos.append(media["media_url_https"])
        elif kind in ("video", "animated_gif"):
            has_video = has_video or kind == "video"
            video_poster = video_poster or media.get("media_url_https")
    if not photos:
        photos = [p.get("url") for p in data.get("photos") or [] if p.get("url")]
    if data.get("video") and not has_video:
        has_video = True
        video_poster = video_poster or (data.get("video") or {}).get("poster")
    quoted = data.get("quoted_tweet")
    created = data.get("created_at")
    return {
        "id": str(data.get("id_str") or ""),
        "text": data.get("text") or data.get("full_text"),
        "truncated": bool(data.get("note_tweet") or data.get("article")),
        "author_name": user.get("name"),
        "screen_name": user.get("screen_name"),
        "published": iso_date(created) or _rfc2822(created),
        "lang": data.get("lang"),
        "photos": photos,
        "video_poster": video_poster,
        "has_video": has_video,
        "quoted": _quoted_syndication(quoted) if isinstance(quoted, dict) else None,
    }


def _quoted_syndication(data: dict[str, Any]) -> dict[str, str | None]:
    user = data.get("user") or {}
    return {"text": data.get("text"), "screen_name": user.get("screen_name")}


async def _fxtwitter(status_id: str) -> dict[str, Any] | None:
    data = await _get_json(FXTWITTER_URL.format(id=status_id))
    if not isinstance(data, dict):
        raise error(UNKNOWN, retryable=True)
    code = data.get("code")
    if code == 404:
        raise error(REMOVED)
    if code == 401:
        raise error(LOGIN_REQUIRED)
    tweet = data.get("tweet")
    if not isinstance(tweet, dict):
        raise error(REMOVED)
    return normalize_fxtwitter(tweet)


def normalize_fxtwitter(tweet: dict[str, Any]) -> dict[str, Any]:
    author = tweet.get("author") or {}
    media = tweet.get("media") or {}
    photos = [p.get("url") for p in media.get("photos") or [] if p.get("url")]
    videos = [v for v in media.get("videos") or [] if isinstance(v, dict)]
    has_video = any(v.get("type", "video") != "gif" for v in videos)
    text = tweet.get("text") or ""
    article = tweet.get("article")
    if isinstance(article, dict):
        article_text = _article_text(article)
        if article_text:
            text = f"{text}\n\n{article_text}".strip() if text else article_text
    quote = tweet.get("quote")
    return {
        "id": str(tweet.get("id") or ""),
        "text": text,
        "truncated": False,
        "author_name": author.get("name"),
        "screen_name": author.get("screen_name"),
        "published": iso_from_timestamp(tweet.get("created_timestamp")),
        "lang": tweet.get("lang"),
        "photos": photos,
        "video_poster": videos[0].get("thumbnail_url") if videos else None,
        "has_video": has_video,
        "quoted": {
            "text": quote.get("text"),
            "screen_name": (quote.get("author") or {}).get("screen_name"),
        }
        if isinstance(quote, dict)
        else None,
    }


def _article_text(article: dict[str, Any]) -> str:
    parts: list[str] = []
    if article.get("title"):
        parts.append(f"# {article['title']}")
    content = article.get("content") or {}
    for block in content.get("blocks") or []:
        if isinstance(block, dict) and block.get("text"):
            parts.append(str(block["text"]))
    return "\n\n".join(parts)


def _rfc2822(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        return iso_from_timestamp(parsedate_to_datetime(value).timestamp())
    except (TypeError, ValueError):
        return None


async def _to_result(post: dict[str, Any], status_id: str, tmp_dir: str) -> dict[str, Any]:
    screen_name = post.get("screen_name")
    canonical = (
        f"https://x.com/{screen_name}/status/{status_id}"
        if screen_name
        else f"https://x.com/i/status/{status_id}"
    )
    result = empty_result("x", canonical, "x-syndication")
    text = clean_text(post.get("text")) or ""
    quoted = post.get("quoted")
    if quoted and clean_text(quoted.get("text")):
        who = f"@{quoted['screen_name']}" if quoted.get("screen_name") else "quoted post"
        text = f"{text}\n\n> {who}: {clean_text(quoted['text'])}".strip()
    result.update(
        platformId=status_id,
        author=clean_text(post.get("author_name")),
        channel=f"@{screen_name}" if screen_name else None,
        publishedAt=post.get("published"),
        language=language_code(post.get("lang")),
        text=text or None,
        textKind="post" if text else "none",
        hasAudio=bool(post.get("has_video")),
    )
    sources = [("post_media", url) for url in post.get("photos") or []]
    if post.get("video_poster"):
        sources.append(("thumbnail", post["video_poster"]))
    result["images"] = await images.download(sources[: config.MAX_IMAGES], tmp_dir)
    if not result["text"] and not result["images"] and not result["hasAudio"]:
        raise error(NO_TEXT)
    return result
