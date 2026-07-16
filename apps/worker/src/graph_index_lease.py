"""Lease Redis compartilhado para serializar a materializacao do Brain por usuario."""

from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
from typing import Protocol, cast

import structlog

from . import events

log = structlog.get_logger(__name__)

GRAPH_INDEX_LEASE_TTL_MS = 120_000
GRAPH_INDEX_LEASE_HEARTBEAT_SECONDS = 30

_RENEW_LEASE_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
"""

_RELEASE_LEASE_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
"""


class GraphIndexRedis(Protocol):
    async def set(
        self,
        name: str,
        value: str,
        *,
        px: int,
        nx: bool,
    ) -> object: ...

    async def eval(
        self,
        script: str,
        numkeys: int,
        *keys_and_args: str | int,
    ) -> object: ...


def graph_index_lease_key(user_id: str) -> str:
    return f"voxen:graph:index:v1:lease:{user_id}"


@dataclass(slots=True)
class GraphIndexLease:
    key: str
    owner: str
    redis: GraphIndexRedis
    _expires_at: float = field(
        default_factory=lambda: time.monotonic() + GRAPH_INDEX_LEASE_TTL_MS / 1_000,
        repr=False,
    )
    _lost: bool = field(default=False, repr=False)

    def locally_owned(self) -> bool:
        """Checagem sem round-trip usada entre mutacoes curtas do mesmo passe."""
        if self._lost or time.monotonic() >= self._expires_at:
            self._lost = True
            return False
        return True

    async def renew(self) -> bool:
        """Renova somente enquanto este worker continuar sendo o proprietario."""
        if not self.locally_owned():
            return False
        try:
            result = await self.redis.eval(
                _RENEW_LEASE_SCRIPT,
                1,
                self.key,
                self.owner,
                GRAPH_INDEX_LEASE_TTL_MS,
            )
        except Exception:  # noqa: BLE001
            log.warning("graph-index-lease-renew-unavailable", key=self.key)
            # Uma oscilacao curta nao invalida um lease que ainda nao expirou.
            return self.locally_owned()
        if not _redis_result_is_one(result):
            self._lost = True
            return False
        self._expires_at = time.monotonic() + GRAPH_INDEX_LEASE_TTL_MS / 1_000
        return True

    @asynccontextmanager
    async def heartbeat(self) -> AsyncIterator[None]:
        """Mantem o TTL durante queries longas sem EVAL em cada guard local."""

        async def maintain() -> None:
            while self.locally_owned():
                await asyncio.sleep(GRAPH_INDEX_LEASE_HEARTBEAT_SECONDS)
                if not await self.renew():
                    return

        task = asyncio.create_task(maintain())
        try:
            yield
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    async def release(self) -> bool:
        """Libera com compare-and-delete para nunca apagar o lease de outro run."""
        try:
            result = await self.redis.eval(
                _RELEASE_LEASE_SCRIPT,
                1,
                self.key,
                self.owner,
            )
        except Exception:  # noqa: BLE001
            log.warning("graph-index-lease-release-unavailable", key=self.key)
            return False
        return _redis_result_is_one(result)


async def acquire_graph_index_lease(
    user_id: str,
    *,
    redis: GraphIndexRedis | None = None,
    owner: str | None = None,
) -> GraphIndexLease | None:
    """Adquire o mesmo lease NX/PX usado pelo web; falhas sao fail-closed."""
    try:
        client = redis or cast(GraphIndexRedis, await events.get_redis())
        lease_owner = owner or f"worker:{uuid.uuid4().hex}"
        key = graph_index_lease_key(user_id)
        result = await client.set(
            key,
            lease_owner,
            px=GRAPH_INDEX_LEASE_TTL_MS,
            nx=True,
        )
    except Exception:  # noqa: BLE001
        log.warning("graph-index-lease-acquire-unavailable", user_id=user_id)
        return None
    if result not in (True, "OK", b"OK"):
        return None
    return GraphIndexLease(key=key, owner=lease_owner, redis=client)


def _redis_result_is_one(result: object) -> bool:
    return result in (1, "1", b"1", True)
