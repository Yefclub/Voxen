import pytest
from curl_cffi.requests import exceptions as curl_exc

from capture_worker import errors
from capture_worker.errors import classify_exception, classify_http_status, classify_message


@pytest.mark.parametrize(
    ("message", "code", "retryable"),
    [
        (
            "ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies",
            "IP_BLOCKED",
            False,
        ),
        (
            "ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate",
            "LOGIN_REQUIRED",
            False,
        ),
        (
            "ERROR: [youtube] abc: Private video. Sign in if you've been granted access",
            "LOGIN_REQUIRED",
            False,
        ),
        (
            "ERROR: [Instagram] x: Requested content is not available, login required",
            "LOGIN_REQUIRED",
            False,
        ),
        (
            "ERROR: [TikTok] 1: Unable to download webpage: HTTP Error 403: Forbidden",
            "IP_BLOCKED",
            False,
        ),
        (
            "ERROR: [TikTok] 1: Your IP address is blocked from accessing this post",
            "IP_BLOCKED",
            False,
        ),
        (
            "ERROR: Unable to download webpage: HTTP Error 429: Too Many Requests",
            "RATE_LIMITED",
            True,
        ),
        (
            "ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader",
            "REMOVED",
            False,
        ),
        ("ERROR: Unable to download webpage: HTTP Error 404: Not Found", "REMOVED", False),
        ("ERROR: Unsupported URL: https://example.com/", "UNSUPPORTED", False),
        ("ERROR: Unable to download: Read timed out.", "TIMEOUT", True),
        (
            "ERROR: Tunnel connection failed: 407 Request rejected by proxy",
            "BLOCKED_ADDRESS",
            False,
        ),
        ("Egress proxying is denied to host '169.254.169.254:80'", "BLOCKED_ADDRESS", False),
        (
            "ERROR: unable to download video data: HTTP Error 503: Service Unavailable",
            "UNKNOWN",
            True,
        ),
        ("ERROR: [Errno 104] Connection reset by peer", "UNKNOWN", True),
        ("ERROR: File is larger than max-filesize (800 bytes > 700 bytes)", "TOO_LARGE", False),
        ("something completely different", "UNKNOWN", False),
    ],
)
def test_classify_message(message: str, code: str, retryable: bool) -> None:
    result = classify_message(message)
    assert (result.code, result.retryable) == (code, retryable)


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (401, "LOGIN_REQUIRED"),
        (403, "IP_BLOCKED"),
        (404, "REMOVED"),
        (410, "REMOVED"),
        (407, "BLOCKED_ADDRESS"),
        (429, "RATE_LIMITED"),
        (504, "TIMEOUT"),
        (500, "UNKNOWN"),
    ],
)
def test_classify_http_status(status: int, code: str) -> None:
    result = classify_http_status(status)
    assert result is not None and result.code == code


def test_success_status_is_not_an_error() -> None:
    assert classify_http_status(200) is None
    assert classify_http_status(302) is None


def test_only_transient_codes_are_retryable() -> None:
    assert classify_http_status(429).retryable
    assert classify_http_status(503).retryable
    assert not classify_http_status(404).retryable
    assert not classify_http_status(403).retryable


def test_exception_types_take_precedence() -> None:
    assert classify_exception(TimeoutError()).code == "TIMEOUT"
    assert classify_exception(curl_exc.Timeout("x")).code == "TIMEOUT"
    proxy_denied = curl_exc.ProxyError("CONNECT tunnel failed, response 407")
    assert classify_exception(proxy_denied).code == "BLOCKED_ADDRESS"
    proxy_down = classify_exception(curl_exc.ProxyError("Failed to connect to 127.0.0.1"))
    assert (proxy_down.code, proxy_down.retryable) == ("UNKNOWN", True)
    assert classify_exception(ConnectionResetError()).retryable


def test_messages_are_fixed_and_never_echo_input() -> None:
    secret_url = "https://example.com/v?token=SECRET123"
    result = classify_message(f"ERROR: HTTP Error 404 for {secret_url}")
    body = result.to_dict()
    assert "SECRET123" not in str(body)
    assert body == {
        "error": {"code": "REMOVED", "message": errors.MESSAGES["REMOVED"], "retryable": False}
    }


def test_http_status_mapping_for_responses() -> None:
    assert errors.error("REMOVED").http_status == 422
    assert errors.error("RATE_LIMITED").http_status == 503
    assert errors.error("TOO_LARGE").http_status == 413
    assert errors.error("INVALID_URL").http_status == 400


def test_redact_strips_urls() -> None:
    assert "token" not in errors.redact("failed https://x.test/a?token=abc here")


def test_ytdlp_error_lines_win_over_warnings() -> None:
    from capture_worker.errors import classify_ytdlp_stderr

    stderr = (
        "WARNING: [youtube] fragment 3: HTTP Error 403: Forbidden, retrying\n"
        "ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader\n"
    )
    assert classify_ytdlp_stderr(stderr).code == "REMOVED"


def test_copyright_takedown_is_removed_not_ip_blocked() -> None:
    from capture_worker.errors import classify_message

    assert (
        classify_message("ERROR: This video has been blocked it on copyright grounds").code
        == "REMOVED"
    )


def test_disk_full_is_too_large() -> None:
    from capture_worker.errors import classify_ytdlp_stderr

    assert (
        classify_ytdlp_stderr(
            "ERROR: unable to write data: [Errno 28] No space left on device"
        ).code
        == "TOO_LARGE"
    )
