"""Storage S3 (MinIO, Garage ou outro S3-compatível) — uploads via aioboto3.

Aceita variáveis `S3_*` como primeira opção, com fallback pra `GARAGE_*`
para compatibilidade com instalações antigas.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import aioboto3
from botocore.config import Config as BotoConfig


def _env(*keys: str, default: str | None = None) -> str | None:
    for k in keys:
        v = os.environ.get(k)
        if v:
            return v
    return default


def s3_endpoint() -> str:
    return _env("S3_ENDPOINT", "GARAGE_ENDPOINT", default="http://minio:9000") or ""


def s3_bucket() -> str:
    return _env("S3_BUCKET", "GARAGE_BUCKET", default="voxen-transcripts") or "voxen-transcripts"


def s3_access_key() -> str:
    v = _env("S3_ACCESS_KEY", "GARAGE_ACCESS_KEY")
    if not v:
        raise RuntimeError("S3_ACCESS_KEY (ou GARAGE_ACCESS_KEY) não definido")
    return v


def s3_secret_key() -> str:
    v = _env("S3_SECRET_KEY", "GARAGE_SECRET_KEY")
    if not v:
        raise RuntimeError("S3_SECRET_KEY (ou GARAGE_SECRET_KEY) não definido")
    return v


def s3_region() -> str:
    return _env("S3_REGION", "GARAGE_REGION", default="us-east-1") or "us-east-1"


def s3_force_path_style() -> bool:
    # Default true (Garage e MinIO precisam). AWS S3 puro: defina como false.
    v = (_env("S3_FORCE_PATH_STYLE", default="true") or "true").lower()
    return v not in ("false", "0", "no")


def s3_session() -> aioboto3.Session:
    return aioboto3.Session(
        aws_access_key_id=s3_access_key(),
        aws_secret_access_key=s3_secret_key(),
        region_name=s3_region(),
    )


def s3_client_kwargs() -> dict[str, Any]:
    addressing = "path" if s3_force_path_style() else "virtual"
    return {
        "service_name": "s3",
        "endpoint_url": s3_endpoint(),
        "config": BotoConfig(s3={"addressing_style": addressing}),
    }


async def put_markdown(
    *,
    key: str,
    content: str,
    bucket: str | None = None,
) -> None:
    """Upload `content` (UTF-8) como text/markdown na key especificada."""
    session = s3_session()
    async with session.client(**s3_client_kwargs()) as s3:
        await s3.put_object(
            Bucket=bucket or s3_bucket(),
            Key=key,
            Body=content.encode("utf-8"),
            ContentType="text/markdown; charset=utf-8",
        )


async def put_file(
    *,
    key: str,
    path: Path,
    content_type: str = "application/octet-stream",
    bucket: str | None = None,
) -> None:
    """Upload de arquivo local para S3 preservando content-type."""
    session = s3_session()
    async with session.client(**s3_client_kwargs()) as s3:
        await s3.put_object(
            Bucket=bucket or s3_bucket(),
            Key=key,
            Body=path.read_bytes(),
            ContentType=content_type,
        )


def transcript_key(user_id: str, transcript_id: str) -> str:
    return f"workspaces/{user_id}/transcripts/{transcript_id}.md"


def upload_key(user_id: str, upload_id: str, filename: str) -> str:
    return f"workspaces/{user_id}/uploads/{upload_id}/{filename}"


def upload_preview_key(user_id: str, upload_id: str, filename: str) -> str:
    stem = Path(filename).stem or "preview"
    safe_stem = re.sub(r"[^A-Za-z0-9_-]+", "_", stem).strip("_")[:80] or "preview"
    return f"workspaces/{user_id}/uploads/{upload_id}/{safe_stem}.preview.jpg"


async def download_to_file(*, key: str, dest: Path, bucket: str | None = None) -> None:
    """Baixa um objeto S3 para `dest`."""
    session = s3_session()
    async with session.client(**s3_client_kwargs()) as s3:
        response = await s3.get_object(Bucket=bucket or s3_bucket(), Key=key)
        body = response["Body"]
        try:
            with dest.open("wb") as fh:
                while True:
                    chunk = await body.read(1024 * 1024)
                    if not chunk:
                        break
                    fh.write(chunk)
        finally:
            close = getattr(body, "close", None)
            if close is not None:
                close()
