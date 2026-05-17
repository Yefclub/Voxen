"""Testes do parser VTT/SRT + escolha de idioma."""

from __future__ import annotations

from src.ytdl import VideoProbe, parse_vtt_or_srt, pick_subtitle_lang

VTT_SAMPLE = """WEBVTT

00:00:00.000 --> 00:00:04.500
Olá pessoal, bem-vindos ao canal.

00:00:04.500 --> 00:00:09.200
Hoje vamos falar de Postgres.

00:00:09.200 --> 00:00:13.000
<c.colorE5E5E5>Especificamente sobre Full Text Search.</c>
"""

SRT_SAMPLE = """1
00:00:00,000 --> 00:00:04,500
Olá pessoal, bem-vindos ao canal.

2
00:00:04,500 --> 00:00:09,200
Hoje vamos falar de Postgres.

3
00:00:09,200 --> 00:00:13,000
Especificamente sobre Full Text Search.
"""


def test_parse_vtt() -> None:
    segments = parse_vtt_or_srt(VTT_SAMPLE)
    assert len(segments) == 3
    assert segments[0].start_sec == 0.0
    assert segments[0].text == "Olá pessoal, bem-vindos ao canal."
    assert segments[1].start_sec == 4.5
    # tag <c.colorXXX> tem que sumir
    assert "<c" not in segments[2].text
    assert segments[2].text == "Especificamente sobre Full Text Search."


def test_parse_srt() -> None:
    segments = parse_vtt_or_srt(SRT_SAMPLE)
    assert len(segments) == 3
    assert segments[0].start_sec == 0.0
    assert segments[1].start_sec == 4.5
    assert segments[2].start_sec == 9.2


def test_pick_subtitle_prefers_pt_over_en() -> None:
    probe = VideoProbe(
        video_id="abc",
        title="t",
        channel=None,
        duration_sec=60,
        published_at=None,
        thumbnail_url=None,
        language_hint=None,
        available_subtitles={
            "en": [{"ext": "vtt"}],
            "pt": [{"ext": "vtt"}, {"ext": "srt"}],
        },
        automatic_captions={},
    )
    assert pick_subtitle_lang(probe) == ("pt", "vtt")


def test_pick_subtitle_falls_back_to_auto_captions() -> None:
    probe = VideoProbe(
        video_id="abc",
        title="t",
        channel=None,
        duration_sec=60,
        published_at=None,
        thumbnail_url=None,
        language_hint=None,
        available_subtitles={},
        automatic_captions={"pt": [{"ext": "vtt"}]},
    )
    assert pick_subtitle_lang(probe) == ("pt", "vtt")


def test_pick_subtitle_none_when_unavailable() -> None:
    probe = VideoProbe(
        video_id="abc",
        title="t",
        channel=None,
        duration_sec=60,
        published_at=None,
        thumbnail_url=None,
        language_hint=None,
        available_subtitles={},
        automatic_captions={},
    )
    assert pick_subtitle_lang(probe) is None


def test_pick_subtitle_falls_back_to_any_lang() -> None:
    probe = VideoProbe(
        video_id="abc",
        title="t",
        channel=None,
        duration_sec=60,
        published_at=None,
        thumbnail_url=None,
        language_hint=None,
        available_subtitles={"de": [{"ext": "vtt"}]},
        automatic_captions={},
    )
    pick = pick_subtitle_lang(probe)
    assert pick is not None
    assert pick[0] == "de"
    assert pick[1] == "vtt"
