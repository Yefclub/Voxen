"""yt-dlp as a hardened subprocess.

Every invocation uses `--ignore-config --no-plugin-dirs --no-remote-components`,
the default extractors minus `generic`, the egress proxy, the native downloader
and `--` before the URL. Never `--exec`, `--netrc-cmd`, cookies or external
downloaders.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from . import captions, config, http, images, proc
from .errors import (
    TOO_LARGE,
    UNSUPPORTED,
    CaptureError,
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


async def _run(extra: list[str], url: str, tmp_dir: str, timeout: float) -> proc.Result:
    result = await proc.run(
        [*base_args(tmp_dir), *extra, "--", url], tmp_dir=tmp_dir, timeout=timeout
    )
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace")
        classified = classify_ytdlp_stderr(stderr)
        log.warning("yt-dlp failed (%s): %s", classified.code, redact(stderr))
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


async def extract(platform: str, url: str, tmp_dir: str) -> dict[str, Any]:
    info = await metadata(url, tmp_dir)
    if info.get("is_live"):
        raise error(UNSUPPORTED)
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
