from typing import Any

import pytest
from starlette.testclient import TestClient

from capture_worker import app as app_module
from capture_worker import config
from capture_worker.errors import error

TOKEN = "t" * 40
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def client(tmp_path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("CAPTURE_TMP_DIR", str(tmp_path))
    return TestClient(app_module.build_app(TOKEN))


def test_health_is_public(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert isinstance(body["ytDlp"], str) and body["ytDlp"]


def test_health_reports_dead_proxy(tmp_path) -> None:
    client = TestClient(app_module.build_app(TOKEN, proxy_alive=lambda: False))
    assert client.get("/health").status_code == 503


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Bearer wrong"},
        {"Authorization": TOKEN},
        {"Authorization": f"bearer {TOKEN}"},
    ],
)
@pytest.mark.parametrize("path", ["/v1/extract", "/v1/audio", "/v1/file"])
def test_endpoints_require_token(client: TestClient, path: str, headers: dict) -> None:
    response = client.post(path, json={"url": "https://example.com"}, headers=headers)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_unknown_paths_also_require_token(client: TestClient) -> None:
    assert client.get("/v1/anything").status_code == 401


def test_invalid_url_is_400(client: TestClient) -> None:
    response = client.post("/v1/extract", json={"url": "file:///etc/passwd"}, headers=AUTH)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_URL"
    response = client.post("/v1/extract", content=b"not json", headers=AUTH)
    assert response.status_code == 400


def test_json_body_limit(client: TestClient) -> None:
    big = {"url": "https://example.com/", "pad": "x" * (config.MAX_JSON_BODY + 1)}
    response = client.post("/v1/extract", json=big, headers=AUTH)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "TOO_LARGE"


def test_streamed_body_limit_without_content_length(client: TestClient) -> None:
    def chunks():
        for _ in range(4):
            yield b"x" * config.MAX_JSON_BODY

    response = client.post("/v1/extract", content=chunks(), headers=AUTH)
    assert response.status_code == 413


