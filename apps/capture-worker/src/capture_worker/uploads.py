"""`POST /v1/file`: multipart upload streamed to tmpfs, then audio/video,
image, PDF or text handling. No network access is needed here."""

from __future__ import annotations

import os
from typing import Any

from python_multipart import create_form_parser
from python_multipart.exceptions import FormParserError
from python_multipart.multipart import Field, File
from starlette.requests import Request

from . import config, media, web
from .errors import NO_TEXT, TOO_LARGE, UNSUPPORTED, error
from .result import empty_result

_MAX_FIELDS = 8
_TEXT_TYPES = ("text/plain", "text/markdown", "text/x-markdown")
_TEXT_EXTENSIONS = (".txt", ".md", ".markdown")


async def _parse(request: Request, tmp_dir: str) -> tuple[dict[str, str], File]:
    content_type = request.headers.get("content-type", "")
    if not content_type.startswith("multipart/form-data"):
        raise error(UNSUPPORTED)
    fields: dict[str, str] = {}
    files: list[File] = []

    def on_field(field: Field) -> None:
        if len(fields) >= _MAX_FIELDS:
            raise error(UNSUPPORTED)
        name = (field.field_name or b"").decode("utf-8", errors="replace")
        fields[name] = (field.value or b"").decode("utf-8", errors="replace")[:1024]

    def on_file(file: File) -> None:
        files.append(file)
        if len(files) > 1:
            raise error(UNSUPPORTED)

    try:
        parser = create_form_parser(
            {"Content-Type": content_type.encode("latin-1")},
            on_field,
            on_file,
            config={"UPLOAD_DIR": tmp_dir, "MAX_MEMORY_FILE_SIZE": 0, "UPLOAD_DELETE_TMP": False},
        )
        async for chunk in request.stream():
            parser.write(chunk)
        parser.finalize()
    except (FormParserError, ValueError) as exc:
        raise error(UNSUPPORTED) from exc
    upload = next((f for f in files if f.field_name == b"file"), None)
    if upload is None:
        raise error(UNSUPPORTED)
    upload.flush_to_disk()
    upload.close()
    return fields, upload


def _kind(content_type: str, filename: str) -> str:
    ctype = content_type.split(";", 1)[0].strip().lower()
    name = filename.lower()
    if ctype.startswith(("audio/", "video/")):
        return "av"
    if ctype.startswith("image/"):
        return "image"
    if ctype == "application/pdf" or name.endswith(".pdf"):
        return "pdf"
    if ctype in _TEXT_TYPES or name.endswith(_TEXT_EXTENSIONS):
        return "text"
    return "unknown"


async def handle(request: Request, tmp_dir: str) -> dict[str, Any]:
    fields, upload = await _parse(request, tmp_dir)
    path = os.fsdecode(upload.actual_file_name or b"")
    if not path or not os.path.exists(path) or os.path.getsize(path) == 0:
        raise error(NO_TEXT)
    filename = os.path.basename(fields.get("filename") or "")
    content_type = fields.get("contentType") or ""
    fmt = fields.get("format", "mp3")
    if fmt not in media.AUDIO_FORMATS:
        raise error(UNSUPPORTED)
    result = empty_result("other", "", "upload")
    result["title"] = filename or None
    kind = _kind(content_type, filename)

    if kind == "av":
        probe = await media.probe(path, tmp_dir)
        result["durationSec"] = probe.duration
        result["hasVideo"] = probe.has_video
        if probe.has_video:
            # Upload keyframes are video keyframes (spec 221): same kind and
            # schedule as /v1/frames.
            times, _ = await media.video_frame_times(path, probe.duration, tmp_dir)
            result["images"] = await media.keyframes(
                path, probe.duration, tmp_dir, kind="frame", times=times
            )
        if probe.has_audio:
            result["hasAudio"] = True
            result["audio"] = await media.audio_chunks(path, tmp_dir, fmt)
        elif not result["images"]:
            raise error(NO_TEXT)
        return result
    if kind == "image":
        image = await media.to_jpeg(path, "post_media", tmp_dir)
        if image is None:
            raise error(UNSUPPORTED)
        result["images"] = [image]
        return result
    if kind == "pdf":
        if os.path.getsize(path) > config.MAX_UPLOAD_BYTES:
            raise error(TOO_LARGE)
        text, title = await web.pdf_text_isolated(path, tmp_dir)
        if not text:
            raise error(NO_TEXT)
        result.update(text=text, textKind="page", title=title or result["title"])
        return result
    if kind == "text":
        with open(path, "rb") as handle_:
            text = handle_.read(20 * 1024 * 1024).decode("utf-8", errors="replace").strip()
        if not text:
            raise error(NO_TEXT)
        result.update(text=text, textKind="page")
        return result
    raise error(UNSUPPORTED)
