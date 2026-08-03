"""Fencing local de jobs baseado no lease durável do Postgres."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from contextlib import asynccontextmanager, contextmanager
from contextvars import ContextVar
from dataclasses import dataclass


class JobLeaseLostError(RuntimeError):
    """O executor não pode mais produzir efeitos para esta tentativa."""


@dataclass(frozen=True)
class JobLeaseToken:
    job_id: str
    worker_id: str
    attempt: int


_current_token: ContextVar[JobLeaseToken | None] = ContextVar(
    "voxen_current_job_lease",
    default=None,
)


def current_job_lease() -> JobLeaseToken | None:
    return _current_token.get()


@contextmanager
def activate_job_lease(token: JobLeaseToken) -> Iterator[None]:
    marker = _current_token.set(token)
    try:
        yield
    finally:
        _current_token.reset(marker)


class JobLease:
    def __init__(
        self,
        token: JobLeaseToken,
        renew: Callable[[JobLeaseToken], Awaitable[bool]],
        *,
        heartbeat_interval_sec: float,
    ) -> None:
        self.token = token
        self._renew = renew
        self._heartbeat_interval_sec = heartbeat_interval_sec
        self._lost = False

    async def _heartbeat_loop(self, owner: asyncio.Task[object]) -> None:
        try:
            while True:
                await asyncio.sleep(self._heartbeat_interval_sec)
                try:
                    owned = await self._renew(self.token)
                except Exception:  # DB indisponível: falha fechada antes do lease expirar.
                    owned = False
                if owned:
                    continue
                self._lost = True
                owner.cancel()
                return
        except asyncio.CancelledError:
            raise

    @asynccontextmanager
    async def heartbeat(self) -> AsyncIterator[None]:
        owner = asyncio.current_task()
        if owner is None:
            raise RuntimeError("job lease requires an asyncio task")
        heartbeat = asyncio.create_task(self._heartbeat_loop(owner))
        try:
            yield
        except asyncio.CancelledError as exc:
            if self._lost:
                raise JobLeaseLostError("job lease lost") from exc
            raise
        finally:
            heartbeat.cancel()
            await asyncio.gather(heartbeat, return_exceptions=True)
