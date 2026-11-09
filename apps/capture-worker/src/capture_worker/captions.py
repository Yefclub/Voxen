"""Subtitle track selection and VTT/json3 parsing with rolling-caption dedupe."""

from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass
from typing import Any

PARSEABLE_FORMATS = ("json3", "vtt")


@dataclass
class Segment:
    start: float
    end: float
    text: str

    def to_dict(self) -> dict[str, object]:
        return {"startSec": round(self.start, 3), "endSec": round(self.end, 3), "text": self.text}


@dataclass(frozen=True)
class Track:
    lang: str
    automatic: bool
    ext: str
    url: str
    headers: dict[str, str]


def _lang_base(lang: str) -> str:
    return re.split(r"[-_]", lang.lower(), maxsplit=1)[0]


def _find_lang(tracks: dict[str, Any], wanted: str | None) -> str | None:
    if not wanted:
        return None
    base = _lang_base(wanted)
    if wanted in tracks:
        return wanted
    candidates = [k for k in tracks if _lang_base(k) == base and not k.endswith("-orig")]
    candidates += [k for k in tracks if _lang_base(k) == base]
    return candidates[0] if candidates else None


def _pick_format(entries: list[dict[str, Any]]) -> dict[str, Any] | None:
    by_ext = {e.get("ext"): e for e in entries if isinstance(e, dict) and e.get("url")}
    for ext in PARSEABLE_FORMATS:
        if ext in by_ext:
            return by_ext[ext]
    return None


def select_track(info: dict[str, Any]) -> Track | None:
    """Manual subs in the original language, then pt, then en, then auto
    captions in the original language (YouTube marks those `<lang>-orig`)."""
    manual = info.get("subtitles") or {}
    auto = info.get("automatic_captions") or {}
    manual = {k: v for k, v in manual.items() if k != "live_chat" and isinstance(v, list)}
    auto = {k: v for k, v in auto.items() if isinstance(v, list)}
    original = info.get("language")
    orig_auto = next((k for k in auto if k.endswith("-orig")), None)
    if not original and orig_auto:
        original = orig_auto.removesuffix("-orig")

    attempts: list[tuple[dict[str, Any], str | None, bool]] = [
        (manual, original, False),
        (manual, "pt", False),
        (manual, "en", False),
    ]
    for tracks, wanted, automatic in attempts:
        lang = _find_lang(tracks, wanted)
        if lang:
            fmt = _pick_format(tracks[lang])
            if fmt:
                return _track(lang, automatic, fmt)
    # Auto captions: only the original-language ASR track; machine translations
    # of auto captions are not useful source text.
    auto_lang = orig_auto if orig_auto in auto else _find_lang(auto, original)
    if auto_lang:
        fmt = _pick_format(auto[auto_lang])
        if fmt:
            return _track(auto_lang.removesuffix("-orig"), True, fmt)
    # Non-YouTube extractors (TikTok, ...) may expose a single manual track.
    for lang, entries in manual.items():
        fmt = _pick_format(entries)
        if fmt:
            return _track(lang, False, fmt)
    return None


def _track(lang: str, automatic: bool, fmt: dict[str, Any]) -> Track:
    headers = fmt.get("http_headers") or {}
    return Track(
        lang=lang,
        automatic=automatic,
        ext=str(fmt.get("ext")),
        url=str(fmt["url"]),
        headers={str(k): str(v) for k, v in headers.items()},
    )


_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
_TIMING_RE = re.compile(
    r"^\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})"
)


def _clean(text: str) -> str:
    return _WS_RE.sub(" ", html.unescape(_TAG_RE.sub("", text))).strip()


def _ts(value: str) -> float:
    parts = value.replace(",", ".").split(":")
    seconds = float(parts[-1])
    minutes = int(parts[-2]) if len(parts) >= 2 else 0
    hours = int(parts[-3]) if len(parts) >= 3 else 0
    return hours * 3600 + minutes * 60 + seconds


def parse_vtt(content: str) -> list[Segment]:
    """Parse WebVTT; each cue line becomes a candidate segment."""
    raw: list[Segment] = []
    lines = content.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    i = 0
    while i < len(lines):
        match = _TIMING_RE.match(lines[i])
        if not match:
            i += 1
            continue
        start, end = _ts(match.group(1)), _ts(match.group(2))
        i += 1
        # A cue ends at an empty line; YouTube pads cues with whitespace-only lines.
        while i < len(lines) and lines[i] != "":
            text = _clean(lines[i])
            if text:
                raw.append(Segment(start, end, text))
            i += 1
    return dedupe(raw)


def parse_json3(content: str) -> list[Segment]:
    data = json.loads(content)
    raw: list[Segment] = []
    for event in data.get("events") or []:
        segs = event.get("segs")
        if not segs:
            continue
        text = _clean("".join(str(s.get("utf8", "")) for s in segs if isinstance(s, dict)))
        if not text:
            continue
        start = float(event.get("tStartMs", 0)) / 1000
        end = start + float(event.get("dDurationMs", 0)) / 1000
        raw.append(Segment(start, max(start, end), text))
    return dedupe(raw)


def dedupe(segments: list[Segment]) -> list[Segment]:
    """Collapse rolling auto-captions.

    YouTube auto VTT repeats the previous line at the top of each cue and grows
    the current line word by word. We drop exact repeats of recently emitted
    lines and replace a segment when the next one extends it.
    """
    out: list[Segment] = []
    recent: list[str] = []
    for seg in segments:
        if seg.text in recent:
            if out and out[-1].text == seg.text:
                out[-1].end = max(out[-1].end, seg.end)
            continue
        if out and seg.text.startswith(out[-1].text) and seg.start <= out[-1].end + 0.5:
            out[-1].text = seg.text
            out[-1].end = max(out[-1].end, seg.end)
            recent[-1] = seg.text
            continue
        out.append(Segment(seg.start, seg.end, seg.text))
        recent.append(seg.text)
        recent = recent[-3:]
    return out


def parse(content: str, ext: str) -> list[Segment]:
    if ext == "json3":
        return parse_json3(content)
    return parse_vtt(content)


def join_text(segments: list[Segment]) -> str:
    return "\n".join(seg.text for seg in segments)
