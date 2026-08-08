from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src import pipeline, safe_diagnostics


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
                "attempt": 1,
                "transcriptId": None,
            }
        ),
    )
    monkeypatch.setattr(pipeline.db, "renew_job_lease", AsyncMock(return_value=True))
    monkeypatch.setattr(pipeline.db, "release_job_lease", AsyncMock(return_value=True))
    monkeypatch.setattr(pipeline.events, "publish_job_event", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline.db, "mark_job_failed", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline, "is_cancelled", lambda _job_id: False)
    monkeypatch.setattr(pipeline, "clear_cancelled", lambda _job_id: None)
    return root_logger


async def test_job_log_context_contains_only_sanitized_source_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_url = (
        "https://user:password@cliente-acme-fusao-secreta.example/documento?token=super-secret"
    )
    root_logger = _install_job_dependencies(monkeypatch, source_url=source_url)
    run = AsyncMock(return_value=None)
    monkeypatch.setattr(pipeline, "_run_pipeline", run)

    await pipeline.process_job("job-1")

    assert root_logger.context == {
        "job_id": "job-1",
        "user_id": "user-1",
        "type": "DOWNLOAD_AND_TRANSCRIBE",
        "source_kind": "UNKNOWN",
    }
    assert source_url not in repr(root_logger.context)
    assert "cliente-acme" not in repr(root_logger.context)
    assert "password" not in repr(root_logger.context)
    assert "super-secret" not in repr(root_logger.context)


async def test_unexpected_job_failure_never_publishes_filename_or_exception_content(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_url = "upload://upload-id/Cliente-Acme-Fusao-Secreta.pdf"
    private_path = "/srv/voxen/private/Cliente-Acme-Fusao-Secreta.pdf"
    root_logger = _install_job_dependencies(monkeypatch, source_url=source_url)
    monkeypatch.setattr(
        pipeline,
        "_run_pipeline",
        AsyncMock(side_effect=PermissionError(13, "Permission denied", private_path)),
    )

    await pipeline.process_job("job-1")

    failure = next(
        entry for entry in root_logger.bound.entries if entry[1] == "job-failed-unexpected"
    )
    assert failure[2] == {
        "error_code": "UNEXPECTED_JOB_FAILURE",
        "error_type": "PermissionError",
    }
    pipeline.db.mark_job_failed.assert_awaited_once_with(
        "job-1",
        pipeline.GENERIC_JOB_FAILURE_MESSAGE,
    )
    pipeline.events.publish_job_event.assert_any_await(
        "user-1",
        "job-1",
        "failed",
        error_msg=pipeline.GENERIC_JOB_FAILURE_MESSAGE,
    )
    diagnostics = repr(
        (
            root_logger.bound.entries,
            pipeline.db.mark_job_failed.await_args_list,
            pipeline.events.publish_job_event.await_args_list,
        )
    )
    assert "Cliente-Acme-Fusao-Secreta.pdf" not in diagnostics
    assert private_path not in diagnostics


def test_error_diagnostic_is_allowlisted_instead_of_redacting_a_denylist() -> None:
    error = RuntimeError(
        "Cliente-Acme-Fusao-Secreta.pdf "
        "socks5h://proxy-user:proxy-pass@127.0.0.1:1080 "
        "Bearer bearer-secret sk-or-v1-openrouter-secret"
    )

    diagnostic = safe_diagnostics.error_diagnostic(error, "UPLOAD_PREVIEW_FAILED")

    assert diagnostic == {
        "error_code": "UPLOAD_PREVIEW_FAILED",
        "error_type": "RuntimeError",
    }
    serialized = repr(diagnostic)
    assert "Cliente-Acme" not in serialized
    assert "proxy-user" not in serialized
    assert "bearer-secret" not in serialized
    assert "openrouter-secret" not in serialized


def test_error_diagnostic_normalizes_values_outside_the_contract() -> None:
    private_error_type = type("ClienteAcmeFusaoSecretaPdf", (Exception,), {})

    diagnostic = safe_diagnostics.error_diagnostic(
        private_error_type("conteúdo sigiloso"),
        "código inválido",
    )

    assert diagnostic == {
        "error_code": "UNEXPECTED_FAILURE",
        "error_type": "Exception",
    }
    assert "ClienteAcme" not in repr(diagnostic)
    assert "conteúdo sigiloso" not in repr(diagnostic)


async def test_arbitrary_permanent_error_is_not_public_without_explicit_opt_in(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    private_content = "Contrato sigiloso Cliente-Acme"
    root_logger = _install_job_dependencies(
        monkeypatch,
        source_url="https://www.youtube.com/watch?v=abc",
    )
    monkeypatch.setattr(
        pipeline,
        "_run_pipeline",
        AsyncMock(side_effect=pipeline.PermanentError(private_content)),
    )

    await pipeline.process_job("job-1")

    pipeline.db.mark_job_failed.assert_awaited_once_with(
        "job-1",
        pipeline.GENERIC_JOB_FAILURE_MESSAGE,
    )
    warning = next(
        entry for entry in root_logger.bound.entries if entry[1] == "job-failed-permanent"
    )
    assert warning[2] == {
        "error_code": "PERMANENT_FAILURE",
        "error_type": "PermanentError",
    }
    assert private_content not in repr(root_logger.bound.entries)
    assert private_content not in repr(pipeline.events.publish_job_event.await_args_list)


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


async def test_x_analysis_cost_metadata_does_not_include_source_hostname_or_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_url = "https://x.com/cliente_acme/status/123456789?token=segredo"
    logger = _BoundLogger()
    monkeypatch.setattr(
        pipeline.voxen_settings,
        "get_openrouter_model_config",
        AsyncMock(
            return_value=pipeline.voxen_settings.OpenRouterModelConfig(
                api_key="sk-test",
                model="x-ai/grok-4.5",
                fallback_model="x-ai/grok-4.1-fast",
            )
        ),
    )
    monkeypatch.setattr(
        pipeline,
        "analyze_x_url",
        AsyncMock(
            return_value=SimpleNamespace(
                text="Conteúdo público analisado.",
                cost_usd=Decimal("0.002"),
                model="x-ai/grok-4.1-fast",
                tokens_in=20,
                tokens_out=8,
            )
        ),
    )
    monkeypatch.setattr(pipeline, "is_cancelled", lambda _job_id: False)
    monkeypatch.setattr(pipeline.events, "publish_job_event", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline.db, "insert_cost_event", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline, "_maybe_generate_title", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline, "_persist", AsyncMock(return_value="transcript-1"))
    monkeypatch.setattr(pipeline.db, "link_job_transcript", AsyncMock(return_value=None))
    monkeypatch.setattr(
        pipeline,
        "_enrich_persisted_transcript",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(pipeline.db, "mark_job_done", AsyncMock(return_value=None))

    await pipeline._run_x_analysis_pipeline(
        job_id="job-1",
        user_id="user-1",
        source_url=source_url,
        log=logger,
    )

    cost_meta = pipeline.db.insert_cost_event.await_args.kwargs["meta"]
    assert cost_meta == {"source": "x_analysis"}
    assert pipeline._persist.await_args.kwargs["model"] == "x-ai/grok-4.1-fast"
    telemetry = repr((cost_meta, logger.entries))
    assert "x.com" not in telemetry
    assert "cliente_acme" not in telemetry
    assert "token=segredo" not in telemetry
