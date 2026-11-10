"""yt-dlp as a hardened subprocess.

Every invocation uses `--ignore-config --no-plugin-dirs --no-remote-components`,
the default extractors minus `generic`, the egress proxy, the native downloader
and `--` before the URL. Never `--exec`, `--netrc-cmd`, cookies or external
downloaders.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
from typing import Any

from . import captions, comments, config, http, images, proc
from .errors import (
    TOO_LARGE,
    UNSUPPORTED,
    CaptureError,
    classify_exception,
    classify_ytdlp_stderr,
    error,
    redact,
)
from .result import (
    clean_text,
    empty_result,
    iso_date,
    iso_from_timestamp,
    language_code,
)

log = logging.getLogger("capture_worker.ytdlp")

YT_DLP = "yt-dlp"
# Platforms whose yt-dlp extractor implements comment extraction. TikTok's
# extractor does not; its comments come from the public comment API instead.
_YTDLP_COMMENT_PLATFORMS = ("youtube", "instagram")
# Top-level comments only (max-comments, max-parents, max-replies,
# max-replies-per-thread), sorted by YouTube's "Top comments".
YOUTUBE_COMMENT_ARGS = f"youtube:max_comments={config.MAX_COMMENTS},all,0,0;comment_sort=top"


def base_args(tmp_dir: str) -> list[str]:
    return [
        YT_DLP,
        "--ignore-config",
        "--no-plugin-dirs",
        "--no-remote-components",
        "--no-js-runtimes",
        "--js-runtimes",
        f"deno:{config.DENO_PATH}",
        "--use-extractors",
        "default,-generic",
        "--proxy",
        config.proxy_url(),
        # Shared across requests (YouTube player/challenge cache); tmpfs only.
        "--cache-dir",
        os.path.join(config.tmp_root(), ".yt-dlp-cache"),
        "--no-playlist",
        "--no-progress",
        "--no-color",
        "--no-mtime",
        "--no-write-comments",
        "--socket-timeout",
        str(config.HTTP_TIMEOUT_SEC),
        "--retries",
        "2",
        "--extractor-retries",
        "1",
        "--downloader",
        "native",
        "--ffmpeg-location",
        config.FFMPEG_DIR,
    ]


async def _run(
    extra: list[str], url: str, tmp_dir: str, timeout: float, *, level: int = logging.WARNING
) -> proc.Result:
    result = await proc.run(
        [*base_args(tmp_dir), *extra, "--", url], tmp_dir=tmp_dir, timeout=timeout
    )
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace")
        classified = classify_ytdlp_stderr(stderr)
        log.log(level, "yt-dlp failed (%s): %s", classified.code, redact(stderr))
        raise classified
    return result


async def metadata(url: str, tmp_dir: str) -> dict[str, Any]:
    result = await _run(
        ["--skip-download", "--dump-single-json"], url, tmp_dir, config.EXTRACT_TIMEOUT_SEC
    )
    try:
        info = json.loads(result.stdout)
    except ValueError as exc:
        raise error("UNKNOWN") from exc
    if not isinstance(info, dict) or info.get("_type") in ("playlist", "multi_video"):
        raise error(UNSUPPORTED)
    return info


def has_audio(info: dict[str, Any]) -> bool:
    formats = info.get("formats")
    if isinstance(formats, list) and formats:
        for fmt in formats:
            acodec = fmt.get("acodec") if isinstance(fmt, dict) else None
            if acodec and acodec != "none":
                return True
            # Many extractors leave acodec unknown on muxed progressive files.
            if acodec is None and fmt.get("vcodec") not in (None, "none"):
                return True
        return False
    acodec = info.get("acodec")
    if acodec:
        return acodec != "none"
    return bool(info.get("duration"))


def has_video(info: dict[str, Any]) -> bool:
    """True when the extractor reports a real video stream (not storyboards)."""
    formats = info.get("formats")
    if isinstance(formats, list) and formats:
        for fmt in formats:
            if not isinstance(fmt, dict) or fmt.get("ext") == "mhtml":
                continue
            vcodec = fmt.get("vcodec")
            if vcodec and vcodec != "none":
                return True
            if vcodec is None and (fmt.get("height") or fmt.get("width")):
                return True
        return False
    vcodec = info.get("vcodec")
    if vcodec:
        return vcodec != "none"
    return bool(info.get("height") or info.get("width"))


def comment_args(platform: str) -> list[str]:
    """Flags for the bounded comments call; empty when yt-dlp cannot fetch them."""
    if platform not in _YTDLP_COMMENT_PLATFORMS:
        return []
    # `--write-comments` overrides the `--no-write-comments` in base_args.
    args = ["--skip-download", "--dump-single-json", "--write-comments"]
    if platform == "youtube":
        args += ["--extractor-args", YOUTUBE_COMMENT_ARGS]
    return args


async def fetch_comments(
    platform: str, url: str, info: dict[str, Any], tmp_dir: str
) -> list[dict[str, Any]]:
    """Top-level comments within their own budget, best effort: any failure
    returns [] and never fails the capture."""
    if info.get("comment_count") == 0:
        return []
    try:
        return await asyncio.wait_for(
            _fetch_comments(platform, url, info, tmp_dir), config.COMMENTS_TIMEOUT_SEC
        )
    except Exception as exc:  # comments are optional; log and move on
        log.info("comments unavailable: %s", classify_exception(exc).code)
    return []


async def _fetch_comments(
    platform: str, url: str, info: dict[str, Any], tmp_dir: str
) -> list[dict[str, Any]]:
    if platform == "tiktok":
        return await comments.tiktok(str(info.get("id") or ""))
    args = comment_args(platform)
    if not args:
        return []
    result = await _run(args, url, tmp_dir, config.COMMENTS_TIMEOUT_SEC, level=logging.INFO)
    try:
        data = json.loads(result.stdout)
    except ValueError:
        log.info("comments unparseable")
        return []
    return comments.normalize(data.get("comments") if isinstance(data, dict) else None)


async def extract(platform: str, url: str, tmp_dir: str) -> dict[str, Any]:
    info = await metadata(url, tmp_dir)
    if info.get("is_live"):
        raise error(UNSUPPORTED)
    # Runs alongside captions and thumbnails; it never raises.
    comments_task = asyncio.create_task(fetch_comments(platform, url, info, tmp_dir))
    try:
        result = await _extract_result(platform, url, info, tmp_dir)
        result["comments"] = await comments_task
    finally:
        if not comments_task.done():
            comments_task.cancel()
            # Wait for the cancelled yt-dlp child to be killed before the work
            # dir is removed and the extract slot is released.
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await comments_task
    return result


async def _extract_result(
    platform: str, url: str, info: dict[str, Any], tmp_dir: str
) -> dict[str, Any]:
    canonical = clean_text(info.get("webpage_url")) or url
    result = empty_result(platform, canonical, str(info.get("extractor_key") or "yt-dlp"))
    description = clean_text(info.get("description"))
    published = (
        iso_from_timestamp(info.get("timestamp"))
        or iso_from_timestamp(info.get("release_timestamp"))
        or iso_date(info.get("upload_date"))
    )
    duration = info.get("duration")
    result.update(
        platformId=clean_text(str(info["id"])) if info.get("id") is not None else None,
        title=clean_text(info.get("title")) or clean_text(info.get("fulltitle")),
        author=clean_text(info.get("uploader")) or clean_text(info.get("creator")),
        channel=clean_text(info.get("channel")) or clean_text(info.get("uploader_id")),
        publishedAt=published,
        durationSec=float(duration) if isinstance(duration, (int, float)) else None,
        language=language_code(info.get("language")),
        description=description,
        hasAudio=has_audio(info),
        hasVideo=has_video(info),
    )

    track = captions.select_track(info)
    segments: list[captions.Segment] = []
    if track is not None:
        segments = await _fetch_captions(track)
        if segments and not result["language"]:
            result["language"] = language_code(track.lang)
    if segments:
        result.update(
            segments=[s.to_dict() for s in segments],
            text=captions.join_text(segments),
            textKind="captions",
        )
    elif description:
        result.update(text=description, textKind="post" if platform != "youtube" else "description")

    thumbnails = _thumbnail_urls(info)
    # One thumbnail; the other URLs are fallbacks if the first one fails.
    result["images"] = await images.download(
        [("thumbnail", u) for u in thumbnails], tmp_dir, limit=1
    )
    return result


def _thumbnail_urls(info: dict[str, Any]) -> list[str]:
    urls: list[str] = []
    if isinstance(info.get("thumbnail"), str):
        urls.append(info["thumbnail"])
    thumbs = [t for t in info.get("thumbnails") or [] if isinstance(t, dict) and t.get("url")]
    thumbs.sort(key=lambda t: (t.get("preference") or 0, t.get("width") or 0), reverse=True)
    urls.extend(t["url"] for t in thumbs[:2])
    return list(dict.fromkeys(urls))[:3]


async def _fetch_captions(track: captions.Track) -> list[captions.Segment]:
    try:
        fetched = await http.fetch(
            track.url, max_bytes=config.MAX_SUBTITLE_BYTES, headers=track.headers or None
        )
        content = fetched.body.decode("utf-8", errors="replace")
        return captions.parse(content, track.ext)
    except CaptureError as exc:
        log.info("captions unavailable: %s", exc.code)
    except ValueError:
        log.info("captions unparseable")
    return []


async def download_audio(url: str, tmp_dir: str) -> str:
    """Best audio only; falls back to muxed files for sites without audio-only."""
    out_dir = os.path.join(tmp_dir, "dl")
    os.makedirs(out_dir, exist_ok=True)
    await _run(
        [
            # Smallest usable stream: speech-to-text needs little bitrate, and a
            # muxed HD fallback could otherwise fill the tmpfs.
            "--format",
            "ba/wa/b/w",
            "--format-sort",
            "+size,+br,+res",
            "--max-filesize",
            str(config.MAX_DOWNLOAD_BYTES),
            # Live streams stop the run (exit 101, classified UNSUPPORTED);
            # over-long videos are skipped silently (no file -> TOO_LARGE).
            "--break-match-filters",
            "!is_live",
            "--match-filters",
            f"duration <=? {config.MAX_AUDIO_SEC}",
            "--no-part",
            "--paths",
            out_dir,
            "--output",
            "media.%(ext)s",
        ],
        url,
        tmp_dir,
        config.AUDIO_TIMEOUT_SEC,
    )
    files = [f for f in os.listdir(out_dir) if f.startswith("media.")]
    if not files:
        # yt-dlp exits 0 when a match filter rejects the video.
        raise error(TOO_LARGE)
    return os.path.join(out_dir, files[0])


async def download_video(url: str, tmp_dir: str) -> str:
    """A small video stream (no audio needed) for keyframes."""
    out_dir = os.path.join(tmp_dir, "dl")
    os.makedirs(out_dir, exist_ok=True)
    await _run(video_args(out_dir), url, tmp_dir, config.FRAMES_TIMEOUT_SEC)
    files = [f for f in os.listdir(out_dir) if f.startswith("video.")]
    if not files:
        # yt-dlp exits 0 when a match filter rejects the video.
        raise error(TOO_LARGE)
    return os.path.join(out_dir, files[0])


def video_args(out_dir: str) -> list[str]:
    return [
        # Smallest stream whose short side is 240-480 px (landscape or
        # vertical), so frames stay legible without filling the tmpfs. With
        # `+size` sorting "best" means smallest, so the last resort is `bv*/b`
        # (smallest available), never `w` (which would be the largest).
        "--format",
        "bv*[height>=240][width>=240][height<=?480]"
        "/bv*[width>=240][height>=240][width<=?480]"
        "/bv*[height<=?480]/b[height<=?480]/bv*/b",
        "--format-sort",
        "+size,+br",
        "--max-filesize",
        str(config.MAX_FRAMES_DOWNLOAD_BYTES),
        "--break-match-filters",
        "!is_live",
        "--match-filters",
        f"duration <=? {config.MAX_AUDIO_SEC}",
        "--no-part",
        "--paths",
        out_dir,
        "--output",
        "video.%(ext)s",
    ]
