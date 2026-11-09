"""Entrypoint: supervise the egress proxy and serve the API.

The proxy is a child process bound to 127.0.0.1. If it exits, the worker
shuts down too (non-zero) so Docker restarts the container rather than
letting requests run without egress filtering.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import signal
import socket
import sys
import time

import uvicorn

from . import config
from .app import build_app

log = logging.getLogger("capture_worker")

SMOKESCREEN = "/usr/local/bin/smokescreen"
# Smokescreen already denies private, loopback, link-local, CGNAT and
# non-global-unicast ranges; these are explicit belt-and-braces additions.
DENY_RANGES = (
    "0.0.0.0/8",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.0.0.0/24",
    "192.168.0.0/16",
    "198.18.0.0/15",
    "224.0.0.0/4",
    "240.0.0.0/4",
    "::1/128",
    "fc00::/7",
    "fe80::/10",
)

_PROXY_ENV_VARS = ("no_proxy", "NO_PROXY", "all_proxy", "ALL_PROXY")


def smokescreen_args(port: int = config.PROXY_PORT) -> list[str]:
    args = [
        SMOKESCREEN,
        "--listen-ip",
        config.PROXY_HOST,
        "--listen-port",
        str(port),
        "--timeout",
        "15s",
        "--dns-timeout",
        "10s",
        "--max-concurrent-connect-tunnels",
        "64",
    ]
    for cidr in DENY_RANGES:
        args += ["--deny-range", cidr]
    return args


def _wait_for_port(host: str, port: int, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with contextlib.suppress(OSError), socket.create_connection((host, port), timeout=0.5):
            return True
        time.sleep(0.1)
    return False


async def _serve(token: str) -> int:
    proxy = await asyncio.create_subprocess_exec(
        *smokescreen_args(),
        stdin=asyncio.subprocess.DEVNULL,
        env={"PATH": "/usr/local/bin:/usr/bin:/bin", "SMOKESCREEN_ALLOWED_PORTS": "80,443"},
    )
    if not await asyncio.to_thread(_wait_for_port, config.PROXY_HOST, config.PROXY_PORT, 15):
        log.error("egress proxy did not start")
        proxy.kill()
        return 1

    app = build_app(token, proxy_alive=lambda: proxy.returncode is None)
    server = uvicorn.Server(
        uvicorn.Config(
            app,
            host="0.0.0.0",  # noqa: S104 - reachable only on the internal Docker network
            port=config.LISTEN_PORT,
            log_level="info",
            access_log=False,
            proxy_headers=False,
            server_header=False,
            timeout_graceful_shutdown=10,
        )
    )

    async def watch_proxy() -> None:
        code = await proxy.wait()
        log.error("egress proxy exited (%s); shutting down", code)
        server.should_exit = True

    watcher = asyncio.create_task(watch_proxy())
    try:
        await server.serve()
    finally:
        watcher.cancel()
        if proxy.returncode is None:
            proxy.send_signal(signal.SIGTERM)
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(proxy.wait(), timeout=5)
    return 0 if proxy.returncode in (None, 0, -signal.SIGTERM) and server.started else 1


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    token = config.load_token()
    # Nothing may bypass the egress proxy.
    for name in _PROXY_ENV_VARS:
        os.environ.pop(name, None)
    sys.exit(asyncio.run(_serve(token)))


if __name__ == "__main__":
    main()
