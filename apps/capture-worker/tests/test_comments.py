import asyncio
import json
import logging
from typing import Any

import pytest

from capture_worker import comments, config, http, proc, ytdlp
from capture_worker.errors import error


def _raw(text: str, likes: int | None, ts: int | None, **extra: Any) -> dict[str, Any]:
    return {"author": "a", "text": text, "like_count": likes, "timestamp": ts, **extra}


def test_normalize_sorts_by_likes_then_recency_then_id_nulls_last() -> None:
    result = comments.normalize(
        [
            _raw("old popular", 10, 1_600_000_000),
            _raw("new popular", 10, 1_700_000_000),
            _raw("top", 99, 1_500_000_000),
            _raw("unknown likes", None, 1_800_000_000),
            _raw("no date", 10, None),
            _raw("zero likes", 0, 1_900_000_000),
            _raw("tie b", 5, 1_000, id="b"),
            _raw("tie a", 5, 1_000, id="a"),
            _raw("tie no id", 5, 1_000),
        ]
    )
    assert [c["text"] for c in result] == [
        "top",
        "new popular",
        "old popular",
        "no date",
        "tie a",
        "tie b",
        "tie no id",
        "zero likes",
        "unknown likes",
    ]
    assert result[0] == {
        "author": "a",
        "text": "top",
        "likes": 99,
        "publishedAt": "2017-07-14T02:40:00Z",
    }
    assert result[3]["publishedAt"] is None
    assert result[-1]["likes"] is None


def test_normalize_drops_replies_empty_and_deleted() -> None:
    result = comments.normalize(
        [
            _raw("top level", 1, 1, parent="root"),
            _raw("reply", 50, 1, parent="Ugx123"),
            _raw("   ", 50, 1),
            _raw("[deleted]", 50, 1),
            _raw("[Removed]", 50, 1),
            {"author": "a", "text": None},
            "not a dict",
        ]
    )
    assert [c["text"] for c in result] == ["top level"]
    assert comments.normalize(None) == []
    assert comments.normalize({"comments": []}) == []


def test_normalize_trims_text_and_caps_count() -> None:
    long = "x" * (config.MAX_COMMENT_CHARS + 500)
    raw = [_raw(long, i, i, author="  " + "n" * 500) for i in range(config.MAX_COMMENTS + 20)]
    result = comments.normalize(raw)
    assert len(result) == config.MAX_COMMENTS == 50
    assert all(len(c["text"]) == config.MAX_COMMENT_CHARS for c in result)
    assert all(len(c["author"]) == config.MAX_COMMENT_AUTHOR_CHARS for c in result)
    assert result[0]["likes"] == config.MAX_COMMENTS + 19


def test_normalize_rejects_bogus_counts() -> None:
    result = comments.normalize([_raw("t", True, "yesterday"), _raw("u", -3, 0)])
    assert [(c["text"], c["likes"]) for c in result] == [("u", 0), ("t", None)]
    assert result[0]["publishedAt"] == "1970-01-01T00:00:00Z"
    assert result[1]["publishedAt"] is None


TIKTOK_PAYLOAD = {
    "status_code": 0,
    "comments": [
        {
            "cid": "1",
            "text": "first",
            "digg_count": 5,
            "create_time": 1_700_000_000,
            "reply_id": "0",
            "status": 1,
            "user": {"unique_id": "fan1", "nickname": "Fan"},
        },
        {
            "text": "best",
            "digg_count": 40,
            "create_time": 1_600_000_000,
            "reply_id": "0",
            "status": 1,
            "user": {"nickname": "Nick"},
        },
        {"text": "a reply", "digg_count": 99, "reply_id": "7123", "status": 1, "user": {}},
        {"text": "hidden", "digg_count": 99, "reply_id": "0", "status": 7, "user": {}},
    ],
}


def test_from_tiktok() -> None:
    assert comments.from_tiktok(TIKTOK_PAYLOAD) == [
        {"author": "Nick", "text": "best", "likes": 40, "publishedAt": "2020-09-13T12:26:40Z"},
        {"author": "fan1", "text": "first", "likes": 5, "publishedAt": "2023-11-14T22:13:20Z"},
    ]
    assert comments.from_tiktok(None) == []
    assert comments.from_tiktok({"comments": None}) == []


def test_tiktok_fetch_url_and_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, dict[str, Any]]] = []

    async def fake_fetch(url: str, **kwargs: Any) -> http.Fetched:
        calls.append((url, kwargs))
        return http.Fetched(url, 200, "application/json", json.dumps(TIKTOK_PAYLOAD).encode())

    monkeypatch.setattr(http, "fetch", fake_fetch)
    result = asyncio.run(comments.tiktok("7123456789012345678"))
    assert [c["text"] for c in result] == ["best", "first"]
    url, kwargs = calls[0]
    assert url == (
        "https://www.tiktok.com/api/comment/list/"
        "?aweme_id=7123456789012345678&count=50&cursor=0&aid=1988"
    )
    assert kwargs["max_bytes"] == config.MAX_COMMENTS_JSON_BYTES

    # Ids that are not numeric never reach the network.
    assert asyncio.run(comments.tiktok("../evil?x=1")) == []
    assert len(calls) == 1

    async def blocked(url: str, **kwargs: Any) -> http.Fetched:
        raise error("IP_BLOCKED")

    monkeypatch.setattr(http, "fetch", blocked)
    assert asyncio.run(comments.tiktok("7123456789012345678")) == []

    async def garbage(url: str, **kwargs: Any) -> http.Fetched:
        return http.Fetched(url, 200, "text/html", b"<html>captcha</html>")

    monkeypatch.setattr(http, "fetch", garbage)
    assert asyncio.run(comments.tiktok("7123456789012345678")) == []