def test_token_must_be_long_enough(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CAPTURE_WORKER_TOKEN", "short")
    with pytest.raises(SystemExit):
        config.load_token()
    monkeypatch.delenv("CAPTURE_WORKER_TOKEN")
    with pytest.raises(SystemExit):
        config.load_token()
    monkeypatch.setenv("CAPTURE_WORKER_TOKEN", TOKEN)
    assert config.load_token() == TOKEN


def test_errors_map_to_status(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    async def blocked(url: str) -> dict[str, Any]:
        raise error("RATE_LIMITED")

    monkeypatch.setattr(app_module, "extract_url", blocked)
    response = client.post("/v1/extract", json={"url": "https://example.com/"}, headers=AUTH)
    assert response.status_code == 503
    assert response.json() == {
        "error": {
            "code": "RATE_LIMITED",
            "message": "The platform is rate-limiting requests from this server.",
            "retryable": True,
        }
    }


def test_unexpected_exceptions_do_not_leak(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def boom(url: str) -> dict[str, Any]:
        raise RuntimeError("Traceback with https://secret.test/?token=abc")

    monkeypatch.setattr(app_module, "extract_url", boom)
    response = client.post("/v1/extract", json={"url": "https://example.com/"}, headers=AUTH)
    assert response.status_code == 422
    assert "secret" not in response.text and "Traceback" not in response.text


YTDLP_INFO = {
    "id": "abc123",
    "title": "A talk",
    "uploader": "Speaker",
    "channel": "Conf",
    "timestamp": 1700000000,
    "duration": 610,
    "language": "en",
    "description": "About the talk",
    "webpage_url": "https://www.youtube.com/watch?v=abc123",
    "extractor_key": "Youtube",
    "formats": [{"acodec": "opus", "vcodec": "none"}],
    "subtitles": {},
    "automatic_captions": {"en-orig": [{"ext": "vtt", "url": "https://subs.test/en.vtt"}]},
    "thumbnail": "https://i.ytimg.com/vi/abc123/maxresdefault.jpg",
}

VTT = """WEBVTT

00:00:00.000 --> 00:00:02.000
hello world

00:00:02.000 --> 00:00:04.000
second line
"""


def test_extract_shape_with_mocked_ytdlp(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from capture_worker import http, images, ytdlp

    async def fake_metadata(url: str, tmp_dir: str) -> dict[str, Any]:
        return YTDLP_INFO

    async def fake_fetch(url: str, **kwargs: Any) -> http.Fetched:
        assert url == "https://subs.test/en.vtt"
        return http.Fetched(url, 200, "text/vtt", VTT.encode())

    async def fake_images(sources, tmp_dir, limit=4):
        assert sources == [("thumbnail", YTDLP_INFO["thumbnail"])]
        assert limit == 1
        return [{"kind": "thumbnail", "mime": "image/jpeg", "dataBase64": "AAAA"}]

    monkeypatch.setattr(ytdlp, "metadata", fake_metadata)
    monkeypatch.setattr(http, "fetch", fake_fetch)
    monkeypatch.setattr(images, "download", fake_images)
    response = client.post("/v1/extract", json={"url": "https://youtu.be/abc123"}, headers=AUTH)
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {
        "platform",
        "canonicalUrl",
        "platformId",
        "title",
        "author",
        "channel",
        "publishedAt",
        "durationSec",
        "language",
        "description",
        "text",
        "textKind",
        "segments",
        "hasAudio",
        "images",
        "extractor",
    }
    assert body["platform"] == "youtube"
    assert body["canonicalUrl"] == "https://www.youtube.com/watch?v=abc123"
    assert body["platformId"] == "abc123"
    assert body["publishedAt"] == "2023-11-14T22:13:20Z"
    assert body["durationSec"] == 610.0
    assert body["language"] == "en"
    assert body["textKind"] == "captions"
    assert body["text"] == "hello world\nsecond line"
    assert body["segments"] == [
        {"startSec": 0.0, "endSec": 2.0, "text": "hello world"},
        {"startSec": 2.0, "endSec": 4.0, "text": "second line"},
    ]
    assert body["hasAudio"] is True
    assert body["extractor"] == "Youtube"
    assert body["images"][0]["kind"] == "thumbnail"


def test_youtube_without_captions_falls_back_to_description(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from capture_worker import images, ytdlp

    async def fake_metadata(url: str, tmp_dir: str) -> dict[str, Any]:
        return {**YTDLP_INFO, "automatic_captions": {}}

    async def no_images(sources, tmp_dir, limit=4):
        return []

    monkeypatch.setattr(ytdlp, "metadata", fake_metadata)
    monkeypatch.setattr(images, "download", no_images)
    body = client.post("/v1/extract", json={"url": "https://youtu.be/abc123"}, headers=AUTH).json()
    assert body["textKind"] == "description"
    assert body["text"] == "About the talk"
    assert body["hasAudio"] is True
    assert body["segments"] == []


def test_ytdlp_args_are_hardened(tmp_path) -> None:
    from capture_worker import ytdlp

    args = ytdlp.base_args(str(tmp_path))
    for flag in ("--ignore-config", "--no-plugin-dirs", "--no-remote-components"):
        assert flag in args
    assert args[args.index("--use-extractors") + 1] == "default,-generic"
    assert args[args.index("--proxy") + 1] == config.proxy_url()
    assert args[args.index("--downloader") + 1] == "native"
    joined = " ".join(args)
    for forbidden in ("--exec", "--netrc", "--cookies", "--external-downloader", "--load-info"):
        assert forbidden not in joined


def test_run_puts_double_dash_before_url(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    import asyncio

    from capture_worker import proc, ytdlp

    seen: list[list[str]] = []

    async def fake_run(args: list[str], **kwargs: Any) -> proc.Result:
        seen.append(args)
        return proc.Result(0, b"{}", b"")

    monkeypatch.setattr(proc, "run", fake_run)
    asyncio.run(ytdlp._run(["--skip-download"], "--exec=evil", str(tmp_path), 5))
    assert seen[0][-2:] == ["--", "--exec=evil"]


def test_child_env_has_no_secrets_or_bypass(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    from capture_worker import proc

    monkeypatch.setenv("CAPTURE_WORKER_TOKEN", TOKEN)
    monkeypatch.setenv("NO_PROXY", "*")
    env = proc.child_env(str(tmp_path))
    assert TOKEN not in env.values()
    assert not {k for k in env if k.lower() == "no_proxy"}
    assert env["https_proxy"] == config.proxy_url()
