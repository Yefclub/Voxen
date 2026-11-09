"""Typed capture errors and the classifier that maps failures to spec 220 codes.

Messages are fixed per code: raw upstream text (which can contain URLs with
tokens, file paths or stack traces) never reaches the API response.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass

LOGIN_REQUIRED = "LOGIN_REQUIRED"
IP_BLOCKED = "IP_BLOCKED"
RATE_LIMITED = "RATE_LIMITED"
REMOVED = "REMOVED"
UNSUPPORTED = "UNSUPPORTED"
NO_TEXT = "NO_TEXT"
TOO_LARGE = "TOO_LARGE"
TIMEOUT = "TIMEOUT"
BLOCKED_ADDRESS = "BLOCKED_ADDRESS"
INVALID_URL = "INVALID_URL"
UNKNOWN = "UNKNOWN"

MESSAGES: dict[str, str] = {
    LOGIN_REQUIRED: "The source requires sign-in, is private or is age-restricted.",
    IP_BLOCKED: "The platform blocked requests from this server.",
    RATE_LIMITED: "The platform is rate-limiting requests from this server.",
    REMOVED: "The content was removed or is unavailable.",
    UNSUPPORTED: "This source or file type is not supported.",
    NO_TEXT: "No usable text was found in the source.",
    TOO_LARGE: "The content exceeds the size or duration limit.",
    TIMEOUT: "The operation took too long.",
    BLOCKED_ADDRESS: "The destination address is not allowed.",
    INVALID_URL: "The URL is invalid.",
    UNKNOWN: "The capture failed for an unknown reason.",
}


@dataclass(eq=False)
class CaptureError(Exception):
    code: str
    retryable: bool = False

    @property
    def message(self) -> str:
        return MESSAGES.get(self.code, MESSAGES[UNKNOWN])

    def __str__(self) -> str:
        return self.code

    def to_dict(self) -> dict[str, object]:
        return {"error": {"code": self.code, "message": self.message, "retryable": self.retryable}}

    @property
    def http_status(self) -> int:
        if self.code == INVALID_URL:
            return 400
        if self.code == TOO_LARGE:
            return 413
        return 503 if self.retryable else 422


def error(code: str, *, retryable: bool | None = None) -> CaptureError:
    if retryable is None:
        retryable = code in (RATE_LIMITED, TIMEOUT)
    return CaptureError(code, retryable)


def classify_http_status(status: int) -> CaptureError | None:
    """Map an origin HTTP status to a capture error; None means success."""
    if status < 400:
        return None
    if status == 407:
        return error(BLOCKED_ADDRESS)
    if status == 401:
        return error(LOGIN_REQUIRED)
    if status == 403:
        return error(IP_BLOCKED)
    if status in (404, 410, 451):
        return error(REMOVED)
    if status == 429:
        return error(RATE_LIMITED)
    if status == 413:
        return error(TOO_LARGE)
    if status in (408, 504):
        return error(TIMEOUT)
    if status >= 500:
        return error(UNKNOWN, retryable=True)
    return error(UNKNOWN)


# Ordered: the first matching rule wins. "Sign in to confirm you're not a bot"
# must be checked before the generic sign-in rule, and proxy denials before
# generic HTTP 4xx rules.
_MESSAGE_RULES: tuple[tuple[re.Pattern[str], str, bool], ...] = tuple(
    (re.compile(pattern, re.IGNORECASE), code, retryable)
    for pattern, code, retryable in (
        (r"egress proxying is denied|request rejected by proxy|\b407\b", BLOCKED_ADDRESS, False),
        (r"not a bot|confirm you.?re not a robot", IP_BLOCKED, False),
        (r"\b429\b|too many requests|rate.?limit", RATE_LIMITED, True),
        (
            r"larger than max-filesize|file is larger than|too large|no space left on device",
            TOO_LARGE,
            False,
        ),
        (r"copyright", REMOVED, False),
        (
            r"confirm your age|age.?restricted|inappropriate for some users|"
            r"private (video|account|post)|this (video|account|post) is private|"
            r"login required|log ?in to|sign ?in|requires authentication|"
            r"members.only|use --cookies|account.{0,40}cookies|\b401\b",
            LOGIN_REQUIRED,
            False,
        ),
        (
            r"\b403\b|forbidden|blocked|ip address|geo.?restrict|not available in your country",
            IP_BLOCKED,
            False,
        ),
        (r"timed? ?out|timeout", TIMEOUT, True),
        (
            r"connection (reset|refused|aborted)|temporary failure|name resolution|"
            r"network is unreachable|remote end closed|incompleteread|eof occurred|"
            r"\b5\d\d\b|service unavailable|bad gateway",
            UNKNOWN,
            True,
        ),
        (
            r"\b404\b|\b410\b|not found|video unavailable|unavailable|has been removed|"
            r"was removed|been deleted|deleted|no longer available|does not exist|"
            r"terminated|copyright",
            REMOVED,
            False,
        ),
        (
            r"unsupported url|no suitable extractor|requested format is not available|"
            r"no video formats found|is not a valid url|live event|is_live|"
            r"does not pass filter|did not match filter",
            UNSUPPORTED,
            False,
        ),
    )
)


def classify_message(text: str) -> CaptureError:
    """Fallback classification from an error message (yt-dlp stderr, etc.)."""
    for pattern, code, retryable in _MESSAGE_RULES:
        if pattern.search(text):
            return CaptureError(code, retryable)
    return error(UNKNOWN)


def classify_ytdlp_stderr(stderr: str) -> CaptureError:
    """yt-dlp prints WARNING lines (e.g. a 403 on one fragment retry) before
    the final ERROR line; classify the ERROR lines first."""
    errors_only = "\n".join(line for line in stderr.splitlines() if line.startswith("ERROR:"))
    if errors_only:
        classified = classify_message(errors_only)
        if classified.code != UNKNOWN:
            return classified
    return classify_message(stderr)


def classify_exception(exc: BaseException) -> CaptureError:
    """Classify by exception type first, then fall back to the message."""
    if isinstance(exc, CaptureError):
        return exc
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return error(TIMEOUT)
    try:
        from curl_cffi.requests import exceptions as curl_exc
    except ImportError:  # pragma: no cover - curl_cffi is a hard dependency
        curl_exc = None
    if curl_exc is not None:
        if isinstance(exc, curl_exc.Timeout):
            return error(TIMEOUT)
        if isinstance(exc, curl_exc.ProxyError):
            classified = classify_message(str(exc))
            if classified.code == BLOCKED_ADDRESS:
                return classified
            return error(UNKNOWN, retryable=True)
        if isinstance(exc, curl_exc.TooManyRedirects):
            return error(UNSUPPORTED)
        if isinstance(exc, curl_exc.HTTPError):
            response = getattr(exc, "response", None)
            status = getattr(response, "status_code", None)
            if isinstance(status, int):
                return classify_http_status(status) or error(UNKNOWN)
        if isinstance(exc, curl_exc.RequestException):
            classified = classify_message(str(exc))
            if classified.code == UNKNOWN:
                return error(UNKNOWN, retryable=True)
            return classified
    if isinstance(exc, (ConnectionError, OSError)):
        return error(UNKNOWN, retryable=True)
    return classify_message(str(exc))


_URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)


def redact(text: str, limit: int = 600) -> str:
    """Strip URLs (which may carry tokens) before logging upstream output."""
    return _URL_RE.sub("<url>", text)[-limit:]
