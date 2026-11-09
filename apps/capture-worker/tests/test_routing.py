import pytest

from capture_worker import routing
from capture_worker.errors import CaptureError


@pytest.mark.parametrize(
    ("url", "platform"),
    [
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"),
        ("https://youtu.be/dQw4w9WgXcQ", "youtube"),
        ("https://m.youtube.com/shorts/abc", "youtube"),
        ("https://www.tiktok.com/@user/video/7300000000000000000", "tiktok"),
        ("https://vm.tiktok.com/ZMabc/", "tiktok"),
        ("https://www.instagram.com/reel/Cabc123/", "instagram"),
        ("https://x.com/user/status/1460323737035677698", "x"),
        ("https://twitter.com/user/status/1460323737035677698?s=20", "x"),
        ("https://mobile.twitter.com/i/web/status/1460323737035677698", "x"),
        ("https://vimeo.com/76979871", "other"),
        ("https://example.com/blog/post", "web"),
        ("http://127.0.0.1:1/", "web"),
        ("http://169.254.169.254/latest/meta-data/", "web"),
    ],
)
def test_route_by_host(url: str, platform: str) -> None:
    assert routing.route(url).platform == platform


def test_x_status_id_is_extracted() -> None:
    target = routing.route("https://x.com/user/status/1460323737035677698/photo/1")
    assert target.x_status_id == "1460323737035677698"
    assert target.use_ytdlp is False


def test_x_without_status_is_unsupported() -> None:
    with pytest.raises(CaptureError) as caught:
        routing.route("https://x.com/user")
    assert caught.value.code == "UNSUPPORTED"


def test_lookalike_hosts_are_not_trusted() -> None:
    assert routing.route("https://notyoutube.com/watch?v=x").platform != "youtube"
    assert routing.route("https://youtube.com.evil.test/watch?v=x").platform == "web"


@pytest.mark.parametrize(
    "url",
    [
        None,
        123,
        "",
        "ftp://example.com/file",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "https://",
        "https://user:pass@example.com/",
        "https://exa mple.com/",
        "https://example.com:99999/",
        "https://example.com/" + "a" * 2100,
    ],
)
def test_invalid_urls_are_rejected(url: object) -> None:
    with pytest.raises(CaptureError) as caught:
        routing.validate_url(url)
    assert caught.value.code == "INVALID_URL"
