from __future__ import annotations

import asyncio
from collections.abc import Coroutine
from typing import Any

import pytest

from src import main


class _Logger:
    def __init__(self) -> None:
        self.entries: list[tuple[str, dict[str, object]]] = []

    def error(self, event: str, **kwargs: object) -> None:
        self.entries.append((event, kwargs))

    def info(self, _event: str, **_kwargs: object) -> None:
        pass


def test_main_boundary_suppresses_external_traceback_and_message(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    private_error = (
        "redis://proxy-user:proxy-pass@cliente-acme-fusao-secreta.example/"
        "Cliente-Acme-Fusao-Secreta.pdf"
    )
    logger = _Logger()

    def fail_run(coroutine: Coroutine[Any, Any, Any]) -> None:
        coroutine.close()
        raise ConnectionError(private_error)

    monkeypatch.setattr(main.asyncio, "run", fail_run)
    monkeypatch.setattr(main, "log", logger)

    with pytest.raises(SystemExit) as exc_info:
        main.main()

    assert exc_info.value.code == 1
    assert exc_info.value.__suppress_context__ is True
    assert logger.entries == [
        (
            "worker-runtime-failed",
            {
                "error_code": "WORKER_RUNTIME_FAILED",
                "error_type": "ConnectionError",
            },
        )
    ]
    assert "cliente-acme" not in repr(logger.entries)
    assert "proxy-pass" not in repr(logger.entries)
    assert "Cliente-Acme-Fusao-Secreta.pdf" not in repr(logger.entries)
    assert capsys.readouterr().err == ""


def test_real_asyncio_supervisor_awaits_failing_sibling_cleanup_without_stderr(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    primary_secret = (
        "redis://proxy-user:proxy-pass@cliente-acme.example/Cliente-Acme-Fusao-Secreta.pdf"
    )
    cleanup_secret = "socks5h://cleanup-user:cleanup-pass@residential.example:1080"
    logger = _Logger()

    async def primary_failure(_sem: asyncio.Semaphore, _stop: asyncio.Event) -> None:
        await asyncio.sleep(0)
        raise ConnectionError(primary_secret)

    async def sibling_cleanup_failure(
        _sem: asyncio.Semaphore,
        _stop: asyncio.Event,
    ) -> None:
        try:
            await asyncio.Future()
        finally:
            raise RuntimeError(cleanup_secret)

    async def idle_component(*_args: object) -> None:
        await asyncio.Future()

    async def idle_cancel_subscriber(_stop: asyncio.Event) -> None:
        await asyncio.Future()

    async def close_resource() -> None:
        return None

    monkeypatch.setattr(main, "log", logger)
    monkeypatch.setattr(main, "_subscriber_loop", primary_failure)
    monkeypatch.setattr(main, "_reconciliation_loop", idle_component)
    monkeypatch.setattr(main, "cancel_subscriber", idle_cancel_subscriber)
    monkeypatch.setattr(main, "_automation_subscriber_loop", sibling_cleanup_failure)
    monkeypatch.setattr(main, "_automation_scheduler_loop", idle_component)
    monkeypatch.setattr(main.db, "close_pool", close_resource)
    monkeypatch.setattr(main.events, "close_redis", close_resource)
    monkeypatch.setattr(main.ytdl, "runtime_versions", lambda: {})

    with pytest.raises(SystemExit) as exc_info:
        main.main()

    assert exc_info.value.code == 1
    assert exc_info.value.__suppress_context__ is True
    assert logger.entries == [
        (
            "worker-runtime-failed",
            {
                "error_code": "WORKER_RUNTIME_FAILED",
                "error_type": "Exception",
            },
        )
    ]
    diagnostics = repr(logger.entries)
    assert "cliente-acme" not in diagnostics
    assert "proxy-pass" not in diagnostics
    assert "cleanup-pass" not in diagnostics
    assert "Cliente-Acme-Fusao-Secreta.pdf" not in diagnostics
    assert capsys.readouterr().err == ""
