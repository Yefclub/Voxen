"""Storage S3 reader — busca .md de transcripts.

Aceita variáveis `S3_*` como primeira opção, com fallback pra `GARAGE_*`.
Suporta qualquer backend S3-compatível (MinIO, Garage, AWS S3).
"""

from __future__ import annotations

import os

import aioboto3
from botocore.config import Config as BotoConfig


def _env(*keys: str, default: str | None = None) -> str | None:
    for k in keys:
        v = os.environ.get(k)
        if v:
            return v
    return default


def _access_key() -> str:
    v = _env("S3_ACCESS_KEY", "GARAGE_ACCESS_KEY")
    if not v:
        raise RuntimeError("S3_ACCESS_KEY (ou GARAGE_ACCESS_KEY) não definido")
    return v


def _secret_key() -> str:
    v = _env("S3_SECRET_KEY", "GARAGE_SECRET_KEY")
    if not v:
        raise RuntimeError("S3_SECRET_KEY (ou GARAGE_SECRET_KEY) não definido")
    return v


def _session() -> aioboto3.Session:
    return aioboto3.Session(
        aws_access_key_id=_access_key(),
        aws_secret_access_key=_secret_key(),
        region_name=_env("S3_REGION", "GARAGE_REGION", default="us-east-1")
        or "us-east-1",
    )


def _bucket() -> str:
    return _env("S3_BUCKET", "GARAGE_BUCKET", default="voxen-transcripts") or "voxen-transcripts"


def _endpoint() -> str:
    return _env("S3_ENDPOINT", "GARAGE_ENDPOINT", default="http://minio:9000") or ""


def _force_path_style() -> bool:
    v = (_env("S3_FORCE_PATH_STYLE", default="true") or "true").lower()
    return v not in ("false", "0", "no")


async def get_markdown(md_path: str) -> str:
    session = _session()
    addressing = "path" if _force_path_style() else "virtual"
    config = BotoConfig(s3={"addressing_style": addressing})
    async with session.client(
        service_name="s3", endpoint_url=_endpoint(), config=config
    ) as s3:
        res = await s3.get_object(Bucket=_bucket(), Key=md_path)
        body: bytes = await res["Body"].read()
        text: str = body.decode("utf-8")
        return text
