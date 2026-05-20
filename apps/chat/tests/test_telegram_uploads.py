"""Testes dos classificadores de anexos do Telegram."""

from __future__ import annotations

from src.telegram_bot import _telegram_upload_spec_from_message


def test_telegram_audio_attachment_becomes_transcription_job() -> None:
    spec = _telegram_upload_spec_from_message(
        {
            "audio": {
                "file_id": "abc123",
                "file_name": "reuniao.mp3",
                "mime_type": "audio/mpeg",
                "file_size": 1024,
            }
        }
    )
    assert spec is not None
    assert spec.kind == "media"
    assert spec.job_type == "UPLOAD_AND_TRANSCRIBE"
    assert spec.filename == "reuniao.mp3"


def test_telegram_voice_attachment_gets_audio_fallback() -> None:
    spec = _telegram_upload_spec_from_message(
        {"voice": {"file_id": "voicefileid", "file_size": 2048}}
    )
    assert spec is not None
    assert spec.kind == "media"
    assert spec.content_type == "audio/ogg"
    assert spec.filename.endswith(".ogg")


def test_telegram_image_document_becomes_visual_job() -> None:
    spec = _telegram_upload_spec_from_message(
        {
            "document": {
                "file_id": "img123",
                "file_name": "print da tela.png",
                "mime_type": "application/octet-stream",
                "file_size": 4096,
            }
        }
    )
    assert spec is not None
    assert spec.kind == "image"
    assert spec.job_type == "UPLOAD_AND_ANALYZE_IMAGE"
    assert spec.filename == "print_da_tela.png"


def test_telegram_photo_becomes_visual_job() -> None:
    spec = _telegram_upload_spec_from_message(
        {
            "photo": [
                {"file_id": "small_photo", "file_size": 1024},
                {"file_id": "largest_photo", "file_size": 4096},
            ]
        }
    )
    assert spec is not None
    assert spec.kind == "image"
    assert spec.job_type == "UPLOAD_AND_ANALYZE_IMAGE"
    assert spec.content_type == "image/jpeg"
    assert spec.file_id == "largest_photo"
    assert spec.filename == "foto-largest_ph.jpg"


def test_telegram_pdf_document_becomes_document_job() -> None:
    spec = _telegram_upload_spec_from_message(
        {
            "document": {
                "file_id": "doc123",
                "file_name": "relatorio.pdf",
                "mime_type": "application/pdf",
                "file_size": 4096,
            }
        }
    )
    assert spec is not None
    assert spec.kind == "document"
    assert spec.job_type == "UPLOAD_AND_ANALYZE_DOCUMENT"
    assert spec.filename == "relatorio.pdf"


def test_telegram_rejects_zip_and_legacy_document_formats() -> None:
    for filename, mime_type in (
        ("pacote.zip", "application/zip"),
        ("apresentacao.ppt", "application/vnd.ms-powerpoint"),
        ("texto.rtf", "application/rtf"),
    ):
        spec = _telegram_upload_spec_from_message(
            {
                "document": {
                    "file_id": f"file-{filename}",
                    "file_name": filename,
                    "mime_type": mime_type,
                    "file_size": 4096,
                }
            }
        )
        assert spec is None
