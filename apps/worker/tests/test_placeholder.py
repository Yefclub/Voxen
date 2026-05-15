"""Smoke test do placeholder job."""

import pytest

from src.main import placeholder_job


@pytest.mark.asyncio
async def test_placeholder_job_returns_ok() -> None:
    result = await placeholder_job({}, "hello")
    assert result == "ok: hello"
