"""ffmpeg/ffprobe and Deno checks that need the real binaries (worker image)."""

from __future__ import annotations

import base64
import os
import subprocess

import pytest
from starlette.testclient import TestClient

from capture_worker import app as app_module
from capture_worker import media
from capture_worker.x_token import syndication_token

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not os.path.exists(media.FFMPEG), reason="needs the worker image"),
]

TOKEN = "m" * 40
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def client(tmp_path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("CAPTURE_TMP_DIR", str(tmp_path))
    return TestClient(app_module.build_app(TOKEN))


def _make_video(path: str, seconds: int) -> None:
    subprocess.run(
        [
            media.FFMPEG,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"testsrc=size=320x240:rate=10:duration={seconds}",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:duration={seconds}",
            "-c:v",
            "mpeg4",
            "-c:a",
            "aac",
            "-shortest",
            path,
        ],
        check=True,
    )


def test_upload_video_returns_audio_and_keyframes(client: TestClient, tmp_path) -> None:
    source = str(tmp_path / "clip.mp4")
    _make_video(source, 6)
    with open(source, "rb") as handle:
        response = client.post(
            "/v1/file",
            files={"file": ("clip.mp4", handle, "video/mp4")},
            data={"filename": "clip.mp4", "contentType": "video/mp4"},
            headers=AUTH,
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["hasAudio"] is True
    assert 5.5 < body["durationSec"] < 6.5
    assert len(body["images"]) == 4
    assert all(img["mime"] == "image/jpeg" and img["width"] == 320 for img in body["images"])
    assert body["hasVideo"] is True
    assert [img["kind"] for img in body["images"]] == ["frame"] * 4
    assert [img["timeSec"] for img in body["images"]] == pytest.approx(
        [1.2, 2.4, 3.6, 4.8], abs=0.1
    )
    audio = body["audio"]
    assert len(audio["chunks"]) == 1
    chunk = audio["chunks"][0]
    assert chunk["startSec"] == 0 and chunk["mime"] == "audio/mpeg"
    mp3 = tmp_path / "out.mp3"
    mp3.write_bytes(base64.b64decode(chunk["dataBase64"]))
    probe = subprocess.run(
        [
            media.FFPROBE,
            "-v",
            "error",
            "-show_entries",
            "stream=sample_rate,channels,codec_name",
            "-of",
            "default=nw=1",
            str(mp3),
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    assert "codec_name=mp3" in probe and "sample_rate=16000" in probe and "channels=1" in probe


def test_frames_endpoint_extracts_keyframes_with_real_ffmpeg(
    client: TestClient, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import shutil

    from capture_worker import ytdlp

    sample = str(tmp_path / "sample.mp4")
    _make_video(sample, 10)
    copies: list[str] = []

    async def fake_download(url: str, tmp_dir: str) -> str:
        target = os.path.join(tmp_dir, "video.mp4")
        shutil.copyfile(sample, target)
        copies.append(target)
        return target

    monkeypatch.setattr(ytdlp, "download_video", fake_download)
    response = client.post(
        "/v1/frames", json={"url": "https://www.youtube.com/watch?v=abc123"}, headers=AUTH
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert 9.5 < body["durationSec"] < 10.5
    assert len(body["images"]) == 4
    times = [img["timeSec"] for img in body["images"]]
    assert times == pytest.approx([2.0, 4.0, 6.0, 8.0], abs=0.15)
    for img in body["images"]:
        assert img["kind"] == "frame" and img["mime"] == "image/jpeg"
        data = base64.b64decode(img["dataBase64"])
        assert data[:3] == b"\xff\xd8\xff" and len(data) <= 1.5 * 1024 * 1024
        assert img["width"] == 320 and img["height"] == 240
    assert not os.path.exists(copies[0])


def test_audio_is_split_into_twenty_minute_chunks(tmp_path) -> None:
    import asyncio

    source = str(tmp_path / "long.m4a")
    subprocess.run(
        [
            media.FFMPEG,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=16000:cl=mono",
            "-t",
            "2500",
            "-c:a",
            "aac",
            "-b:a",
            "16k",
            source,
        ],
        check=True,
    )
    work = tmp_path / "work"
    work.mkdir()
    result = asyncio.run(media.audio_chunks(source, str(work)))
    starts = [c["startSec"] for c in result["chunks"]]
    assert len(starts) == 3
    assert starts[0] == 0 and 1195 < starts[1] < 1205 and 2395 < starts[2] < 2405
    assert 2495 < result["durationSec"] < 2505
    assert os.listdir(work) == []


def _make_silence(path: str, seconds: int) -> None:
    subprocess.run(
        [
            media.FFMPEG,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=16000:cl=mono",
            "-t",
            str(seconds),
            "-c:a",
            "aac",
            "-b:a",
            "16k",
            path,
        ],
        check=True,
    )


def _stream_info(path: str) -> str:
    return subprocess.run(
        [
            media.FFPROBE,
            "-v",
            "error",
            "-show_entries",
            "stream=sample_rate,channels,codec_name:format=format_name",
            "-of",
            "default=nw=1",
            path,
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def test_upload_video_returns_wav_when_asked(client: TestClient, tmp_path) -> None:
    source = str(tmp_path / "clip.mp4")
    _make_video(source, 6)
    with open(source, "rb") as handle:
        response = client.post(
            "/v1/file",
            files={"file": ("clip.mp4", handle, "video/mp4")},
            data={"filename": "clip.mp4", "contentType": "video/mp4", "format": "wav"},
            headers=AUTH,
        )
    assert response.status_code == 200, response.text
    audio = response.json()["audio"]
    assert len(audio["chunks"]) == 1 and audio["chunks"][0]["mime"] == "audio/wav"
    wav = tmp_path / "out.wav"
    wav.write_bytes(base64.b64decode(audio["chunks"][0]["dataBase64"]))
    info = _stream_info(str(wav))
    assert "codec_name=pcm_s16le" in info and "sample_rate=16000" in info
    assert "channels=1" in info and "format_name=wav" in info


def test_wav_is_split_into_eight_minute_chunks(tmp_path) -> None:
    import asyncio

    source = str(tmp_path / "long.m4a")
    _make_silence(source, 2500)
    work = tmp_path / "work"
    work.mkdir()
    result = asyncio.run(media.audio_chunks(source, str(work), "wav"))
    starts = [c["startSec"] for c in result["chunks"]]
    assert len(starts) == 6
    for index, start in enumerate(starts):
        assert abs(start - index * 480) < 2
    assert all(c["mime"] == "audio/wav" for c in result["chunks"])
    first = base64.b64decode(result["chunks"][0]["dataBase64"])
    # 480 s of 16 kHz mono s16le, plus the RIFF header.
    assert abs(len(first) - 480 * 16000 * 2) < 16000 * 2
    assert 2495 < result["durationSec"] < 2505
    assert os.listdir(work) == []


def test_wav_longer_than_one_hour_falls_back_to_mp3(tmp_path) -> None:
    import asyncio

    source = str(tmp_path / "very-long.m4a")
    _make_silence(source, 60 * 60 + 60)
    work = tmp_path / "work"
    work.mkdir()
    result = asyncio.run(media.audio_chunks(source, str(work), "wav"))
    assert {chunk["mime"] for chunk in result["chunks"]} == {"audio/mpeg"}
    assert len(result["chunks"]) == 4


def test_upload_image_is_reencoded(client: TestClient, tmp_path) -> None:
    png = str(tmp_path / "pic.png")
    subprocess.run(
        [
            media.FFMPEG,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=2400x1200",
            "-frames:v",
            "1",
            png,
        ],
        check=True,
    )
    with open(png, "rb") as handle:
        response = client.post(
            "/v1/file",
            files={"file": ("pic.png", handle, "image/png")},
            data={"filename": "pic.png", "contentType": "image/png"},
            headers=AUTH,
        )
    assert response.status_code == 200, response.text
    image = response.json()["images"][0]
    assert image["mime"] == "image/jpeg" and image["width"] == 1600 and image["height"] == 800
    assert len(base64.b64decode(image["dataBase64"])) <= 1.5 * 1024 * 1024


def test_upload_unknown_type_is_unsupported(client: TestClient) -> None:
    response = client.post(
        "/v1/file",
        files={"file": ("x.bin", b"\x00" * 10, "application/octet-stream")},
        data={"filename": "x.bin", "contentType": "application/octet-stream"},
        headers=AUTH,
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "UNSUPPORTED"


@pytest.mark.skipif(not os.path.exists("/usr/local/bin/deno"), reason="needs deno")
def test_syndication_token_matches_v8_in_image(tmp_path) -> None:
    ids = ["20", "1460323737035677698", "1983392859485417700", "1999999999999999999"]
    script = (
        "for (const id of Deno.args) console.log("
        "((Number(id)/1e15)*Math.PI).toString(36).replace(/(0+|\\.)/g, ''))"
    )
    out = subprocess.run(
        ["/usr/local/bin/deno", "eval", script, *ids],
        check=True,
        capture_output=True,
        text=True,
        env={"DENO_DIR": str(tmp_path), "HOME": str(tmp_path), "DENO_NO_UPDATE_CHECK": "1"},
    ).stdout.split()
    assert out == [syndication_token(i) for i in ids]
