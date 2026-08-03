"""Testes do parser VTT/SRT + escolha de idioma."""

from __future__ import annotations

import xml.etree.ElementTree
from unittest.mock import AsyncMock

from src import ytdl
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


# Rolling captions (legendas automáticas do YouTube): cada cue repete a linha
# do cue anterior e acrescenta a nova — padrão real visto em prod (spec 029).
VTT_ROLLING_SAMPLE = """WEBVTT

00:00:00.000 --> 00:00:02.000
CNPJ terá letras e números a partir de

00:00:02.000 --> 00:00:04.000
CNPJ terá letras e números a partir de
julho, mês que vem, cara. Então, você

00:00:04.000 --> 00:00:06.000
julho, mês que vem, cara. Então, você

00:00:06.000 --> 00:00:08.000
julho, mês que vem, cara. Então, você
que é programador, o que isso impacta
"""


def test_parse_vtt_rolling_dedup() -> None:
    segments = parse_vtt_or_srt(VTT_ROLLING_SAMPLE)
    texts = [s.text for s in segments]
    assert texts == [
        "CNPJ terá letras e números a partir de",
        "julho, mês que vem, cara. Então, você",
        "que é programador, o que isso impacta",
    ]
    # Cue 100% repetido não vira segmento; timestamps dos demais preservados
    assert segments[0].start_sec == 0.0
    assert segments[1].start_sec == 2.0
    assert segments[2].start_sec == 6.0


def test_parse_vtt_rolling_identical_consecutive_cues() -> None:
    sample = """WEBVTT

00:00:00.000 --> 00:00:02.000
mesma linha

00:00:02.000 --> 00:00:04.000
mesma linha

00:00:04.000 --> 00:00:06.000
outra linha
"""
    segments = parse_vtt_or_srt(sample)
    assert [s.text for s in segments] == ["mesma linha", "outra linha"]


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


async def test_fetch_youtube_transcript_builds_probe_and_segments(monkeypatch) -> None:
    class FakeSnippet:
        def __init__(self, text: str, start: float, duration: float) -> None:
            self.text = text
            self.start = start
            self.duration = duration

    class FakeFetched:
        language_code = "pt"

        def __iter__(self):
            return iter(
                [
                    FakeSnippet("Olá <b>mundo</b>", 0.0, 2.0),
                    FakeSnippet("Segundo trecho", 2.0, 3.2),
                ]
            )

    class FakeApi:
        def __init__(self, proxy_config=None) -> None:
            self.proxy_config = proxy_config

        def fetch(self, video_id, languages, preserve_formatting=False):
            assert video_id == "dQw4w9WgXcQ"
            assert languages[0] == "pt"
            return FakeFetched()

    monkeypatch.setattr(ytdl, "YouTubeTranscriptApi", FakeApi)
    monkeypatch.setattr(ytdl, "_runtime_options", AsyncMock(return_value={}))
    monkeypatch.setattr(
        ytdl,
        "_fetch_youtube_oembed",
        lambda video_id, proxy_url: {
            "title": "Video de teste",
            "author_name": "Canal",
            "author_url": "https://www.youtube.com/@canal",
            "thumbnail_url": "https://img.example/thumb.jpg",
        },
    )

    result = await ytdl.fetch_youtube_transcript("https://youtu.be/dQw4w9WgXcQ")

    assert result is not None
    assert result.language == "pt"
    assert result.probe.title == "Video de teste"
    assert result.probe.channel == "Canal"
    assert result.probe.author == "Canal"
    assert result.probe.canonical_url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert result.probe.channel_url == "https://www.youtube.com/@canal"
    assert result.probe.duration_sec == 6
    assert result.segments[0].text == "Olá mundo"


async def test_fetch_youtube_transcript_ignores_non_youtube(monkeypatch) -> None:
    monkeypatch.setattr(ytdl, "_runtime_options", AsyncMock(return_value={}))

    result = await ytdl.fetch_youtube_transcript("https://example.com/watch?v=dQw4w9WgXcQ")

    assert result is None


async def test_fetch_youtube_transcript_malformed_xml_falls_back(monkeypatch) -> None:
    class FakeApi:
        def __init__(self, proxy_config=None) -> None:
            self.proxy_config = proxy_config

        def fetch(self, video_id, languages, preserve_formatting=False):
            raise xml.etree.ElementTree.ParseError("no element found: line 1, column 0")

    monkeypatch.setattr(ytdl, "YouTubeTranscriptApi", FakeApi)
    monkeypatch.setattr(ytdl, "_runtime_options", AsyncMock(return_value={}))

    result = await ytdl.fetch_youtube_transcript("https://youtu.be/dQw4w9WgXcQ")

    assert result is None
