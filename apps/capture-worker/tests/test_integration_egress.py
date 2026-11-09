"""SSRF integration tests against the real Smokescreen binary.

Run inside the built image (`--target test`), where /usr/local/bin/smokescreen
exists. Each test starts its own proxy with the production arguments.
"""

from __future__ import annotations

import contextlib
import os
import socket
import subprocess
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from starlette.testclient import TestClient

from capture_worker import app as app_module
from capture_worker import main

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not os.path.exists(main.SMOKESCREEN), reason="needs the worker image"),
]

TOKEN = "i" * 40
AUTH = {"Authorization": f"Bearer {TOKEN}"}
METADATA_URL = "http://169.254.169.254/latest/meta-data/"


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@contextlib.contextmanager
def _proxy(extra_args: list[str] = (), allowed_ports: str = "80,443") -> Iterator[str]:
    port = _free_port()
    process = subprocess.Popen(
        [*main.smokescreen_args(port), *extra_args],
        env={"PATH": "/usr/local/bin:/usr/bin:/bin", "SMOKESCREEN_ALLOWED_PORTS": allowed_ports},
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        assert main._wait_for_port("127.0.0.1", port, 15), "smokescreen did not start"
        yield f"http://127.0.0.1:{port}"
    finally:
        process.terminate()
        process.wait(timeout=10)


@pytest.fixture
def client(tmp_path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("CAPTURE_TMP_DIR", str(tmp_path))
    return TestClient(app_module.build_app(TOKEN))


def _extract(client: TestClient, url: str) -> dict:
    response = client.post("/v1/extract", json={"url": url}, headers=AUTH)
    assert response.status_code == 422, response.text
    return response.json()["error"]


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://127.0.0.1:1/",
        METADATA_URL,
        "https://10.0.0.1/",
        "http://2130706433/",
        "http://localhost/",
        "http://[::1]/",
        "http://[::ffff:169.254.169.254]/",
        "https://1.1.1.1:8443/",
    ],
)
def test_private_destinations_are_blocked(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, url: str
) -> None:
    with _proxy() as proxy:
        monkeypatch.setenv("CAPTURE_EGRESS_PROXY", proxy)
        assert _extract(client, url) == {
            "code": "BLOCKED_ADDRESS",
            "message": "The destination address is not allowed.",
            "retryable": False,
        }


class _Redirector(BaseHTTPRequestHandler):
    hits = 0

    def do_GET(self) -> None:  # noqa: N802 - http.server API
        type(self).hits += 1
        self.send_response(302)
        self.send_header("Location", METADATA_URL)
        self.end_headers()

    def log_message(self, *args: object) -> None:
        pass


def test_redirect_to_private_address_is_blocked(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The first hop stands in for a public site (explicitly allowed for this
    test only); its redirect to the metadata address must still be denied."""
    server = HTTPServer(("127.0.0.1", 0), _Redirector)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with _proxy(["--allow-address", f"127.0.0.1:{port}"], f"80,443,{port}") as proxy:
            monkeypatch.setenv("CAPTURE_EGRESS_PROXY", proxy)
            error = _extract(client, f"http://127.0.0.1:{port}/start")
    finally:
        server.shutdown()
    assert _Redirector.hits == 1, "the allowed first hop must be reached through the proxy"
    assert error["code"] == "BLOCKED_ADDRESS"


def test_non_web_ports_are_blocked(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    with _proxy() as proxy:
        monkeypatch.setenv("CAPTURE_EGRESS_PROXY", proxy)
        assert _extract(client, "http://example.com:8080/")["code"] == "BLOCKED_ADDRESS"
