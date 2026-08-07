"""Provider-neutral storage for a local shared volume or S3-compatible service."""

from __future__ import annotations

import asyncio
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any

import aioboto3
from botocore.config import Config as BotoConfig

_STORAGE_DISCRIMINATORS = (
    "S3_ENDPOINT",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "S3_BUCKET",
    "S3_REGION",
    "S3_FORCE_PATH_STYLE",
    "S3_PUBLIC_ENDPOINT",
    "S3_CREDS_PATH",
    "GARAGE_ENDPOINT",
    "GARAGE_ACCESS_KEY",
    "GARAGE_SECRET_KEY",
    "GARAGE_BUCKET",
    "GARAGE_REGION",
    "GARAGE_CREDS_PATH",
)


def storage_driver() -> str:
    explicit = (os.environ.get("STORAGE_DRIVER") or "").strip().lower()
    if explicit:
        if explicit not in ("local", "s3"):
            raise RuntimeError("STORAGE_DRIVER must be either local or s3")
        return explicit
    configured = any((os.environ.get(key) or "").strip() for key in _STORAGE_DISCRIMINATORS)
    return "s3" if configured else "local"


def storage_local_path() -> Path:
    value = (os.environ.get("STORAGE_LOCAL_PATH") or "/data/storage").strip()
    path = Path(value)
    if not path.is_absolute():
        raise RuntimeError("STORAGE_LOCAL_PATH must be an absolute path")
    root = path.resolve()
    cwd = Path.cwd().resolve()
    if root == Path(root.anchor) or root == cwd or root in cwd.parents:
        raise RuntimeError("STORAGE_LOCAL_PATH points to an unsafe application or root directory")
    return root


def _normalize_key(key: str) -> str:
    if not key or "\x00" in key or "\\" in key or key.startswith("/"):
        raise RuntimeError("Invalid storage key")
    parts = key.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise RuntimeError("Invalid storage key")
    return "/".join(parts)


def _local_target(key: str) -> Path:
    root = storage_local_path()
    candidate = root / _normalize_key(key)
    root.mkdir(parents=True, exist_ok=True, mode=0o750)
    current = root
    for part in candidate.relative_to(root).parts:
        current = current / part
        if current.is_symlink():
            raise RuntimeError("Symbolic links are not allowed in storage paths")

    target = candidate.resolve(strict=False)
    if target == root or root not in target.parents:
        raise RuntimeError("Storage key escaped root")
    return target


def _atomic_write(target: Path, writer: Any) -> None:
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
    fd, temporary_name = tempfile.mkstemp(
        prefix=f".{target.name}.", suffix=".tmp", dir=target.parent
    )
    temporary = Path(temporary_name)
    try:
        os.fchmod(fd, 0o640)
        with os.fdopen(fd, "wb") as output:
            writer(output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
    except BaseException:
        try:
            os.close(fd)
        except OSError:
            pass
        temporary.unlink(missing_ok=True)
        raise


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
    """Write UTF-8 Markdown using the selected storage driver."""
    if storage_driver() == "local":
        target = _local_target(key)
        encoded = content.encode("utf-8")
        await asyncio.to_thread(_atomic_write, target, lambda output: output.write(encoded))
        return
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
    """Copy a file into the selected storage while preserving its logical key."""
    if storage_driver() == "local":
        target = _local_target(key)
        await asyncio.to_thread(
            _atomic_write,
            target,
            lambda output: _copy_file(path, output),
        )
        return
    session = s3_session()
    async with session.client(**s3_client_kwargs()) as s3:
        await s3.upload_file(
            str(path),
            bucket or s3_bucket(),
            key,
            ExtraArgs={"ContentType": content_type},
        )


def _copy_file(path: Path, output: Any) -> None:
    with path.open("rb") as source:
        shutil.copyfileobj(source, output, length=1024 * 1024)


def transcript_key(user_id: str, transcript_id: str) -> str:
    return f"workspaces/{user_id}/transcripts/{transcript_id}.md"


def source_version_key(user_id: str, transcript_id: str, version: int) -> str:
    """Chave imutável de um snapshot de fonte externa."""
    return f"workspaces/{user_id}/transcripts/{transcript_id}/sources/v{version}.md"


def upload_key(user_id: str, upload_id: str, filename: str) -> str:
    return f"workspaces/{user_id}/uploads/{upload_id}/{filename}"


def upload_preview_key(user_id: str, upload_id: str, filename: str) -> str:
    stem = Path(filename).stem or "preview"
    safe_stem = re.sub(r"[^A-Za-z0-9_-]+", "_", stem).strip("_")[:80] or "preview"
    return f"workspaces/{user_id}/uploads/{upload_id}/{safe_stem}.preview.jpg"


async def download_to_file(*, key: str, dest: Path, bucket: str | None = None) -> None:
    """Download an object to a worker-local temporary file."""
    if storage_driver() == "local":
        source = _local_target(key)
        if not source.is_file() or source.is_symlink():
            raise FileNotFoundError(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(shutil.copyfile, source, dest)
        return
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


async def get_markdown(*, key: str, bucket: str | None = None) -> str:
    """Read canonical Markdown preserving lines and timestamps."""
    if storage_driver() == "local":
        source = _local_target(key)
        if not source.is_file() or source.is_symlink():
            raise FileNotFoundError(key)
        return await asyncio.to_thread(source.read_text, encoding="utf-8", errors="replace")
    session = s3_session()
    async with session.client(**s3_client_kwargs()) as s3:
        response = await s3.get_object(Bucket=bucket or s3_bucket(), Key=key)
        body = response["Body"]
        try:
            raw = await body.read()
        finally:
            close = getattr(body, "close", None)
            if close is not None:
                close()
    return bytes(raw).decode("utf-8", errors="replace")