def test_youtube_comment_args_are_exact() -> None:
    assert ytdlp.comment_args("youtube") == [
        "--skip-download",
        "--dump-single-json",
        "--write-comments",
        "--extractor-args",
        "youtube:max_comments=50,all,0,0;comment_sort=top",
    ]
    assert ytdlp.comment_args("instagram") == [
        "--skip-download",
        "--dump-single-json",
        "--write-comments",
    ]
    for platform in ("tiktok", "x", "web", "other"):
        assert ytdlp.comment_args(platform) == []


def test_comment_call_overrides_no_write_comments(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    seen: list[tuple[list[str], float]] = []
    raw = [_raw(f"c{i}", i, i) for i in range(80)]

    async def fake_run(args: list[str], **kwargs: Any) -> proc.Result:
        seen.append((args, kwargs["timeout"]))
        return proc.Result(0, json.dumps({"id": "v", "comments": raw}).encode(), b"")

    monkeypatch.setattr(proc, "run", fake_run)
    result = asyncio.run(
        ytdlp.fetch_comments("youtube", "https://youtu.be/v", {"id": "v"}, str(tmp_path))
    )
    assert len(result) == 50 and result[0]["text"] == "c79"
    args, timeout = seen[0]
    assert timeout == config.COMMENTS_TIMEOUT_SEC == 60
    # The later --write-comments wins over --no-write-comments in base_args.
    assert args.index("--write-comments") > args.index("--no-write-comments")
    assert "--skip-download" in args
    assert args[-2:] == ["--", "https://youtu.be/v"]


def test_comment_failures_never_raise(
    monkeypatch: pytest.MonkeyPatch, tmp_path, caplog: pytest.LogCaptureFixture
) -> None:
    async def failing(args: list[str], **kwargs: Any) -> proc.Result:
        return proc.Result(1, b"", b"ERROR: HTTP Error 403 https://secret.test/?sig=abc")

    monkeypatch.setattr(proc, "run", failing)
    with caplog.at_level(logging.INFO):
        result = asyncio.run(
            ytdlp.fetch_comments("youtube", "https://youtu.be/v", {}, str(tmp_path))
        )
    assert result == []
    assert "secret.test" not in caplog.text
    assert all(r.levelno <= logging.INFO for r in caplog.records)

    async def bad_json(args: list[str], **kwargs: Any) -> proc.Result:
        return proc.Result(0, b"not json", b"")

    monkeypatch.setattr(proc, "run", bad_json)
    assert asyncio.run(ytdlp.fetch_comments("instagram", "https://x.test", {}, str(tmp_path))) == []

    async def timeout(args: list[str], **kwargs: Any) -> proc.Result:
        raise error("TIMEOUT")

    monkeypatch.setattr(proc, "run", timeout)
    assert (
        asyncio.run(ytdlp.fetch_comments("youtube", "https://youtu.be/v", {}, str(tmp_path))) == []
    )

    async def crash(args: list[str], **kwargs: Any) -> proc.Result:
        raise OSError("spawn failed")

    monkeypatch.setattr(proc, "run", crash)
    assert (
        asyncio.run(ytdlp.fetch_comments("youtube", "https://youtu.be/v", {}, str(tmp_path))) == []
    )


def test_comments_have_their_own_budget(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    async def slow(video_id: str) -> list[dict[str, Any]]:
        await asyncio.sleep(5)
        raise AssertionError("budget not enforced")

    monkeypatch.setattr(config, "COMMENTS_TIMEOUT_SEC", 0.05)
    monkeypatch.setattr(comments, "tiktok", slow)
    info = {"id": "7123456789012345678"}
    assert asyncio.run(ytdlp.fetch_comments("tiktok", "https://t.test", info, str(tmp_path))) == []


def test_comments_skipped_without_support_or_when_none(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    async def must_not_run(args: list[str], **kwargs: Any) -> proc.Result:
        raise AssertionError("yt-dlp must not run")

    monkeypatch.setattr(proc, "run", must_not_run)
    assert asyncio.run(ytdlp.fetch_comments("other", "https://v.test", {}, str(tmp_path))) == []
    info = {"comment_count": 0}
    assert asyncio.run(ytdlp.fetch_comments("youtube", "https://y.test", info, str(tmp_path))) == []


def test_tiktok_comments_use_the_post_id(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    seen: list[str] = []

    async def fake_tiktok(video_id: str) -> list[dict[str, Any]]:
        seen.append(video_id)
        return []

    monkeypatch.setattr(comments, "tiktok", fake_tiktok)
    info = {"id": 7123456789012345678}
    asyncio.run(ytdlp.fetch_comments("tiktok", "https://www.tiktok.com/@a/video/1", info, "/x"))
    assert seen == ["7123456789012345678"]


@pytest.mark.parametrize(
    ("info", "expected"),
    [
        ({"formats": [{"vcodec": "avc1", "acodec": "none"}]}, True),
        ({"formats": [{"vcodec": "none", "acodec": "opus"}]}, False),
        ({"formats": [{"vcodec": "none", "ext": "mhtml", "height": 90}]}, False),
        ({"formats": [{"vcodec": None, "acodec": None, "height": 720}]}, True),
        ({"formats": [{"vcodec": None, "acodec": "mp3"}]}, False),
        ({"vcodec": "h264"}, True),
        ({"vcodec": "none"}, False),
        ({"width": 640}, True),
        ({}, False),
    ],
)
def test_has_video(info: dict[str, Any], expected: bool) -> None:
    assert ytdlp.has_video(info) is expected
