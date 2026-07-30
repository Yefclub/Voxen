from __future__ import annotations

from collections.abc import Coroutine
from typing import Any

import pytest

from src import main


class _Logger:
    def __init__(self) -> None:
        self.entries: list[tuple[str, dict[str, object]]] = []

    def error(self, event: str, **kwargs: object) -> None:
        self.entries.append((event, kwargs))


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
