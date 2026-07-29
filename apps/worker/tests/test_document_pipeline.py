from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from src import document_ingest, pipeline
from src.openrouter import DocumentAnalysisResult, OpenrouterAuthError, OpenrouterTransientError


class _Logger:
    def warning(self, *_args: object, **_kwargs: object) -> None:
        pass


async def test_pdf_transient_failure_falls_back_to_markitdown(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    pdf_path = tmp_path / "documento.pdf"
    pdf_path.write_bytes(b"%PDF-1.7 fake")
    native = AsyncMock(side_effect=OpenrouterTransientError("OpenRouter 503"))
    convert = AsyncMock(
        return_value=document_ingest.DocumentMarkdown(markdown="# Extraído", truncated=False)
    )
    analyzed = DocumentAnalysisResult(
        text="Resumo recuperado",
        cost_usd=Decimal("0.001"),
        model="x-ai/grok-4.5",
        tokens_in=10,
        tokens_out=5,
    )
    analyze_text = AsyncMock(return_value=analyzed)
    publish = AsyncMock(return_value=None)

    monkeypatch.setattr(pipeline, "analyze_pdf_native", native)
    monkeypatch.setattr(pipeline.document_ingest, "convert_to_markdown", convert)
    monkeypatch.setattr(pipeline, "analyze_document_text", analyze_text)
    monkeypatch.setattr(pipeline.events, "publish_job_event", publish)
    monkeypatch.setattr(pipeline.asyncio, "sleep", AsyncMock(return_value=None))

    result, parser = await pipeline._analyze_pdf_with_fallback(
        pdf_path=pdf_path,
        filename="documento.pdf",
        api_key="sk-test",
        model="x-ai/grok-4.5",
        user_id="user-1",
        job_id="job-1",
        log=_Logger(),
    )

    assert result == analyzed
    assert parser == "markitdown"
    assert native.await_count == 2
    convert.assert_awaited_once_with(pdf_path)
    analyze_text.assert_awaited_once()
    publish.assert_awaited_once_with("user-1", "job-1", "converting_document", percent=25)


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

    with pytest.raises(pipeline.PermanentError, match="Chave da OpenRouter rejeitada"):
        await pipeline._analyze_pdf_with_fallback(
            pdf_path=pdf_path,
            filename="documento.pdf",
            api_key="sk-test",
            model="x-ai/grok-4.5",
            user_id="user-1",
            job_id="job-1",
            log=_Logger(),
        )

    convert.assert_not_awaited()
