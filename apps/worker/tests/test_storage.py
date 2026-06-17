"""Testes do helper de upload pro storage S3 (sem rede)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src import storage


@pytest.fixture(autouse=True)
def _aws_creds(monkeypatch: pytest.MonkeyPatch) -> None:
    # Garante que S3_* não estão definidos (testes usam fallback GARAGE_*)
    for k in ("S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_REGION", "S3_BUCKET", "S3_ENDPOINT"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("GARAGE_ACCESS_KEY", "test-access-key")
    monkeypatch.setenv("GARAGE_SECRET_KEY", "test-secret-key")
    monkeypatch.setenv("GARAGE_REGION", "garage")
    monkeypatch.setenv("GARAGE_BUCKET", "voxen-test-bucket")
    monkeypatch.setenv("GARAGE_ENDPOINT", "http://garage:3900")


def test_transcript_key_format() -> None:
    assert (
        storage.transcript_key("cuser01", "ctranscript01")
        == "workspaces/cuser01/transcripts/ctranscript01.md"
    )


def test_upload_key_format() -> None:
    assert (
        storage.upload_key("cuser01", "123e4567-e89b-12d3-a456-426614174000", "aula.mp4")
        == "workspaces/cuser01/uploads/123e4567-e89b-12d3-a456-426614174000/aula.mp4"
    )


def test_upload_preview_key_format() -> None:
    assert (
        storage.upload_preview_key(
            "cuser01", "123e4567-e89b-12d3-a456-426614174000", "aula final!!.mp4"
        )
        == "workspaces/cuser01/uploads/123e4567-e89b-12d3-a456-426614174000/aula_final.preview.jpg"
    )


def test_env_helpers_fallback_garage() -> None:
    assert storage.s3_bucket() == "voxen-test-bucket"
    assert storage.s3_endpoint() == "http://garage:3900"
    assert storage.s3_access_key() == "test-access-key"


def test_s3_env_takes_precedence_over_garage(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("S3_BUCKET", "minio-bucket")
    monkeypatch.setenv("S3_ENDPOINT", "https://minio.example.com")
    monkeypatch.setenv("S3_ACCESS_KEY", "minio-key")
    assert storage.s3_bucket() == "minio-bucket"
    assert storage.s3_endpoint() == "https://minio.example.com"
    assert storage.s3_access_key() == "minio-key"


def test_access_key_raises_when_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GARAGE_ACCESS_KEY", raising=False)
    monkeypatch.delenv("S3_ACCESS_KEY", raising=False)
    with pytest.raises(RuntimeError, match="S3_ACCESS_KEY"):
        storage.s3_access_key()


async def test_put_markdown_calls_s3_put_object_with_expected_args() -> None:
    fake_client = MagicMock()
    fake_client.put_object = AsyncMock(return_value={})
    fake_ctx = MagicMock()
    fake_ctx.__aenter__ = AsyncMock(return_value=fake_client)
    fake_ctx.__aexit__ = AsyncMock(return_value=False)

    with patch.object(storage, "s3_session") as mock_session:
        mock_session.return_value.client.return_value = fake_ctx
        await storage.put_markdown(key="workspaces/u1/transcripts/t1.md", content="hello")

    fake_client.put_object.assert_awaited_once()
    kwargs = fake_client.put_object.await_args.kwargs
    assert kwargs["Bucket"] == "voxen-test-bucket"
    assert kwargs["Key"] == "workspaces/u1/transcripts/t1.md"
    assert kwargs["Body"] == b"hello"
    assert kwargs["ContentType"].startswith("text/markdown")


async def test_put_file_calls_s3_put_object_with_expected_args(tmp_path) -> None:  # noqa: ANN001
    preview = tmp_path / "preview.jpg"
    preview.write_bytes(b"jpeg")
    fake_client = MagicMock()
    fake_client.put_object = AsyncMock(return_value={})
    fake_ctx = MagicMock()
    fake_ctx.__aenter__ = AsyncMock(return_value=fake_client)
    fake_ctx.__aexit__ = AsyncMock(return_value=False)

    with patch.object(storage, "s3_session") as mock_session:
        mock_session.return_value.client.return_value = fake_ctx
        await storage.put_file(
            key="workspaces/u1/uploads/up1/preview.jpg",
            path=preview,
            content_type="image/jpeg",
        )

    fake_client.put_object.assert_awaited_once()
    kwargs = fake_client.put_object.await_args.kwargs
    assert kwargs["Bucket"] == "voxen-test-bucket"
    assert kwargs["Key"] == "workspaces/u1/uploads/up1/preview.jpg"
    assert kwargs["Body"] == b"jpeg"
    assert kwargs["ContentType"] == "image/jpeg"
