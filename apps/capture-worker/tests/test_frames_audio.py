import asyncio
import os
from typing import Any

import pytest
from starlette.testclient import TestClient

from capture_worker import app as app_module
from capture_worker import config, media, proc, ytdlp

TOKEN = "f" * 40
AUTH = {"Authorization": f"Bearer {TOKEN}"}
URL = "https://www.youtube.com/watch?v=abc123"


@pytest.fixture
def client(tmp_path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("CAPTURE_TMP_DIR", str(tmp_path))
    return TestClient(app_module.build_app(TOKEN))


def _fake_download(paths: list[str]):
    async def download(url: str, tmp_dir: str) -> str:
        path = os.path.join(tmp_dir, "video.mp4")
        with open(path, "wb") as handle:
            handle.write(b"fake")
        paths.append(path)
        return path

    return download


def _fake_probe(duration: float | None, has_video: bool = True):
    async def probe(path: str, tmp_dir: str) -> media.Probe:
        return media.Probe(duration, False, has_video, 640 if has_video else None, 360)

    return probe


def test_frames_shape_and_cleanup(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    downloaded: list[str] = []
    seen: dict[str, Any] = {}

    async def fake_keyframes(source, duration, tmp_dir, kind="post_media", times=None):
        seen.update(source=source, duration=duration, kind=kind, times=times)
        return [
            {"kind": kind, "mime": "image/jpeg", "dataBase64": "AAAA", "timeSec": round(t, 3)}
            for t in times
        ]

    monkeypatch.setattr(ytdlp, "download_video", _fake_download(downloaded))
    monkeypatch.setattr(media, "probe", _fake_probe(120.4567))
    monkeypatch.setattr(media, "keyframes", fake_keyframes)
    response = client.post("/v1/frames", json={"url": URL}, headers=AUTH)
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"durationSec", "images"}
    assert body["durationSec"] == 120.457
    assert [i["timeSec"] for i in body["images"]] == [24.091, 48.183, 72.274, 96.365]
    assert all(i["kind"] == "frame" and i["mime"] == "image/jpeg" for i in body["images"])
    assert seen["kind"] == "frame" and seen["duration"] == 120.4567
    # The work directory (and the downloaded video) is removed afterwards.
    assert not os.path.exists(downloaded[0])
    assert [p for p in os.listdir(tmp_path) if p.startswith("cw-")] == []


def test_frames_rejects_over_three_hours(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def must_not_run(*args: Any, **kwargs: Any) -> list[dict[str, object]]:
        raise AssertionError("no keyframes for over-long videos")

    monkeypatch.setattr(ytdlp, "download_video", _fake_download([]))
    monkeypatch.setattr(media, "probe", _fake_probe(config.MAX_AUDIO_SEC + 1))
    monkeypatch.setattr(media, "keyframes", must_not_run)
    response = client.post("/v1/frames", json={"url": URL}, headers=AUTH)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "TOO_LARGE"


@pytest.mark.parametrize("has_video", [False, True])
def test_frames_without_video_or_frames_is_unsupported(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, has_video: bool
) -> None:
    async def no_frames(*args: Any, **kwargs: Any) -> list[dict[str, object]]:
        return []

    monkeypatch.setattr(ytdlp, "download_video", _fake_download([]))
    monkeypatch.setattr(media, "probe", _fake_probe(30.0, has_video=has_video))
    monkeypatch.setattr(media, "keyframes", no_frames)
    response = client.post("/v1/frames", json={"url": URL}, headers=AUTH)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "UNSUPPORTED"


@pytest.mark.parametrize(
    ("stderr", "code", "status"),
    [
        (b"ERROR: [youtube] abc: Sign in to confirm you're not a bot", "IP_BLOCKED", 422),
        (b"ERROR: [youtube] abc: Private video. Sign in", "LOGIN_REQUIRED", 422),
        (b"ERROR: HTTP Error 429: Too Many Requests", "RATE_LIMITED", 503),
        (b"ERROR: [youtube] abc: Video unavailable", "REMOVED", 422),
        (b"ERROR: Unsupported URL: https://e.test/?token=s3cret", "UNSUPPORTED", 422),
    ],
)
def test_frames_errors_use_the_classifier(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, stderr: bytes, code: str, status: int
) -> None:
    async def failing(args: list[str], **kwargs: Any) -> proc.Result:
        return proc.Result(1, b"", stderr)

    monkeypatch.setattr(proc, "run", failing)
    response = client.post("/v1/frames", json={"url": URL}, headers=AUTH)
    assert response.status_code == status
    assert response.json()["error"]["code"] == code
    assert "s3cret" not in response.text


def test_frames_match_filter_skip_is_too_large(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def skipped(args: list[str], **kwargs: Any) -> proc.Result:
        return proc.Result(0, b"", b"")

    monkeypatch.setattr(proc, "run", skipped)
    response = client.post("/v1/frames", json={"url": URL}, headers=AUTH)
    assert response.status_code == 413


def test_frames_rejects_invalid_urls(client: TestClient) -> None:
    response = client.post("/v1/frames", json={"url": "file:///etc/passwd"}, headers=AUTH)
    assert response.status_code == 400


def test_video_download_args(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    seen: list[list[str]] = []

    async def fake_run(args: list[str], **kwargs: Any) -> proc.Result:
        seen.append(args)
        out = args[args.index("--paths") + 1]
        with open(os.path.join(out, "video.mp4"), "wb") as handle:
            handle.write(b"x")
        return proc.Result(0, b"", b"")

    monkeypatch.setattr(proc, "run", fake_run)
    path = asyncio.run(ytdlp.download_video(URL, str(tmp_path)))
    assert path.endswith("video.mp4")
    args = seen[0]
    assert args[args.index("--format") + 1] == (
        "bv*[height>=240][width>=240][height<=?480]"
        "/bv*[width>=240][height>=240][width<=?480]"
        "/bv*[height<=?480]/b[height<=?480]/bv*/b"
    )
    assert args[args.index("--format-sort") + 1] == "+size,+br"
    assert args[args.index("--max-filesize") + 1] == str(300 * 1024 * 1024)
    assert args[args.index("--break-match-filters") + 1] == "!is_live"
    assert args[args.index("--match-filters") + 1] == f"duration <=? {config.MAX_AUDIO_SEC}"
    for flag in ("--ignore-config", "--no-plugin-dirs", "--no-remote-components"):
        assert flag in args
    assert "--skip-download" not in args
    assert args[-2:] == ["--", URL]


@pytest.mark.parametrize(
    ("duration", "expected"),
    [
        (100.0, [20.0, 40.0, 60.0, 80.0]),
        (4.0, [0.8, 1.6, 2.4, 3.2]),
        (3.5, [0.875, 1.75, 2.625]),
        (2.0, [2 / 3, 4 / 3]),
        (0.5, [0.25]),
    ],
)
def test_evenly_spaced_has_fewer_frames_under_four_seconds(
    duration: float, expected: list[float]
) -> None:
    assert media.evenly_spaced(duration) == pytest.approx(expected)


def test_frame_times_fall_back_to_file_positions(monkeypatch: pytest.MonkeyPatch) -> None:
    packets = [i * 0.5 for i in range(201)]  # 0..100 s, duration unknown to the container

    async def fake_packets(source: str, tmp_dir: str) -> list[float]:
        return packets

    monkeypatch.setattr(media, "packet_times", fake_packets)
    times, span = asyncio.run(media.video_frame_times("v.mp4", None, "work"))
    assert times == [10.0, 35.0, 60.0, 85.0] and span == 100.0

    packets[:] = [5.0, 5.5, 6.0, 6.5, 7.0]
    times, span = asyncio.run(media.video_frame_times("v.mp4", None, "work"))
    assert span == 2.0 and times == pytest.approx([2 / 3, 4 / 3])

    packets[:] = []
    assert asyncio.run(media.video_frame_times("v.mp4", None, "work")) == ([0.0], None)


def test_frames_rejects_over_three_hours_without_container_duration(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def long_packets(source: str, tmp_dir: str) -> list[float]:
        return [0.0, float(config.MAX_AUDIO_SEC + 10)]

    monkeypatch.setattr(ytdlp, "download_video", _fake_download([]))
    monkeypatch.setattr(media, "probe", _fake_probe(None))
    monkeypatch.setattr(media, "packet_times", long_packets)
    response = client.post("/v1/frames", json={"url": URL}, headers=AUTH)
    assert response.status_code == 413


def test_frames_have_their_own_budget(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    async def slow(url: str, tmp_dir: str) -> str:
        await asyncio.sleep(5)
        raise AssertionError("budget not enforced")

    monkeypatch.setattr(config, "FRAMES_TIMEOUT_SEC", 0.05)
    monkeypatch.setattr(ytdlp, "download_video", slow)
    response = client.post("/v1/frames", json={"url": URL}, headers=AUTH)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "TIMEOUT"


def test_frames_budget_is_ten_minutes() -> None:
    assert config.FRAMES_TIMEOUT_SEC == 600


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ({"url": URL}, "mp3"),
        ({"url": URL, "format": None}, "mp3"),
        ({"url": URL, "format": "mp3"}, "mp3"),
        ({"url": URL, "format": "wav"}, "wav"),
    ],
)
def test_audio_format_is_passed_through(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, body: dict, expected: str
) -> None:
    seen: list[tuple[str, str]] = []

    async def fake_audio(url: str, fmt: str = "mp3") -> dict[str, Any]:
        seen.append((url, fmt))
        return {"durationSec": 1.0, "chunks": []}

    monkeypatch.setattr(app_module, "audio_url", fake_audio)
    response = client.post("/v1/audio", json=body, headers=AUTH)
    assert response.status_code == 200, response.text
    assert seen == [(URL, expected)]


@pytest.mark.parametrize("fmt", ["flac", "WAV", "", 1, ["wav"]])
def test_audio_rejects_unknown_formats(client: TestClient, fmt: object) -> None:
    response = client.post("/v1/audio", json={"url": URL, "format": fmt}, headers=AUTH)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "UNSUPPORTED"


@pytest.mark.parametrize("fmt", ["ogg", ""])
def test_upload_rejects_unknown_audio_format(client: TestClient, fmt: str) -> None:
    response = client.post(
        "/v1/file",
        files={"file": ("a.mp3", b"ID3fake", "audio/mpeg")},
        data={"filename": "a.mp3", "contentType": "audio/mpeg", "format": fmt},
        headers=AUTH,
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "UNSUPPORTED"


def test_wav_request_for_long_or_unknown_audio_returns_mp3(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio

    assert config.MAX_WAV_SEC == 3600 and config.WAV_CHUNK_SEC == 480
    calls: list[str] = []

    async def mp3(source: str, tmp_dir: str) -> dict[str, object]:
        calls.append("mp3")
        return {
            "durationSec": 1.0,
            "chunks": [{"startSec": 0, "mime": "audio/mpeg", "dataBase64": ""}],
        }

    async def wav(source: str, tmp_dir: str) -> dict[str, object]:
        raise AssertionError("WAV must not be produced")

    monkeypatch.setattr(media, "_mp3_chunks", mp3)
    monkeypatch.setattr(media, "_wav_chunks", wav)
    for duration in (None, 3600.5):

        async def probe(path: str, tmp_dir: str, d: float | None = duration) -> media.Probe:
            return media.Probe(d, True, False, None, None)

        monkeypatch.setattr(media, "probe", probe)
        result = asyncio.run(media.audio_chunks("a.m4a", "work", "wav"))
        assert result["chunks"][0]["mime"] == "audio/mpeg"
    assert calls == ["mp3", "mp3"]


def test_frame_selector_never_falls_back_to_the_largest_stream(tmp_path) -> None:
    fmt = ytdlp.video_args(str(tmp_path))[1]
    assert fmt.endswith("/bv*/b")
    assert "[width>=240]" in fmt and "[width<=?480]" in fmt


def test_extract_awaits_the_cancelled_comments_task(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    import asyncio

    state = {"cancelled": False, "finished": False}

    async def slow_comments(*args: Any) -> list[dict[str, Any]]:
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            state["cancelled"] = True
            await asyncio.sleep(0)
            state["finished"] = True
            raise
        return []

    async def fake_metadata(url: str, tmp_dir: str) -> dict[str, Any]:
        return {"webpage_url": url}

    async def failing_result(*args: Any) -> dict[str, Any]:
        await asyncio.sleep(0.05)  # let the comments task start first
        raise RuntimeError("extract failed")

    monkeypatch.setattr(ytdlp, "metadata", fake_metadata)
    monkeypatch.setattr(ytdlp, "fetch_comments", slow_comments)
    monkeypatch.setattr(ytdlp, "_extract_result", failing_result)
    with pytest.raises(RuntimeError):
        asyncio.run(ytdlp.extract("youtube", "https://youtu.be/x", str(tmp_path)))
    assert state == {"cancelled": True, "finished": True}


def _video_format(fid: str, width: int, height: int, size: int) -> dict[str, Any]:
    return {
        "format_id": fid,
        "url": f"https://media.example/{fid}",
        "ext": "mp4",
        "protocol": "https",
        "vcodec": "avc1",
        "acodec": "none",
        "width": width,
        "height": height,
        "filesize": size,
        "tbr": size / 1000,
    }


@pytest.mark.parametrize(
    ("formats", "expected"),
    [
        # YouTube Short: a 144x256 stream must not win over 240x426.
        (
            [
                _video_format("144v", 144, 256, 1_000_000),
                _video_format("240v", 240, 426, 2_000_000),
                _video_format("1080v", 1080, 1920, 30_000_000),
            ],
            "240v",
        ),
        # Landscape: smallest stream whose short side is 240-480 px.
        (
            [
                _video_format("144p", 256, 144, 500_000),
                _video_format("360p", 640, 360, 3_000_000),
                _video_format("720p", 1280, 720, 9_000_000),
            ],
            "360p",
        ),
        # Vertical only, nothing in range: smallest available, never the largest.
        (
            [
                _video_format("576x1024", 576, 1024, 3_000_000),
                _video_format("1080x1920", 1080, 1920, 20_000_000),
            ],
            "576x1024",
        ),
    ],
)
def test_frame_selector_picks_the_expected_stream(
    tmp_path, formats: list[dict[str, Any]], expected: str
) -> None:
    import json
    import shutil
    import subprocess
    import sys

    info = {
        "id": "fixture",
        "title": "fixture",
        "extractor": "generic",
        "extractor_key": "Generic",
        "webpage_url": "https://media.example/watch",
        "formats": formats,
    }
    path = tmp_path / "info.json"
    path.write_text(json.dumps(info))
    args = ytdlp.video_args(str(tmp_path))
    fmt = args[args.index("--format") + 1]
    sort = args[args.index("--format-sort") + 1]
    exe = shutil.which("yt-dlp") or sys.executable
    prefix = [exe] if exe != sys.executable else [sys.executable, "-m", "yt_dlp"]
    result = subprocess.run(  # noqa: S603 - fixed local invocation in a test
        [
            *prefix,
            "--ignore-config",
            "--load-info-json",
            str(path),
            "--simulate",
            "--print",
            "format_id",
            "-f",
            fmt,
            "-S",
            sort,
        ],
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )
    assert result.stdout.strip() == expected


def _format(fid: str, vcodec: str, acodec: str, size: int, ext: str = "mp4") -> dict[str, Any]:
    return {
        "format_id": fid,
        "url": f"https://media.example/{fid}",
        "ext": ext,
        "protocol": "https",
        "vcodec": vcodec,
        "acodec": acodec,
        "filesize": size,
        "tbr": size / 1000,
    }


@pytest.mark.parametrize(
    ("formats", "expected"),
    [
        # TikTok: the "audio" format is the background music track, not the video's audio.
        (
            [
                _format("audio", "none", "aac", 2_000_000, "m4a"),
                _format("h264_540p-0", "h264", "aac", 4_000_000),
                _format("bytevc1_1080p-0", "h265", "aac", 12_000_000),
            ],
            "h264_540p-0",
        ),
        # YouTube-like: smallest audio-only stream still wins.
        (
            [
                _format("139", "none", "mp4a", 800_000, "m4a"),
                _format("251", "none", "opus", 1_500_000, "webm"),
                _format("18", "avc1", "mp4a", 9_000_000),
            ],
            "139",
        ),
    ],
)
def test_audio_selector_picks_the_expected_stream(
    tmp_path, formats: list[dict[str, Any]], expected: str
) -> None:
    import json
    import shutil
    import subprocess
    import sys

    info = {
        "id": "fixture",
        "title": "fixture",
        "extractor": "generic",
        "extractor_key": "Generic",
        "webpage_url": "https://media.example/watch",
        "formats": formats,
    }
    path = tmp_path / "info.json"
    path.write_text(json.dumps(info))
    exe = shutil.which("yt-dlp") or sys.executable
    prefix = [exe] if exe != sys.executable else [sys.executable, "-m", "yt_dlp"]
    result = subprocess.run(  # noqa: S603 - fixed local invocation in a test
        [
            *prefix,
            "--ignore-config",
            "--load-info-json",
            str(path),
            "--simulate",
            "--print",
            "format_id",
            "-f",
            ytdlp.AUDIO_FORMAT,
            "-S",
            ytdlp.AUDIO_SORT,
        ],
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )
    assert result.stdout.strip() == expected
