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


AUDIO_FORMATS = ("mp3", "wav")


async def audio_chunks(source: str, tmp_dir: str, fmt: str = "mp3") -> dict[str, object]:
    """Speech-ready audio chunks: MP3 (default) or WAV. A WAV request for audio
    of unknown duration or longer than MAX_WAV_SEC returns MP3 instead; the
    chunk `mime` tells the caller which one it got (no second download)."""
    if fmt == "wav":
        info = await probe(source, tmp_dir)
        if info.duration is not None and info.duration <= config.MAX_WAV_SEC:
            return await _wav_chunks(source, tmp_dir)
        return await _mp3_chunks(source, tmp_dir)
    if fmt != "mp3":
        raise error(UNSUPPORTED)
    return await _mp3_chunks(source, tmp_dir)


async def _mp3_chunks(source: str, tmp_dir: str) -> dict[str, object]:
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
    chunks, _ = await _collect_chunks(tmp_dir, "audio/mpeg", config.AUDIO_CHUNK_SEC)
    return {"durationSec": round(duration, 3), "chunks": chunks}


async def _wav_chunks(source: str, tmp_dir: str) -> dict[str, object]:
    """16 kHz mono PCM s16le WAV in chunks of at most 8 minutes, only for
    sources of known duration up to 1 h (the caller falls back to MP3 on
    TOO_LARGE).

    Encoded and split in one pass (no full-length intermediate file); `-t`
    also bounds the output in case the reported duration is wrong."""
    info = await probe(source, tmp_dir)
    if not info.has_audio:
        raise error(UNSUPPORTED)
    if info.duration is None or info.duration > config.MAX_WAV_SEC:
        raise error(TOO_LARGE)
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
            "-t",
            str(config.MAX_WAV_SEC + 1),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            "-f",
            "segment",
            "-segment_format",
            "wav",
            "-segment_time",
            str(config.WAV_CHUNK_SEC),
            "-reset_timestamps",
            "1",
            os.path.join(tmp_dir, "chunk_%03d.wav"),
        ],
        tmp_dir,
    )
    chunks, duration = await _collect_chunks(tmp_dir, "audio/wav", config.WAV_CHUNK_SEC)
    if duration > config.MAX_WAV_SEC:
        raise error(TOO_LARGE)
    return {"durationSec": round(duration, 3), "chunks": chunks}


async def _collect_chunks(
    tmp_dir: str, mime: str, chunk_sec: int
) -> tuple[list[dict[str, object]], float]:
    """Reads and deletes `chunk_*` files in order; returns them and their total length."""
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
                "mime": mime,
                "dataBase64": base64.b64encode(data).decode("ascii"),
            }
        )
        start += chunk_probe.duration or float(chunk_sec)
    return chunks, start


def evenly_spaced(duration: float) -> list[float]:
    """Up to MAX_IMAGES times evenly spaced over `duration`, one per whole
    second for videos shorter than MAX_IMAGES seconds (at least one)."""
    n = max(1, min(config.MAX_IMAGES, int(duration)))
    return [duration * (i + 1) / (n + 1) for i in range(n)]


_FALLBACK_POSITIONS = (0.10, 0.35, 0.60, 0.85)


async def packet_times(source: str, tmp_dir: str) -> list[float]:
    """Sorted presentation times of the first video stream's packets."""
    result = await proc.run(
        [
            FFPROBE,
            "-v",
            "error",
            *_INPUT_FLAGS,
            "-select_streams",
            "v:0",
            "-show_entries",
            "packet=pts_time",
            "-of",
            "csv=p=0",
            source,
        ],
        tmp_dir=tmp_dir,
        timeout=120,
    )
    if result.returncode != 0:
        raise error(UNSUPPORTED)
    times: list[float] = []
    for line in result.stdout.decode("ascii", errors="replace").splitlines():
        value = _float(line.strip().rstrip(","))
        if value is not None:
            times.append(value)
    return sorted(times)


async def video_frame_times(
    source: str, duration: float | None, tmp_dir: str
) -> tuple[list[float], float | None]:
    """Frame times for `/v1/frames` and the duration they are based on.

    Evenly spaced over the known duration; otherwise at 10/35/60/85% of the
    file's video packets (fewer for clips under MAX_IMAGES seconds)."""
    if duration and duration > 0:
        return evenly_spaced(duration), duration
    times = await packet_times(source, tmp_dir)
    if not times:
        return [0.0], None
    # Input `-ss` is relative to the stream start, so packet timestamps are
    # shifted to start at zero (sources such as MPEG-TS do not start at 0).
    start = times[0]
    span = times[-1] - start
    if span < config.MAX_IMAGES:
        return evenly_spaced(span), span
    picked = [times[int(p * (len(times) - 1))] - start for p in _FALLBACK_POSITIONS]
    return picked, span


async def keyframes(
    source: str,
    duration: float | None,
    tmp_dir: str,
    kind: str = "post_media",
    times: list[float] | None = None,
) -> list[dict[str, object]]:
    """Up to MAX_IMAGES frames as JPEG, each with its `timeSec`. Without
    explicit `times`, evenly spaced over `duration` (or the first frame)."""
    if times is None:
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
        image = await _encoded_image(out, kind, tmp_dir)
        if image:
            image["timeSec"] = round(at, 3)
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
