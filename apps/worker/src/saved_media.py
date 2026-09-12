"""Saved-media download and upload-reuse helpers."""

from __future__ import annotations

import mimetypes
import os
import tempfile
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from . import events, saved_media_db, storage, uploaded_media, ytdl
from .cancellation import CancelledException
from .job_lease import JobLeaseLostError
from .pipeline_errors import PermanentError
from .safe_diagnostics import error_diagnostic

RetryTransient = Callable[..., Awaitable[Any]]
CheckCancel = Callable[[str], None]


def max_bytes() -> int:
    raw = (os.environ.get("SAVED_MEDIA_MAX_BYTES") or "2147483648").strip()
    try:
        value = int(raw)
    except ValueError:
        value = 2 * 1024 * 1024 * 1024
    return min(max(value, 50 * 1024 * 1024), 10 * 1024 * 1024 * 1024)


async def download_media(
    url: str,
    out_dir: Path,
    *,
    user_id: str,
    max_size: int,
) -> Path:
    """Download one public video without adding it to the knowledge base."""
    base_opts = await ytdl._runtime_options()

    def enforce_size(progress: dict[str, Any]) -> None:
        downloaded = int(progress.get("downloaded_bytes") or 0)
        estimate = int(progress.get("total_bytes") or progress.get("total_bytes_estimate") or 0)
        if downloaded > max_size or estimate > max_size:
            raise RuntimeError("SAVED_MEDIA_TOO_LARGE")

    opts = {
        **base_opts,
        "format": "bestvideo*+bestaudio/best",
        "merge_output_format": "mp4",
        "outtmpl": str(out_dir / "%(id).160B.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "max_filesize": max_size,
        "progress_hooks": [enforce_size],
    }
    await ytdl._download_with_cookies(url, opts, user_id=user_id)
    candidates = [
        path
        for path in out_dir.iterdir()
        if path.is_file() and not path.name.endswith((".part", ".ytdl"))
    ]
    if not candidates:
        raise RuntimeError("A mídia não foi baixada.")
    result = max(candidates, key=lambda path: path.stat().st_size)
    if result.stat().st_size <= 0:
        raise RuntimeError("A mídia baixada está vazia.")
    if result.stat().st_size > max_size:
        raise RuntimeError("SAVED_MEDIA_TOO_LARGE")
    return result


async def run_download(
    *,
    job_id: str,
    user_id: str,
    media_id: str,
    log: Any,
    retry_transient: RetryTransient,
    check_cancel: CheckCancel,
) -> None:
    media = await saved_media_db.get(user_id, media_id)
    if not media:
        raise PermanentError.public("SAVED_MEDIA_MISSING", "Registro de mídia não encontrado.")
    if media["status"] == "READY":
        from . import db

        await db.mark_job_done(job_id)
        await events.publish_job_event(user_id, job_id, "done", percent=100)
        return
    if not await saved_media_db.mark_downloading(user_id, media_id):
        raise PermanentError.public(
            "SAVED_MEDIA_STATE_INVALID", "A mídia não pode ser baixada neste estado."
        )

    source_url = str(media["canonicalUrl"] or media["sourceUrl"])
    check_cancel(job_id)
    await events.publish_job_event(user_id, job_id, "probing_media", percent=5)
    probe_info = await retry_transient(lambda: ytdl.probe(source_url, user_id=user_id), tries=3)
    if probe_info.duration_sec > ytdl.MAX_DURATION_SEC:
        raise PermanentError.public(
            "SAVED_MEDIA_TOO_LONG", "O vídeo excede a duração máxima de 4 horas."
        )

    with tempfile.TemporaryDirectory(prefix="voxen-saved-media-") as tmp:
        check_cancel(job_id)
        await events.publish_job_event(user_id, job_id, "downloading_media", percent=20)
        try:
            downloaded = await retry_transient(
                lambda: download_media(
                    source_url,
                    Path(tmp),
                    user_id=user_id,
                    max_size=max_bytes(),
                ),
                tries=3,
            )
        except RuntimeError as exc:
            if "SAVED_MEDIA_TOO_LARGE" in str(exc):
                raise PermanentError.public(
                    "SAVED_MEDIA_TOO_LARGE", "O arquivo excede o limite de download configurado."
                ) from exc
            raise

        suffix = downloaded.suffix.lower() or ".bin"
        filename = uploaded_media.sanitize_filename(
            f"{probe_info.title or probe_info.video_id}{suffix}"
        )
        mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        byte_size = downloaded.stat().st_size
        object_key = storage.upload_key(user_id, media_id, filename)
        check_cancel(job_id)
        await events.publish_job_event(user_id, job_id, "storing_media", percent=80)
        await retry_transient(
            lambda: storage.put_file(
                key=object_key,
                path=downloaded,
                content_type=mime_type,
            ),
            tries=3,
        )
        try:
            check_cancel(job_id)
        except CancelledException:
            await _delete_object_best_effort(object_key, log)
            raise
        try:
            await saved_media_db.complete_download(
                job_id=job_id,
                user_id=user_id,
                media_id=media_id,
                title=probe_info.title,
                channel=probe_info.channel,
                author=probe_info.author,
                duration_sec=probe_info.duration_sec,
                thumbnail_url=probe_info.thumbnail_url,
                object_key=object_key,
                filename=filename,
                mime_type=mime_type,
                byte_size=byte_size,
                canonical_url=str(media["canonicalUrl"]),
            )
        except JobLeaseLostError:
            current = await saved_media_db.get(user_id, media_id)
            if current and current.get("status") == "FAILED":
                await _delete_object_best_effort(object_key, log)
            raise
        except Exception:
            await _delete_object_best_effort(object_key, log)
            raise

    try:
        await events.publish_job_event(user_id, job_id, "media_ready", percent=95)
        await events.publish_job_event(user_id, job_id, "done", percent=100)
    except Exception as exc:  # noqa: BLE001 - delivery is best effort after commit
        log.warning(
            "saved-media-terminal-event-failed",
            **error_diagnostic(exc, "SAVED_MEDIA_TERMINAL_EVENT_FAILED"),
        )
    log.info("saved-media-ready", saved_media_id=media_id, bytes=byte_size)


async def _delete_object_best_effort(object_key: str, log: Any) -> None:
    try:
        await storage.delete_object(key=object_key)
    except Exception as exc:  # noqa: BLE001 - cleanup cannot hide terminal state
        log.warning(
            "saved-media-object-cleanup-failed",
            **error_diagnostic(exc, "SAVED_MEDIA_OBJECT_CLEANUP_FAILED"),
        )


async def fail_job(
    job_id: str,
    user_id: str,
    media_id: str | None,
    message: str,
) -> None:
    if not media_id:
        raise JobLeaseLostError("saved media job lost its media relation")
    await saved_media_db.fail_job_and_media(job_id, user_id, media_id, message)


async def resolve_upload(
    user_id: str,
    media_id: str | None,
    ref: uploaded_media.UploadedMediaRef,
) -> dict[str, Any] | None:
    if not media_id:
        return None
    media = await saved_media_db.get(user_id, media_id)
    expected_key = storage.upload_key(user_id, ref.upload_id, ref.filename)
    if not media or ref.upload_id != media_id or media.get("objectKey") != expected_key:
        raise PermanentError.public(
            "SAVED_MEDIA_INVALID", "A mídia salva não corresponde ao arquivo solicitado."
        )
    return media


def upload_probe(
    ref: uploaded_media.UploadedMediaRef,
    duration_sec: int,
    media: dict[str, Any] | None,
) -> ytdl.VideoProbe:
    def value(key: str) -> str | None:
        return str(media[key]) if media and media.get(key) else None

    return ytdl.VideoProbe(
        video_id=ref.upload_id,
        title=value("title") or Path(ref.filename).stem or ref.filename,
        channel=value("channel") or "Upload local",
        duration_sec=duration_sec,
        published_at=None,
        thumbnail_url=value("thumbnailUrl"),
        language_hint=None,
        available_subtitles={},
        automatic_captions={},
        author=value("author"),
        canonical_url=value("canonicalUrl"),
    )


def original_source(media: dict[str, Any] | None, fallback: str) -> str:
    return str(media["canonicalUrl"]) if media and media.get("canonicalUrl") else fallback
