"""Garage S3 reader — busca .md de transcripts."""

from __future__ import annotations

import os

import aioboto3


def _session() -> aioboto3.Session:
    return aioboto3.Session(
        aws_access_key_id=os.environ["GARAGE_ACCESS_KEY"],
        aws_secret_access_key=os.environ["GARAGE_SECRET_KEY"],
        region_name=os.environ.get("GARAGE_REGION", "garage"),
    )


def _bucket() -> str:
    return os.environ.get("GARAGE_BUCKET", "voxen-transcripts")


def _endpoint() -> str:
    return os.environ.get("GARAGE_ENDPOINT", "http://garage:3900")


async def get_markdown(md_path: str) -> str:
    session = _session()
    async with session.client(service_name="s3", endpoint_url=_endpoint()) as s3:
        res = await s3.get_object(Bucket=_bucket(), Key=md_path)
        body: bytes = await res["Body"].read()
        text: str = body.decode("utf-8")
        return text
