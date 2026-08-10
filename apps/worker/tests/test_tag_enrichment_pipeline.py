from __future__ import annotations

from decimal import Decimal
from unittest.mock import AsyncMock

import pytest

from src import pipeline, tags

TAG_CLAIM = {"claim_attempt": 1, "correction_revision": 0}


class _Logger:
    def __init__(self) -> None:
        self.entries: list[tuple[str, str, dict[str, object]]] = []

    def info(self, *_args: object, **_kwargs: object) -> None:
        event = str(_args[0]) if _args else ""
        self.entries.append(("info", event, dict(_kwargs)))

    def warning(self, *_args: object, **_kwargs: object) -> None:
        event = str(_args[0]) if _args else ""
        self.entries.append(("warning", event, dict(_kwargs)))


def _install_common(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        pipeline.db,
        "get_transcript_title_summary_folder",
        AsyncMock(
            return_value=("Título", "Conteúdo suficientemente longo para gerar tags.", None, 0)
        ),
    )
    monkeypatch.setattr(
        pipeline.voxen_settings,
        "get_openrouter_model_config",
        AsyncMock(
            return_value=pipeline.voxen_settings.OpenRouterModelConfig(
                api_key="sk",
                model="x-ai/grok-4.5",
            )
        ),
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
        **TAG_CLAIM,
    )

    generate.assert_not_awaited()
    finish.assert_awaited_once_with(
        "user-1",
        "transcript-1",
        status="COMPLETE",
        error=None,
        **TAG_CLAIM,
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
        **TAG_CLAIM,
    )

    apply_tags.assert_not_awaited()
    finish.assert_awaited_once_with(
        "user-1",
        "transcript-1",
        status="RETRY",
        error="O modelo não retornou tags válidas.",
        **TAG_CLAIM,
    )


async def test_inline_generation_returns_when_atomic_claim_is_not_acquired(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_common(monkeypatch)
    claim = AsyncMock(return_value=None)
    monkeypatch.setattr(pipeline.db, "start_tag_enrichment", claim)
    logger = _Logger()

    await pipeline._maybe_generate_tags(
        user_id="user-1",
        job_id="job-1",
        transcript_id="transcript-1",
        log=logger,
    )

    claim.assert_awaited_once_with("user-1", "transcript-1")
    pipeline.db.get_transcript_title_summary_folder.assert_not_awaited()
    assert logger.entries == [
        (
            "info",
            "tags-skipped-not-claimed",
            {"transcript_id": "transcript-1"},
        )
    ]


async def test_inline_generation_returns_when_atomic_claim_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_common(monkeypatch)
    claim = AsyncMock(side_effect=RuntimeError("DB indisponível"))
    monkeypatch.setattr(pipeline.db, "start_tag_enrichment", claim)
    logger = _Logger()

    await pipeline._maybe_generate_tags(
        user_id="user-1",
        job_id="job-1",
        transcript_id="transcript-1",
        log=logger,
    )

    pipeline.db.get_transcript_title_summary_folder.assert_not_awaited()
    assert logger.entries[0][1] == "tags-status-start-failed"


async def test_tag_names_are_not_written_to_logs_or_cost_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_common(monkeypatch)
    monkeypatch.setattr(pipeline.db, "list_transcript_tag_names", AsyncMock(return_value=[]))
    monkeypatch.setattr(
        pipeline.tags,
        "generate_content_tags",
        AsyncMock(
            return_value=tags.TagsGenerationResult(
                tags=["Projeto secreto", "Cliente reservado"],
                cost_usd=Decimal("0.001"),
                model="x-ai/grok-4.5",
                tokens_in=10,
                tokens_out=2,
            )
        ),
    )
    monkeypatch.setattr(
        pipeline.db,
        "apply_tags_to_transcript",
        AsyncMock(return_value=["Projeto secreto", "Cliente reservado"]),
    )
    monkeypatch.setattr(pipeline.db, "finish_tag_enrichment", AsyncMock(return_value=None))
    logger = _Logger()

    await pipeline._maybe_generate_tags(
        user_id="user-1",
        job_id="job-1",
        transcript_id="transcript-1",
        log=logger,
        already_claimed=True,
        **TAG_CLAIM,
    )

    cost_meta = pipeline.db.insert_cost_event.await_args.kwargs["meta"]
    assert cost_meta == {"source": "tag_generation_auto", "tag_count": 2}
    assigned_log = next(entry for entry in logger.entries if entry[1] == "tags-assigned")
    assert assigned_log[2] == {"transcript_id": "transcript-1", "count": 2}
    assert "Projeto secreto" not in repr(logger.entries)
    assert "Cliente reservado" not in repr(logger.entries)
