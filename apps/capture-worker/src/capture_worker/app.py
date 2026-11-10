"""HTTP API. Every endpoint except `GET /health` requires the bearer token."""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import json
import logging
import shutil
import tempfile
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import config, media, routing, uploads, web, x, ytdlp
from .errors import (
    INVALID_URL,
    TOO_LARGE,
    UNKNOWN,
    UNSUPPORTED,
    CaptureError,
    classify_exception,
    error,
)

log = logging.getLogger("capture_worker.app")

# Heavy work (audio, uploads) is serialized: tmpfs and memory are shared.
_HEAVY = asyncio.Semaphore(1)
_EXTRACT = asyncio.Semaphore(4)

ProxyAlive = Callable[[], bool]


def _error_response(exc: CaptureError) -> JSONResponse:
    return JSONResponse(exc.to_dict(), status_code=exc.http_status)


class BearerAuthMiddleware:
    """Constant-time bearer check on everything except GET /health."""

    def __init__(self, app: ASGIApp, token: str) -> None:
        self.app = app
        self.expected = f"Bearer {token}".encode()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or (
            scope["path"] == "/health" and scope["method"] in ("GET", "HEAD")
        ):
            await self.app(scope, receive, send)
            return
        provided = b""
        for name, value in scope.get("headers") or []:
            if name == b"authorization":
                provided = value
                break
        if not hmac.compare_digest(provided, self.expected):
            response = JSONResponse(
                {"error": {"code": "UNAUTHORIZED", "message": "Unauthorized", "retryable": False}},
                status_code=401,
                headers={"WWW-Authenticate": "Bearer"},
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


class BodyLimitMiddleware:
    """Rejects bodies over the per-path limit, by header and while streaming."""

    def __init__(self, app: ASGIApp, limits: dict[str, int], default: int) -> None:
        self.app = app
        self.limits = limits
        self.default = default

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = self.limits.get(scope["path"], self.default)
        for name, value in scope.get("headers") or []:
            if name == b"content-length":
                if not value.isdigit() or int(value) > limit:
                    await _error_response(error(TOO_LARGE))(scope, receive, send)
                    return
        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise _BodyTooLargeError
            return message

        # Handlers read bodies inside `_guard`, which turns the overflow into a
        # TOO_LARGE response.
        await self.app(scope, limited_receive, send)


class _BodyTooLargeError(Exception):
    pass


@contextlib.asynccontextmanager
async def _workdir() -> AsyncIterator[str]:
    path = tempfile.mkdtemp(prefix="cw-", dir=config.tmp_root())
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


async def _json_body(request: Request) -> dict[str, Any]:
    try:
        body = json.loads(await request.body())
    except ValueError as exc:
        raise error(INVALID_URL) from exc
    if not isinstance(body, dict):
        raise error(INVALID_URL)
    return body


async def _url_from_body(request: Request) -> str:
    return routing.validate_url((await _json_body(request)).get("url"))


def audio_format(value: object) -> str:
    """Optional `format` field: "mp3" (default) or "wav"."""
    if value is None:
        return "mp3"
    if value not in media.AUDIO_FORMATS:
        raise error(UNSUPPORTED)
    return str(value)


async def _guard(work: Callable[[], Awaitable[dict[str, Any]]]) -> Response:
    try:
        return JSONResponse(await work())
    except _BodyTooLargeError:
        return _error_response(error(TOO_LARGE))
    except Exception as exc:  # every failure becomes a typed error object
        classified = classify_exception(exc)
        if classified.code == UNKNOWN and not isinstance(exc, CaptureError):
            log.exception("unexpected failure")
        return _error_response(classified)


async def extract_url(url: str) -> dict[str, Any]:
    target = routing.route(url)
    async with _EXTRACT, _workdir() as tmp_dir:
        if target.platform == "x" and target.x_status_id:
            return await asyncio.wait_for(
                x.extract(target.x_status_id, tmp_dir), config.EXTRACT_TIMEOUT_SEC
            )
        if target.use_ytdlp:
            return await asyncio.wait_for(
                ytdlp.extract(target.platform, url, tmp_dir),
                config.EXTRACT_TIMEOUT_SEC + 60 + config.COMMENTS_TIMEOUT_SEC,
            )
        return await asyncio.wait_for(web.extract(url, tmp_dir), config.EXTRACT_TIMEOUT_SEC)


async def audio_url(url: str, fmt: str = "mp3") -> dict[str, Any]:
    async with _HEAVY, _workdir() as tmp_dir:
        source = await ytdlp.download_audio(url, tmp_dir)
        return await media.audio_chunks(source, tmp_dir, fmt)


async def frames_url(url: str) -> dict[str, Any]:
    """Up to MAX_IMAGES keyframes from a small video stream, within its own
    budget (queueing for the heavy slot does not count)."""
    async with _HEAVY, _workdir() as tmp_dir:
        return await asyncio.wait_for(_frames(url, tmp_dir), config.FRAMES_TIMEOUT_SEC)


async def _frames(url: str, tmp_dir: str) -> dict[str, Any]:
    source = await ytdlp.download_video(url, tmp_dir)
    probe = await media.probe(source, tmp_dir)
    if not probe.has_video:
        raise error(UNSUPPORTED)
    times, duration = await media.video_frame_times(source, probe.duration, tmp_dir)
    if duration is not None and duration > config.MAX_AUDIO_SEC:
        raise error(TOO_LARGE)
    images = await media.keyframes(source, duration, tmp_dir, kind="frame", times=times)
    if not images:
        raise error(UNSUPPORTED)
    return {
        "durationSec": round(duration, 3) if duration is not None else None,
        "images": images,
    }


def build_app(token: str, proxy_alive: ProxyAlive | None = None) -> ASGIApp:
    async def health(_: Request) -> Response:
        from yt_dlp.version import __version__ as yt_dlp_version

        alive = proxy_alive() if proxy_alive else True
        return JSONResponse(
            {"ok": alive, "ytDlp": yt_dlp_version}, status_code=200 if alive else 503
        )

    async def extract(request: Request) -> Response:
        async def work() -> dict[str, Any]:
            return await extract_url(await _url_from_body(request))

        return await _guard(work)

    async def audio(request: Request) -> Response:
        async def work() -> dict[str, Any]:
            body = await _json_body(request)
            fmt = audio_format(body.get("format"))
            return await audio_url(routing.validate_url(body.get("url")), fmt)

        return await _guard(work)

    async def frames(request: Request) -> Response:
        async def work() -> dict[str, Any]:
            return await frames_url(await _url_from_body(request))

        return await _guard(work)

    async def file(request: Request) -> Response:
        async def work() -> dict[str, Any]:
            async with _HEAVY, _workdir() as tmp_dir:
                return await uploads.handle(request, tmp_dir)

        return await _guard(work)

    app = Starlette(
        routes=[
            Route("/health", health, methods=["GET"]),
            Route("/v1/extract", extract, methods=["POST"]),
            Route("/v1/audio", audio, methods=["POST"]),
            Route("/v1/frames", frames, methods=["POST"]),
            Route("/v1/file", file, methods=["POST"]),
        ]
    )
    limited = BodyLimitMiddleware(
        app,
        limits={"/v1/file": config.MAX_UPLOAD_BYTES + 1024 * 1024},
        default=config.MAX_JSON_BODY,
    )
    return BearerAuthMiddleware(limited, token)
