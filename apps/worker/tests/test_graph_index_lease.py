"""Contrato do lease Redis compartilhado entre web e worker."""

from __future__ import annotations

import asyncio
from typing import Any

from src import graph_index_lease


class _FakeRedis:
    def __init__(self, *, owner: str | None = None, set_result: object = True) -> None:
        self.owner = owner
        self.set_result = set_result
        self.set_calls: list[tuple[str, str, int, bool]] = []
        self.eval_calls: list[tuple[str, int, tuple[str | int, ...]]] = []

    async def set(
        self,
        name: str,
        value: str,
        *,
        px: int,
        nx: bool,
    ) -> object:
        self.set_calls.append((name, value, px, nx))
        if self.set_result and (not nx or self.owner is None):
            self.owner = value
            return self.set_result
        return None

    async def eval(
        self,
        script: str,
        numkeys: int,
        *keys_and_args: str | int,
    ) -> object:
        self.eval_calls.append((script, numkeys, keys_and_args))
        _key, expected_owner, *rest = keys_and_args
        if self.owner != expected_owner:
            return 0
        if "pexpire" in script:
            assert rest == [graph_index_lease.GRAPH_INDEX_LEASE_TTL_MS]
            return 1
        if "del" in script:
            self.owner = None
            return 1
        raise AssertionError("script Redis inesperado")


async def test_graph_index_lease_uses_web_key_ttl_and_owned_compare_operations() -> None:
    redis = _FakeRedis()

    lease = await graph_index_lease.acquire_graph_index_lease(
        "user-1",
        redis=redis,
        owner="worker-run-1",
    )

    assert lease is not None
    assert lease.key == "voxen:graph:index:v1:lease:user-1"
    assert lease.owner == "worker-run-1"
    assert redis.set_calls == [
        (
            "voxen:graph:index:v1:lease:user-1",
            "worker-run-1",
            120_000,
            True,
        )
    ]
    assert await lease.renew() is True

    redis.owner = "web-run-2"
    assert await lease.renew() is False
    assert await lease.release() is False
    assert redis.owner == "web-run-2"

    redis.owner = "worker-run-1"
    assert await lease.release() is True
    assert redis.owner is None
    assert all(call[1] == 1 for call in redis.eval_calls)


async def test_graph_index_lease_treats_occupied_redis_as_unavailable() -> None:
    redis = _FakeRedis(owner="web-run-1")

    lease = await graph_index_lease.acquire_graph_index_lease(
        "user-1",
        redis=redis,
        owner="worker-run-1",
    )

    assert lease is None
    assert redis.owner == "web-run-1"


async def test_graph_index_lease_treats_redis_errors_as_unavailable() -> None:
    class _UnavailableRedis(_FakeRedis):
        async def set(
            self,
            name: str,
            value: str,
            *,
            px: int,
            nx: bool,
        ) -> Any:
            raise ConnectionError("redis unavailable")

    lease = await graph_index_lease.acquire_graph_index_lease(
        "user-1",
        redis=_UnavailableRedis(),
        owner="worker-run-1",
    )

    assert lease is None


async def test_graph_index_lease_heartbeat_renews_long_running_work(monkeypatch: Any) -> None:
    redis = _FakeRedis()
    lease = await graph_index_lease.acquire_graph_index_lease(
        "user-1",
        redis=redis,
        owner="worker-run-1",
    )
    assert lease is not None

    monkeypatch.setattr(graph_index_lease, "GRAPH_INDEX_LEASE_HEARTBEAT_SECONDS", 0)

    async with lease.heartbeat():
        for _ in range(10):
            if redis.eval_calls:
                break
            await asyncio.sleep(0)

    assert redis.eval_calls
    assert "pexpire" in redis.eval_calls[0][0]
