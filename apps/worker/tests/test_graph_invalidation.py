from __future__ import annotations

from collections.abc import AsyncIterator
from unittest.mock import AsyncMock

import pytest

from src import events


class FakeRedis:
    def __init__(self) -> None:
        self.delete = AsyncMock()
        self.publish = AsyncMock()

    async def scan_iter(self, *, match: str, count: int) -> AsyncIterator[str]:
        assert match == "voxen:graph:v4:user-1:*"
        assert count == 100
        yield "voxen:graph:v4:user-1:full"
        yield "voxen:graph:v4:user-1:full:f:node-1:h1"


@pytest.mark.asyncio
async def test_graph_invalidation_clears_variants_and_publishes(monkeypatch) -> None:
    redis = FakeRedis()
    monkeypatch.setattr(events, "get_redis", AsyncMock(return_value=redis))

    await events.publish_graph_invalidation("user-1")

    redis.delete.assert_awaited_once_with(
        "voxen:graph:v4:user-1:full",
        "voxen:graph:v4:user-1:full:f:node-1:h1",
    )
    redis.publish.assert_awaited_once()
    channel, payload = redis.publish.await_args.args
    assert channel == "voxen:graph:v4:events:user-1"
    assert '"type": "invalidated"' in payload


@pytest.mark.asyncio
async def test_graph_invalidation_is_best_effort(monkeypatch) -> None:
    monkeypatch.setattr(events, "get_redis", AsyncMock(side_effect=ConnectionError("offline")))
    await events.publish_graph_invalidation("user-1")
