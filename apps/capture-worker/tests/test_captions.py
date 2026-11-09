import json

from capture_worker import captions

ROLLING_VTT = """WEBVTT
Kind: captions
Language: en

00:00:00.160 --> 00:00:02.869 align:start position:0%
 
hello<00:00:00.480><c> everyone</c><00:00:00.880><c> and</c>

00:00:02.869 --> 00:00:02.879 align:start position:0%
hello everyone and
 


00:00:02.879 --> 00:00:05.430 align:start position:0%
hello everyone and
welcome<00:00:03.200><c> to</c><00:00:03.520><c> the</c><00:00:03.840><c> talk</c>

00:00:05.430 --> 00:00:05.440 align:start position:0%
welcome to the talk
 


00:00:05.440 --> 00:00:08.000 align:start position:0%
welcome to the talk
today we cover &amp; explain
"""


def test_vtt_rolling_auto_captions_are_deduplicated() -> None:
    segments = captions.parse_vtt(ROLLING_VTT)
    assert [s.text for s in segments] == [
        "hello everyone and",
        "welcome to the talk",
        "today we cover & explain",
    ]
    assert segments[0].start == 0.16
    assert segments[1].start == 2.879
    assert segments[2].end == 8.0


def test_vtt_growing_line_is_replaced_not_repeated() -> None:
    vtt = """WEBVTT

00:00:01.000 --> 00:00:02.000
the quick

00:00:02.000 --> 00:00:03.000
the quick brown fox
"""
    segments = captions.parse_vtt(vtt)
    assert [s.text for s in segments] == ["the quick brown fox"]
    assert (segments[0].start, segments[0].end) == (1.0, 3.0)


def test_manual_vtt_with_hours_and_identifiers() -> None:
    vtt = """WEBVTT

1
01:02:03.500 --> 01:02:05.000
<v Speaker>First line</v>

2
01:02:05,000 --> 01:02:07,250
Second line
"""
    segments = captions.parse_vtt(vtt)
    assert [s.text for s in segments] == ["First line", "Second line"]
    assert segments[0].start == 3723.5
    assert segments[1].end == 3727.25


def test_json3_parsing_skips_newline_events() -> None:
    data = {
        "events": [
            {"tStartMs": 0, "dDurationMs": 1500, "segs": [{"utf8": "Olá"}, {"utf8": " mundo"}]},
            {"tStartMs": 1500, "dDurationMs": 10, "aAppend": 1, "segs": [{"utf8": "\n"}]},
            {"tStartMs": 1600, "dDurationMs": 2000},
            {"tStartMs": 2000, "dDurationMs": 1000, "segs": [{"utf8": "segunda frase"}]},
        ]
    }
    segments = captions.parse_json3(json.dumps(data))
    assert [s.to_dict() for s in segments] == [
        {"startSec": 0.0, "endSec": 1.5, "text": "Olá mundo"},
        {"startSec": 2.0, "endSec": 3.0, "text": "segunda frase"},
    ]
    assert captions.join_text(segments) == "Olá mundo\nsegunda frase"


def _fmt(ext: str, lang: str) -> dict[str, str]:
    return {"ext": ext, "url": f"https://subs.test/{lang}.{ext}"}


def test_select_prefers_manual_in_original_language() -> None:
    info = {
        "language": "pt-BR",
        "subtitles": {
            "en": [_fmt("vtt", "en")],
            "pt-BR": [_fmt("vtt", "pt-BR"), _fmt("json3", "pt-BR")],
        },
        "automatic_captions": {"pt-orig": [_fmt("json3", "pt-orig")]},
    }
    track = captions.select_track(info)
    assert track is not None
    assert (track.lang, track.automatic, track.ext) == ("pt-BR", False, "json3")


def test_select_falls_back_to_pt_then_en_manual() -> None:
    info = {"language": "fr", "subtitles": {"en": [_fmt("vtt", "en")], "pt": [_fmt("vtt", "pt")]}}
    assert captions.select_track(info).lang == "pt"
    info = {"language": "fr", "subtitles": {"en": [_fmt("vtt", "en")]}}
    assert captions.select_track(info).lang == "en"


def test_select_uses_original_auto_captions_not_translations() -> None:
    info = {
        "language": None,
        "subtitles": {"live_chat": [_fmt("json", "live_chat")]},
        "automatic_captions": {
            "pt": [_fmt("json3", "pt")],
            "es-orig": [_fmt("json3", "es-orig")],
            "es": [_fmt("json3", "es")],
        },
    }
    track = captions.select_track(info)
    assert track is not None
    assert (track.lang, track.automatic, track.url) == (
        "es",
        True,
        "https://subs.test/es-orig.json3",
    )


def test_select_returns_none_without_parseable_tracks() -> None:
    assert captions.select_track({"subtitles": {"en": [_fmt("srt", "en")]}}) is None
    assert captions.select_track({}) is None
