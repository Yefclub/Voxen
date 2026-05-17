"""Garage S3 upload via aioboto3."""

from __future__ import annotations

import os
from typing import Any

import aioboto3


def garage_endpoint() -> str:
    return os.environ.get("GARAGE_ENDPOINT", "http://garage:3900")


def garage_bucket() -> str:
    return os.environ.get("GARAGE_BUCKET", "voxen-transcripts")


def garage_access_key() -> str:
    v = os.environ.get("GARAGE_ACCESS_KEY")
    if not v:
        raise RuntimeError("GARAGE_ACCESS_KEY não definido")
    return v


def garage_secret_key() -> str:
    v = os.environ.get("GARAGE_SECRET_KEY")
    if not v:
        raise RuntimeError("GARAGE_SECRET_KEY não definido")
    return v


def garage_region() -> str:
    return os.environ.get("GARAGE_REGION", "garage")


def s3_session() -> aioboto3.Session:
    return aioboto3.Session(
        aws_access_key_id=garage_access_key(),
        aws_secret_access_key=garage_secret_key(),
        region_name=garage_region(),
    )


def s3_client_kwargs() -> dict[str, Any]:
    return {
        "service_name": "s3",
        "endpoint_url": garage_endpoint(),
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
            Bucket=bucket or garage_bucket(),
            Key=key,
            Body=content.encode("utf-8"),
            ContentType="text/markdown; charset=utf-8",
        )


def transcript_key(user_id: str, transcript_id: str) -> str:
    return f"workspaces/{user_id}/transcripts/{transcript_id}.md"
