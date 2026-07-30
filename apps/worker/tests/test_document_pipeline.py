from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from src import document_ingest, pipeline
from src.openrouter import (
    DocumentAnalysisResult,
    OpenrouterAuthError,
    OpenrouterTransientError,
    VisionAnalysisResult,
)

UPLOAD_ID = "00000000-0000-0000-0000-000000000001"


class _Logger:
    def info(self, *_args: object, **_kwargs: object) -> None:
        pass

    def warning(self, *_args: object, **_kwargs: object) -> None:
        pass


def _document_result(text: str = "Resumo do documento") -> DocumentAnalysisResult:
    return DocumentAnalysisResult(
        text=text,
        cost_usd=Decimal("0.001"),
        model="x-ai/grok-4.5",
        tokens_in=10,
        tokens_out=5,
    )


def _install_pipeline_completion_mocks(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pipeline.db, "insert_cost_event", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline, "_maybe_generate_title", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline, "_persist", AsyncMock(return_value="transcript-1"))
    monkeypatch.setattr(
        pipeline,
        "_generate_summary_with_progress",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(pipeline.db, "link_job_transcript", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline.db, "mark_job_done", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline.events, "publish_job_event", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline.storage, "download_to_file", AsyncMock(return_value=None))


async def test_pdf_uses_mistral_ocr_without_markitdown(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    pdf_path = tmp_path / "documento.pdf"
    pdf_path.write_bytes(b"%PDF-1.7 fake")
    analyzed = _document_result()
    native = AsyncMock(return_value=analyzed)
    convert = AsyncMock()
    analyze_text = AsyncMock()
    publish = AsyncMock(return_value=None)

    monkeypatch.setattr(pipeline, "analyze_pdf_native", native)
    monkeypatch.setattr(pipeline.document_ingest, "convert_to_markdown", convert)
    monkeypatch.setattr(pipeline, "analyze_document_text", analyze_text)
    monkeypatch.setattr(pipeline.events, "publish_job_event", publish)

    result, parser = await pipeline._analyze_document_file(
        document_path=pdf_path,
        filename="documento.pdf",
        api_key="sk-test",
        model="x-ai/grok-4.5",
        user_id="user-1",
        job_id="job-1",
    )

    assert result == analyzed
    assert parser == "openrouter-mistral-ocr"
    native.assert_awaited_once_with(
        pdf_path=pdf_path,
        api_key="sk-test",
        model="x-ai/grok-4.5",
    )
    convert.assert_not_awaited()
    analyze_text.assert_not_awaited()
    publish.assert_awaited_once_with("user-1", "job-1", "analyzing_document", percent=30)


async def test_pdf_transient_failure_never_falls_back_to_markitdown(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    pdf_path = tmp_path / "documento.pdf"
    pdf_path.write_bytes(b"%PDF-1.7 fake")
    native = AsyncMock(side_effect=OpenrouterTransientError("OpenRouter 503"))
    convert = AsyncMock()
    analyze_text = AsyncMock()

    monkeypatch.setattr(pipeline, "analyze_pdf_native", native)
    monkeypatch.setattr(pipeline.document_ingest, "convert_to_markdown", convert)
    monkeypatch.setattr(pipeline, "analyze_document_text", analyze_text)
    monkeypatch.setattr(pipeline.events, "publish_job_event", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline.asyncio, "sleep", AsyncMock(return_value=None))

    with pytest.raises(OpenrouterTransientError, match="503"):
        await pipeline._analyze_document_file(
            document_path=pdf_path,
            filename="documento.pdf",
            api_key="sk-test",
            model="x-ai/grok-4.5",
            user_id="user-1",
            job_id="job-1",
        )

    assert native.await_count == 2
    convert.assert_not_awaited()
    analyze_text.assert_not_awaited()


async def test_pdf_auth_failure_never_falls_back(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    pdf_path = tmp_path / "documento.pdf"
    pdf_path.write_bytes(b"%PDF-1.7 fake")
    monkeypatch.setattr(
        pipeline,
        "analyze_pdf_native",
        AsyncMock(side_effect=OpenrouterAuthError("HTTP 401")),
    )
    convert = AsyncMock()
    monkeypatch.setattr(pipeline.document_ingest, "convert_to_markdown", convert)
    monkeypatch.setattr(pipeline.events, "publish_job_event", AsyncMock(return_value=None))

    with pytest.raises(pipeline.PermanentError, match="Chave da OpenRouter rejeitada"):
        await pipeline._analyze_document_file(
            document_path=pdf_path,
            filename="documento.pdf",
            api_key="sk-test",
            model="x-ai/grok-4.5",
            user_id="user-1",
            job_id="job-1",
        )

    convert.assert_not_awaited()


async def test_non_pdf_pipeline_converts_with_markitdown_then_uses_openrouter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_pipeline_completion_mocks(monkeypatch)
    source_url = f"upload://{UPLOAD_ID}/manual.docx"
    extracted = document_ingest.DocumentMarkdown(markdown="# Conteúdo extraído", truncated=False)
    result = _document_result()
    convert = AsyncMock(return_value=extracted)
    analyze_text = AsyncMock(return_value=result)
    analyze_pdf = AsyncMock()

    monkeypatch.setattr(
        pipeline.voxen_settings,
        "get_openrouter_model_config",
        AsyncMock(
            return_value=pipeline.voxen_settings.OpenRouterModelConfig(
                api_key="sk-test",
                model="x-ai/grok-4.5",
            )
        ),
    )
    monkeypatch.setattr(pipeline.document_ingest, "is_pdf", lambda _path: False)
    monkeypatch.setattr(pipeline.document_ingest, "convert_to_markdown", convert)
    monkeypatch.setattr(pipeline, "analyze_document_text", analyze_text)
    monkeypatch.setattr(pipeline, "analyze_pdf_native", analyze_pdf)

    await pipeline._run_document_pipeline(
        job_id="job-1",
        user_id="user-1",
        source_url=source_url,
        log=_Logger(),
    )

    pipeline.voxen_settings.get_openrouter_model_config.assert_awaited_once_with(
        ("default_document_model",)
    )
    convert.assert_awaited_once()
    analyze_text.assert_awaited_once_with(
        markdown="# Conteúdo extraído",
        filename="manual.docx",
        api_key="sk-test",
        model="x-ai/grok-4.5",
    )
    analyze_pdf.assert_not_awaited()
    cost_call = pipeline.db.insert_cost_event.await_args.kwargs
    assert cost_call["meta"]["parser"] == "markitdown"
    persist_call = pipeline._persist.await_args.kwargs
    assert persist_call["method"] == "DOCUMENT"
    assert persist_call["source_override"] == "UPLOAD"
    publish_calls = [
        (call.args[2], call.kwargs.get("percent"))
        for call in pipeline.events.publish_job_event.await_args_list
        if len(call.args) >= 3
    ]
    assert publish_calls[:3] == [
        ("preparing_upload", 5),
        ("converting_document", 20),
        ("analyzing_document", 30),
    ]


async def test_image_pipeline_uses_openrouter_vision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_pipeline_completion_mocks(monkeypatch)
    source_url = f"upload://{UPLOAD_ID}/captura.png"
    result = VisionAnalysisResult(
        text="Uma interface com dados relevantes.",
        cost_usd=Decimal("0.002"),
        model="x-ai/grok-4.5",
        tokens_in=20,
        tokens_out=8,
    )
    analyze = AsyncMock(return_value=result)

    monkeypatch.setattr(
        pipeline.voxen_settings,
        "get_openrouter_model_config",
        AsyncMock(
            return_value=pipeline.voxen_settings.OpenRouterModelConfig(
                api_key="sk-test",
                model="x-ai/grok-4.5",
            )
        ),
    )
    monkeypatch.setattr(pipeline, "analyze_image", analyze)

    await pipeline._run_image_pipeline(
        job_id="job-1",
        user_id="user-1",
        source_url=source_url,
        log=_Logger(),
    )

    pipeline.voxen_settings.get_openrouter_model_config.assert_awaited_once_with(
        ("default_vision_model",)
    )
    assert analyze.await_count == 1
    analyze_call = analyze.await_args.kwargs
    assert analyze_call["image_path"].name == "captura.png"
    assert analyze_call["api_key"] == "sk-test"
    assert analyze_call["model"] == "x-ai/grok-4.5"
    assert "Analise esta imagem" in analyze_call["prompt"]
    cost_call = pipeline.db.insert_cost_event.await_args.kwargs
    assert cost_call["meta"]["source"] == "image_upload"
    persist_call = pipeline._persist.await_args.kwargs
    assert persist_call["method"] == "VISION"
    assert persist_call["source_override"] == "UPLOAD"
