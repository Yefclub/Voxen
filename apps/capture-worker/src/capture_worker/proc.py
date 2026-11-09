"""Subprocess execution with a hard timeout and a scrubbed environment."""

from __future__ import annotations

import asyncio
import contextlib
import os
import signal
from dataclasses import dataclass

from . import config
from .errors import TIMEOUT, TOO_LARGE, error


@dataclass
class Result:
    returncode: int
    stdout: bytes
    stderr: bytes


def child_env(tmp_dir: str) -> dict[str, str]:
    """Minimal environment for tools. No secrets, no no_proxy bypass list;
    http(s)_proxy points at the egress proxy for tools that honour it."""
    proxy = config.proxy_url()
    return {
        "PATH": "/app/.venv/bin:/usr/local/bin:/usr/bin:/bin",
        "HOME": tmp_dir,
        "TMPDIR": tmp_dir,
        "XDG_CACHE_HOME": os.path.join(tmp_dir, ".cache"),
        "DENO_DIR": os.path.join(tmp_dir, ".deno"),
        "DENO_NO_UPDATE_CHECK": "1",
        "LANG": "C.UTF-8",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONPATH": os.environ.get("PYTHONPATH", ""),
        "http_proxy": proxy,
        "https_proxy": proxy,
        "HTTP_PROXY": proxy,
        "HTTPS_PROXY": proxy,
    }


async def run(
    args: list[str], *, tmp_dir: str, timeout: float, max_stdout: int = 64 * 1024 * 1024
) -> Result:
    process = await asyncio.create_subprocess_exec(
        *args,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=child_env(tmp_dir),
        cwd=tmp_dir,
        start_new_session=True,
    )
    try:
        stdout, stderr = await asyncio.wait_for(_communicate(process, max_stdout), timeout=timeout)
    except TimeoutError:
        await _terminate(process)
        raise error(TIMEOUT) from None
    except asyncio.CancelledError:
        await _terminate(process)
        raise
    return Result(process.returncode or 0, stdout, stderr)


async def _communicate(process: asyncio.subprocess.Process, max_stdout: int) -> tuple[bytes, bytes]:
    assert process.stdout is not None and process.stderr is not None

    async def read_limited(stream: asyncio.StreamReader, limit: int) -> bytes:
        chunks: list[bytes] = []
        size = 0
        while chunk := await stream.read(65536):
            size += len(chunk)
            if size > limit:
                raise error(TOO_LARGE)
            chunks.append(chunk)
        return b"".join(chunks)

    try:
        stdout, stderr = await asyncio.gather(
            read_limited(process.stdout, max_stdout), read_limited(process.stderr, 4 * 1024 * 1024)
        )
    except BaseException:
        await _terminate(process)
        raise
    await process.wait()
    return stdout, stderr


async def _terminate(process: asyncio.subprocess.Process) -> None:
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(process.pid, signal.SIGKILL)
    with contextlib.suppress(Exception):
        await asyncio.wait_for(process.wait(), timeout=5)
