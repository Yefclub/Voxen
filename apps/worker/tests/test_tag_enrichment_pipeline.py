from __future__ import annotations

from decimal import Decimal
from unittest.mock import AsyncMock

import pytest

from src import pipeline, tags


class _Logger:
    def info(self, *_args: object, **_kwargs: object) -> None:
        pass

    def warning(self, *_args: object, **_kwargs: object) -> None:
        pass


def _install_common(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        pipeline.db,
        "get_transcript_title_summary_folder",
        AsyncMock(return_value=("Título", "Conteúdo suficientemente longo para gerar tags.", None)),
    )
    monkeypatch.setattr(
        pipeline.voxen_settings,
        "get_openrouter_api_key",
        AsyncMock(return_value="sk"),
    )
    monkeypatch.setattr(
        pipeline.voxen_settings,
        "get_default_chat_model",
        AsyncMock(return_value="x-ai/grok-4.5"),
    )
    monkeypatch.setattr(
        pipeline.voxen_settings,
        "get_app_language",
        AsyncMock(return_value="pt-BR"),
    )
    monkeypatch.setattr(pipeline.db, "list_tag_names", AsyncMock(return_value=[]))
    monkeypatch.setattr(pipeline.db, "insert_cost_event", AsyncMock(return_value=None))


async def test_existing_tags_complete_without_calling_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_common(monkeypatch)
    monkeypatch.setattr(
        pipeline.db,
        "list_transcript_tag_names",
        AsyncMock(return_value=["existente"]),
    )
    generate = AsyncMock()
    finish = AsyncMock()
    monkeypatch.setattr(pipeline.tags, "generate_content_tags", generate)
    monkeypatch.setattr(pipeline.db, "finish_tag_enrichment", finish)

    await pipeline._maybe_generate_tags(
        user_id="user-1",
        job_id=None,
        transcript_id="transcript-1",
        log=_Logger(),
        already_claimed=True,
    )

    generate.assert_not_awaited()
    finish.assert_awaited_once_with(
        "user-1",
        "transcript-1",
        status="COMPLETE",
        error=None,
    )


async def test_empty_model_tags_transition_to_retry_without_persisting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_common(monkeypatch)
    monkeypatch.setattr(pipeline.db, "list_transcript_tag_names", AsyncMock(return_value=[]))
    monkeypatch.setattr(
        pipeline.tags,
        "generate_content_tags",
        AsyncMock(
            return_value=tags.TagsGenerationResult(
                tags=[],
                cost_usd=Decimal("0.001"),
                model="x-ai/grok-4.5",
                tokens_in=10,
                tokens_out=2,
            )
        ),
    )
    apply_tags = AsyncMock()
    finish = AsyncMock()
    monkeypatch.setattr(pipeline.db, "apply_tags_to_transcript", apply_tags)
    monkeypatch.setattr(pipeline.db, "finish_tag_enrichment", finish)

    await pipeline._maybe_generate_tags(
        user_id="user-1",
        job_id="job-1",
        transcript_id="transcript-1",
        log=_Logger(),
        already_claimed=True,
    )

    apply_tags.assert_not_awaited()
    finish.assert_awaited_once_with(
        "user-1",
        "transcript-1",
        status="RETRY",
        error="O modelo não retornou tags válidas.",
    )
