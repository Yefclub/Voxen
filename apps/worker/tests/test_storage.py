"""Testes do helper de upload pro Garage S3 (sem rede)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src import storage


@pytest.fixture(autouse=True)
def _aws_creds(monkeypatch: pytest.MonkeyPatch) -> None:
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


def test_garage_env_helpers() -> None:
    assert storage.garage_bucket() == "voxen-test-bucket"
    assert storage.garage_endpoint() == "http://garage:3900"
    assert storage.garage_access_key() == "test-access-key"


def test_garage_access_key_raises_when_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GARAGE_ACCESS_KEY", raising=False)
    with pytest.raises(RuntimeError, match="GARAGE_ACCESS_KEY"):
        storage.garage_access_key()


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
