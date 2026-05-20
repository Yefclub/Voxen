"""Testes dos helpers de upload local."""

from __future__ import annotations

from src import uploaded_media


def test_parse_upload_source_url() -> None:
    ref = uploaded_media.parse_upload_source_url(
        "upload://123e4567-e89b-12d3-a456-426614174000/aula%2001.mp4"
    )
    assert ref is not None
    assert ref.upload_id == "123e4567-e89b-12d3-a456-426614174000"
    assert ref.filename == "aula_01.mp4"


def test_parse_upload_source_url_rejects_invalid_scheme() -> None:
    assert uploaded_media.parse_upload_source_url("https://example.com/file.mp4") is None
    assert uploaded_media.parse_upload_source_url("upload://not-a-uuid/file.mp4") is None


def test_sanitize_filename_removes_paths_and_unsafe_chars() -> None:
    assert uploaded_media.sanitize_filename("../Meu áudio final!!.mp3") == "Meu_udio_final_.mp3"
