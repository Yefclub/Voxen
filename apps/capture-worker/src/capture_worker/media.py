"""ffmpeg/ffprobe helpers. Inputs are always local files; network protocols are
disabled with `-protocol_whitelist file` so crafted playlists cannot fetch."""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from typing import Any

from . import config, proc
from .errors import TOO_LARGE, UNSUPPORTED, error

FFMPEG = os.path.join(config.FFMPEG_DIR, "ffmpeg")
FFPROBE = os.path.join(config.FFMPEG_DIR, "ffprobe")
# Local files only, and only plain container/image demuxers: playlist-style
# demuxers (hls, concat, dash) could make ffmpeg read other local files.
_FORMAT_WHITELIST = ",".join(
    [
        "aac",
        "aiff",
        "amr",
        "amrnb",
        "amrwb",
        "asf",
        "avi",
        "caf",
        "flac",
        "flv",
        "gif",
        "gif_pipe",
        "image2",
        "image2pipe",
        "jpeg_pipe",
        "png_pipe",
        "webp_pipe",
        "bmp_pipe",
        "tiff_pipe",
        "mjpeg",
        "matroska",
        "webm",
        "mov",
        "mp4",
        "m4a",
        "3gp",
        "3g2",
        "mj2",
        "mp3",
        "mpeg",
        "mpegts",
        "ogg",
        "wav",
        "w64",
    ]
)
_INPUT_FLAGS = ["-protocol_whitelist", "file", "-format_whitelist", _FORMAT_WHITELIST]
_FF = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y"]


@dataclass
class Probe:
    duration: float | None
    has_audio: bool
    has_video: bool
    width: int | None
    height: int | None


async def probe(path: str, tmp_dir: str) -> Probe:
    result = await proc.run(
        [
            FFPROBE,
            "-v",
            "error",
            *_INPUT_FLAGS,
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            path,
        ],
        tmp_dir=tmp_dir,
        timeout=60,
    )
    if result.returncode != 0:
        raise error(UNSUPPORTED)
    data: dict[str, Any] = json.loads(result.stdout or b"{}")
    streams = data.get("streams") or []
    fmt = data.get("format") or {}
    video = next(
        (
            s
            for s in streams
            if s.get("codec_type") == "video"
            and not (s.get("disposition") or {}).get("attached_pic")
        ),
        None,
    )
    duration = _float(fmt.get("duration"))
    if duration is None:
        durations = [_float(s.get("duration")) for s in streams]
        duration = max((d for d in durations if d is not None), default=None)
    return Probe(
        duration=duration,
        has_audio=any(s.get("codec_type") == "audio" for s in streams),
        has_video=video is not None,
        width=_int(video.get("width")) if video else None,
        height=_int(video.get("height")) if video else None,
    )


def _float(value: object) -> float | None:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return number if number == number and number >= 0 else None


def _int(value: object) -> int | None:
    try:
        return int(value)  # type: ignore[call-overload]
    except (TypeError, ValueError):
        return None


async def audio_chunks(source: str, tmp_dir: str) -> dict[str, object]:
    """Mono 16 kHz MP3 at 32 kbps, split into chunks of at most 20 minutes."""
    info = await probe(source, tmp_dir)
    if not info.has_audio:
        raise error(UNSUPPORTED)
    if info.duration is not None and info.duration > config.MAX_AUDIO_SEC:
        raise error(TOO_LARGE)
    mp3 = os.path.join(tmp_dir, "audio.mp3")
    await _ffmpeg(
        [
            *_INPUT_FLAGS,
            "-i",
            source,
            "-vn",
            "-sn",
            "-dn",
            "-map",
            "0:a:0",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "32k",
            "-f",
            "mp3",
            mp3,
        ],
        tmp_dir,
    )
    converted = await probe(mp3, tmp_dir)
    duration = converted.duration or info.duration or 0.0
    if duration > config.MAX_AUDIO_SEC:
        raise error(TOO_LARGE)
    pattern = os.path.join(tmp_dir, "chunk_%03d.mp3")
    await _ffmpeg(
        [
            *_INPUT_FLAGS,
            "-i",
            mp3,
            "-f",
            "segment",
            "-segment_time",
            str(config.AUDIO_CHUNK_SEC),
            "-reset_timestamps",
            "1",
            "-c",
            "copy",
            "-map",
            "0:a:0",
            pattern,
        ],
        tmp_dir,
    )
    os.remove(mp3)
    chunks: list[dict[str, object]] = []
    start = 0.0
    for name in sorted(f for f in os.listdir(tmp_dir) if f.startswith("chunk_")):
        path = os.path.join(tmp_dir, name)
        chunk_probe = await probe(path, tmp_dir)
        with open(path, "rb") as handle:
            data = handle.read()
        os.remove(path)
        chunks.append(
            {
                "startSec": round(start, 3),
                "mime": "audio/mpeg",
                "dataBase64": base64.b64encode(data).decode("ascii"),
            }
        )
        start += chunk_probe.duration or float(config.AUDIO_CHUNK_SEC)
    return {"durationSec": round(duration, 3), "chunks": chunks}


