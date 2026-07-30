from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace
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


def test_safe_error_redacts_urls_proxy_credentials_bearer_and_api_keys() -> None:
    error = RuntimeError(
        "Falha em https://user:web-pass@example.com/path?token=query-secret#fragment-secret "
        "via socks5h://proxy-user:proxy-pass@127.0.0.1:1080; "
        "Authorization: Bearer bearer-secret; api_key=api-secret; "
        "api-key='quoted-secret'; headers Authorization: 'Bearer header-secret'; "
        "key solta sk-or-v1-openrouter-secret e sk-liveapikey123"
    )

    safe = pipeline._safe_error_for_log(error, max_length=1_000)

    assert safe.count("[url-redacted]") == 2
    assert "Falha em" in safe
    for secret in (
        "web-pass",
        "query-secret",
        "fragment-secret",
        "proxy-user",
        "proxy-pass",
        "bearer-secret",
        "api-secret",
        "quoted-secret",
        "header-secret",
        "openrouter-secret",
        "liveapikey123",
    ):
        assert secret not in safe


async def test_folder_metrics_and_logs_do_not_include_personal_labels(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    personal_folder = "Cliente Reservado 2026"
    personal_folder_id = "folder-personal-secret"
    logger = _BoundLogger()
    monkeypatch.setattr(
        pipeline.voxen_settings,
        "get_openrouter_model_config",
        AsyncMock(
            return_value=pipeline.voxen_settings.OpenRouterModelConfig(
                api_key="sk-test",
                model="openai/gpt-4.1-mini",
            )
        ),
    )
    monkeypatch.setattr(
        pipeline.voxen_settings,
        "get_app_language",
        AsyncMock(return_value="pt-BR"),
    )
    monkeypatch.setattr(
        pipeline.db,
        "list_library_folder_names",
        AsyncMock(return_value=[personal_folder]),
    )
    monkeypatch.setattr(
        pipeline,
        "classify_content_folder",
        AsyncMock(
            return_value=SimpleNamespace(
                folder_name=personal_folder,
                cost_usd=Decimal("0.001"),
                model="openai/gpt-4.1-mini",
                tokens_in=12,
                tokens_out=3,
            )
        ),
    )
    monkeypatch.setattr(pipeline.db, "insert_cost_event", AsyncMock(return_value=None))
    monkeypatch.setattr(
        pipeline.db,
        "ensure_library_folder",
        AsyncMock(return_value=personal_folder_id),
    )
    monkeypatch.setattr(pipeline.db, "set_transcript_folder", AsyncMock(return_value=None))

    await pipeline._maybe_assign_folder(
        user_id="user-1",
        job_id="job-1",
        transcript_id="transcript-1",
        title="Documento interno",
        content="Conteúdo pessoal suficiente para executar a classificação.",
        fallback_model=None,
        log=logger,
    )

    cost_meta = pipeline.db.insert_cost_event.await_args.kwargs["meta"]
    assert cost_meta == {"source": "folder_classification"}
    assigned_log = next(entry for entry in logger.entries if entry[1] == "folder-assigned")
    assert assigned_log[2] == {"transcript_id": "transcript-1"}
    telemetry = repr((cost_meta, logger.entries))
    assert personal_folder not in telemetry
    assert personal_folder_id not in telemetry
