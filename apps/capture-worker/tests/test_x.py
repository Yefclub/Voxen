import pytest

from capture_worker import x
from capture_worker.errors import CaptureError
from capture_worker.x_token import double_to_radix, syndication_token

# Expected values computed with V8 (Deno 2.9.8):
#   ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "")
V8_TOKENS = {
    "20": "6dq1a2xwd93",
    "1": "bhi2ay3f28n",
    "5": "1lfibiqh3ba",
    "1234567890": "6iio5bzbwyw",
    "1460323737035677698": "3jfqq1vhqna",
    "1983392859485417700": "4t3g48m4ln",
    "1854893462981324928": "4hvbiatr52k",
    "1700000000000000000": "44cpgxmyurn",
    "1111111111111111111": "2oynpf5u2p5",
}


@pytest.mark.parametrize(("tweet_id", "token"), sorted(V8_TOKENS.items()))
def test_syndication_token_matches_v8(tweet_id: str, token: str) -> None:
    assert syndication_token(tweet_id) == token


@pytest.mark.parametrize(
    ("value", "radix", "expected"),
    [
        (255.5, 16, "ff.8"),
        (0.5, 36, "0.i"),
        (123.456, 36, "3f.gez4w97ry"),
        (35.99999999999, 36, "z.zzzzzzz7t"),
        (1e21, 36, "5v1j4f4ds7c000"),
        (-2.5, 2, "-10.1"),
        (0.0, 36, "0"),
    ],
)
def test_double_to_radix_matches_v8(value: float, radix: int, expected: str) -> None:
    assert double_to_radix(value, radix) == expected


SYNDICATION = {
    "__typename": "Tweet",
    "id_str": "1460323737035677698",
    "lang": "pt",
    "created_at": "2021-11-15T18:51:44.000Z",
    "text": "Texto do post https://t.co/abc",
    "user": {"name": "Pessoa", "screen_name": "pessoa"},
    "mediaDetails": [
        {"type": "photo", "media_url_https": "https://pbs.twimg.com/media/a.jpg"},
        {"type": "video", "media_url_https": "https://pbs.twimg.com/thumb/v.jpg"},
    ],
    "quoted_tweet": {"text": "post citado", "user": {"screen_name": "outra"}},
}


def test_normalize_syndication() -> None:
    post = x.normalize_syndication(SYNDICATION)
    assert post["text"] == "Texto do post https://t.co/abc"
    assert post["screen_name"] == "pessoa"
    assert post["published"] == "2021-11-15T18:51:44Z"
    assert post["photos"] == ["https://pbs.twimg.com/media/a.jpg"]
    assert post["video_poster"] == "https://pbs.twimg.com/thumb/v.jpg"
    assert post["has_video"] is True
    assert post["quoted"] == {"text": "post citado", "screen_name": "outra"}
    assert post["truncated"] is False


def test_note_tweets_are_marked_truncated() -> None:
    post = x.normalize_syndication({**SYNDICATION, "note_tweet": {"id": "x"}})
    assert post["truncated"] is True


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        ({"__typename": "TweetTombstone"}, "REMOVED"),
        ({"__typename": "TweetUnavailable", "reason": "Protected"}, "LOGIN_REQUIRED"),
        ({"__typename": "Tweet"}, "REMOVED"),
    ],
)
def test_unavailable_syndication_payloads(payload: dict, code: str) -> None:
    with pytest.raises(CaptureError) as caught:
        x.normalize_syndication(payload)
    assert caught.value.code == code


def test_normalize_fxtwitter_with_article_and_gif() -> None:
    tweet = {
        "id": "1",
        "text": "intro",
        "created_timestamp": 1700000000,
        "lang": "en",
        "author": {"name": "A", "screen_name": "a"},
        "media": {"videos": [{"type": "gif", "thumbnail_url": "https://t/g.jpg"}]},
        "article": {"title": "Long", "content": {"blocks": [{"text": "p1"}, {"text": "p2"}]}},
        "quote": {"text": "q", "author": {"screen_name": "b"}},
    }
    post = x.normalize_fxtwitter(tweet)
    assert post["text"] == "intro\n\n# Long\n\np1\n\np2"
    assert post["has_video"] is False
    assert post["published"] == "2023-11-14T22:13:20Z"
    assert post["quoted"] == {"text": "q", "screen_name": "b"}


async def _no_images(sources, tmp_dir):
    return []


def test_result_shape(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    import asyncio

    monkeypatch.setattr(x.images, "download", _no_images)
    post = x.normalize_syndication(SYNDICATION)
    result = asyncio.run(x._to_result(post, "1460323737035677698", str(tmp_path)))
    assert result["platform"] == "x"
    assert result["canonicalUrl"] == "https://x.com/pessoa/status/1460323737035677698"
    assert result["platformId"] == "1460323737035677698"
    assert result["text"] == "Texto do post https://t.co/abc\n\n> @outra: post citado"
    assert result["textKind"] == "post"
    assert result["hasAudio"] is True
    assert result["language"] == "pt"
    assert result["extractor"] == "x-syndication"
