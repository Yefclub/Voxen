"""Testes do renderer .md (formato canônico — docs/TRANSCRIPT-FORMAT.md)."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

import yaml

from src.transcript_md import (
    Segment,
    TranscriptDoc,
    build_frontmatter,
    render_markdown,
    render_plain_text,
)


def _doc(**overrides: object) -> TranscriptDoc:
    defaults = {
        "transcript_id": "ctest12345",
        "user_id": "cuser0001",
        "source": "YOUTUBE",
        "url": "https://youtu.be/dQw4w9WgXcQ",
        "video_id": "dQw4w9WgXcQ",
        "title": "Como configurar Postgres FTS",
        "channel": "Canal do Dev",
        "author": None,
        "duration_sec": 738,
        "published_at": datetime(2026, 4, 20, 15, 30, tzinfo=UTC),
        "thumbnail_url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
        "language": "pt",
        "transcription_method": "API",
        "model": "openai/whisper-large-v3-turbo",
        "cost_usd": Decimal("0.0042"),
        "segments": (
            Segment(start_sec=0.0, text="Olá pessoal, hoje vou falar de FTS."),
            Segment(start_sec=15.0, text="Antes, é importante entender porque é diferente."),
            Segment(start_sec=42.5, text="Vou abrir o psql e mostrar."),
        ),
        "transcribed_at": datetime(2026, 5, 16, 20, 42, 11, tzinfo=UTC),
    }
    defaults.update(overrides)  # type: ignore[arg-type]
    return TranscriptDoc(**defaults)  # type: ignore[arg-type]


def test_render_markdown_has_frontmatter_with_required_fields() -> None:
    md = render_markdown(_doc())
    assert md.startswith("---\n")
    fm_end = md.index("\n---\n", 4)
    fm = yaml.safe_load(md[4:fm_end])
    for k in (
        "id",
        "workspace_id",
        "source",
        "url",
        "title",
        "duration_sec",
        "language",
        "transcription_method",
        "transcribed_at",
    ):
        assert k in fm, f"frontmatter sem campo obrigatório {k}"
    assert fm["source"] == "youtube"
    assert fm["transcription_method"] == "api"


def test_render_markdown_timestamp_format_and_link() -> None:
    md = render_markdown(_doc())
    # Primeiro segmento: 0s → 00:00:00, link youtu.be/<id>?t=0
    assert "[00:00:00](https://youtu.be/dQw4w9WgXcQ?t=0)" in md
    # Segundo: 15s → 00:00:15
    assert "[00:00:15](https://youtu.be/dQw4w9WgXcQ?t=15)" in md
    # Terceiro: 42.5s → 00:00:42, link ?t=42 (int)
    assert "[00:00:42](https://youtu.be/dQw4w9WgXcQ?t=42)" in md


def test_render_markdown_omits_optional_fields_when_absent() -> None:
    doc = _doc(
        channel=None,
        published_at=None,
        thumbnail_url=None,
        model=None,
        cost_usd=None,
        transcription_method="SUBTITLES",
    )
    md = render_markdown(doc)
    fm_end = md.index("\n---\n", 4)
    fm = yaml.safe_load(md[4:fm_end])
    assert "channel" not in fm
    assert "published_at" not in fm
    assert "thumbnail" not in fm
    assert "model" not in fm
    assert "cost_usd" not in fm
    # Sem thumbnail, o ![thumbnail](...) não deve aparecer
    assert "![thumbnail]" not in md


def test_render_plain_text_strips_timestamps_and_headers() -> None:
    plain = render_plain_text(_doc())
    assert "00:00:00" not in plain
    assert "[" not in plain
    assert "Olá pessoal" in plain
    assert "Vou abrir o psql" in plain


def test_build_frontmatter_cost_is_float_not_decimal() -> None:
    fm = build_frontmatter(_doc())
    # yaml.safe_dump não serializa Decimal; o builder converte pra float
    import json

    json.dumps(fm)  # não deve estourar
    assert isinstance(fm["cost_usd"], float)
    assert fm["cost_usd"] == 0.0042


def test_render_upload_markdown_has_no_external_timestamp_links() -> None:
    md = render_markdown(
        _doc(
            source="UPLOAD",
            url="upload://123e4567-e89b-12d3-a456-426614174000/aula.mp4",
            video_id="123e4567-e89b-12d3-a456-426614174000",
            title="aula",
            channel="Upload local",
            thumbnail_url=None,
        )
    )
    assert "Arquivo enviado" in md
    assert "[Vídeo original]" not in md
    assert "[00:00:00] Olá pessoal" in md