async def keyframes(source: str, duration: float | None, tmp_dir: str) -> list[dict[str, object]]:
    """Up to MAX_IMAGES evenly spaced frames as JPEG."""
    if not duration or duration <= 0:
        times = [0.0]
    else:
        n = config.MAX_IMAGES
        times = [duration * (i + 1) / (n + 1) for i in range(n)]
    images: list[dict[str, object]] = []
    for index, at in enumerate(times):
        out = os.path.join(tmp_dir, f"frame_{index}.jpg")
        try:
            await _ffmpeg(
                [
                    "-ss",
                    f"{at:.3f}",
                    *_INPUT_FLAGS,
                    "-i",
                    source,
                    "-frames:v",
                    "1",
                    "-vf",
                    "scale='min(1280,iw)':-2",
                    "-q:v",
                    "4",
                    out,
                ],
                tmp_dir,
            )
        except Exception:  # noqa: S112 - a frame past the end is not fatal
            continue
        image = await _encoded_image(out, "post_media", tmp_dir)
        if image:
            images.append(image)
    return images


async def to_jpeg(source: str, kind: str, tmp_dir: str) -> dict[str, object] | None:
    """Re-encode any decodable image to JPEG <= MAX_IMAGE_BYTES."""
    for max_side, quality in ((1600, 4), (1280, 6), (960, 9)):
        out = os.path.join(tmp_dir, f"img_{os.path.basename(source)}_{max_side}.jpg")
        scale = f"scale='if(gt(iw,ih),min({max_side},iw),-2)':'if(gt(iw,ih),-2,min({max_side},ih))'"
        try:
            await _ffmpeg(
                [
                    *_INPUT_FLAGS,
                    "-i",
                    source,
                    "-frames:v",
                    "1",
                    "-vf",
                    scale,
                    "-q:v",
                    str(quality),
                    out,
                ],
                tmp_dir,
            )
        except Exception:
            return None
        image = await _encoded_image(out, kind, tmp_dir)
        if image:
            return image
    return None


async def _encoded_image(path: str, kind: str, tmp_dir: str) -> dict[str, object] | None:
    if not os.path.exists(path):
        return None
    size = os.path.getsize(path)
    if size == 0 or size > config.MAX_IMAGE_BYTES:
        os.remove(path)
        return None
    info = await probe(path, tmp_dir)
    with open(path, "rb") as handle:
        data = handle.read()
    os.remove(path)
    image: dict[str, object] = {
        "kind": kind,
        "mime": "image/jpeg",
        "dataBase64": base64.b64encode(data).decode("ascii"),
    }
    if info.width:
        image["width"] = info.width
    if info.height:
        image["height"] = info.height
    return image


async def _ffmpeg(args: list[str], tmp_dir: str) -> None:
    result = await proc.run(
        [FFMPEG, *_FF, *args], tmp_dir=tmp_dir, timeout=config.FFMPEG_TIMEOUT_SEC
    )
    if result.returncode != 0:
        raise error(UNSUPPORTED)
