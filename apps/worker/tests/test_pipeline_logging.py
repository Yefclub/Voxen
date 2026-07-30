from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from src import pipeline


class _BoundLogger:
    def __init__(self) -> None:
        self.entries: list[tuple[str, str, dict[str, object]]] = []

    def info(self, event: str, **kwargs: object) -> None:
        self.entries.append(("info", event, kwargs))

    def warning(self, event: str, **kwargs: object) -> None:
        self.entries.append(("warning", event, kwargs))

    def error(self, event: str, **kwargs: object) -> None:
        self.entries.append(("error", event, kwargs))


class _RootLogger:
    def __init__(self) -> None:
        self.context: dict[str, object] | None = None
        self.bound = _BoundLogger()

    def bind(self, **kwargs: object) -> _BoundLogger:
        self.context = kwargs
        return self.bound

    def info(self, _event: str, **_kwargs: object) -> None:
        pass


def _install_job_dependencies(
    monkeypatch: pytest.MonkeyPatch,
    *,
    source_url: str,
) -> _RootLogger:
    root_logger = _RootLogger()
    monkeypatch.setattr(pipeline, "logger", root_logger)
    monkeypatch.setattr(
        pipeline.db,
        "claim_job",
        AsyncMock(
            return_value={
                "userId": "user-1",
                "sourceUrl": source_url,
                "type": "DOWNLOAD_AND_TRANSCRIBE",
            }
        ),
    )
    monkeypatch.setattr(pipeline.events, "publish_job_event", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline.db, "mark_job_failed", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline, "is_cancelled", lambda _job_id: False)
    monkeypatch.setattr(pipeline, "clear_cancelled", lambda _job_id: None)
    return root_logger


async def test_job_log_context_contains_only_sanitized_source_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_url = "https://user:password@www.youtube.com/watch?v=abc&token=super-secret"
    root_logger = _install_job_dependencies(monkeypatch, source_url=source_url)
    run = AsyncMock(return_value=None)
    monkeypatch.setattr(pipeline, "_run_pipeline", run)

    await pipeline.process_job("job-1")

    assert root_logger.context == {
        "job_id": "job-1",
        "user_id": "user-1",
        "type": "DOWNLOAD_AND_TRANSCRIBE",
        "source_kind": "YOUTUBE",
        "source_host": "www.youtube.com",
    }
    assert source_url not in repr(root_logger.context)
    assert "password" not in repr(root_logger.context)
    assert "super-secret" not in repr(root_logger.context)


async def test_job_failure_log_redacts_urls_from_external_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_url = "https://www.youtube.com/watch?v=abc&token=super-secret"
    root_logger = _install_job_dependencies(monkeypatch, source_url=source_url)
    monkeypatch.setattr(
        pipeline,
        "_run_pipeline",
        AsyncMock(side_effect=pipeline.PermanentError(f"Falha ao baixar {source_url}")),
    )

    await pipeline.process_job("job-1")

    warning = next(
        entry for entry in root_logger.bound.entries if entry[1] == "job-failed-permanent"
    )
    assert warning[2]["error"] == "Falha ao baixar [url-redacted]"
    assert source_url not in repr(root_logger.bound.entries)
    assert "super-secret" not in repr(root_logger.bound.entries)
    pipeline.db.mark_job_failed.assert_awaited_once_with(
        "job-1",
        "Falha ao baixar [url-redacted]",
    )
    pipeline.events.publish_job_event.assert_any_await(
        "user-1",
        "job-1",
        "failed",
        error_msg="Falha ao baixar [url-redacted]",
    )
    assert "super-secret" not in repr(pipeline.events.publish_job_event.await_args_list)
