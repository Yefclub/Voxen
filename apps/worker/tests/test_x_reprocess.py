from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from src import thumbnail, x_pipeline
from src.pipeline_errors import PermanentError
from src.transcript_md import Segment, TranscriptDoc, render_plain_text
from src.x_post import XPost, XPostMedia

SOURCE_URL = "https://x.com/i/status/123456789"
TRANSCRIPT_ID = "t1"


class _Logger:
    def info(self, *_args: object, **_kwargs: object) -> None:
        pass

    def warning(self, *_args: object, **_kwargs: object) -> None:
        pass


def _probe() -> Any:
    from src import ytdl

    return ytdl.VideoProbe(
        video_id="123456789",
        title="Product design cheat sheet",
        channel="@_heyrico",
        duration_sec=0,
        published_at=datetime(2026, 9, 21, 14, 59, 3, tzinfo=UTC),
        thumbnail_url="https://pbs.twimg.com/media/x.jpg",
        language_hint=None,
        available_subtitles={},
        automatic_captions={},
        author="rico",
        canonical_url=SOURCE_URL,
    )


def _capture() -> XPost:
    return XPost(
        status_id="123456789",
        text="Product design cheat sheet.",
        author_name="rico",
        author_handle="_heyrico",
        created_at=datetime(2026, 9, 21, 14, 59, 3, tzinfo=UTC),
        lang="en",
        like_count=10,
        reply_count=2,
        media=(XPostMedia(kind="photo", url="https://pbs.twimg.com/media/x.jpg"),),
    )


def _fake_connection(current: dict[str, Any]) -> MagicMock:
    conn = MagicMock()
    conn.fetchrow = AsyncMock(return_value=current)
    conn.execute = AsyncMock(return_value=None)
    tx = MagicMock()
    tx.__aenter__ = AsyncMock(return_value=None)
    tx.__aexit__ = AsyncMock(return_value=False)
    conn.transaction = MagicMock(return_value=tx)
    return conn


def _install_connection(monkeypatch: pytest.MonkeyPatch, current: dict[str, Any]) -> MagicMock:
    conn = _fake_connection(current)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(x_pipeline.db, "connection", lambda: ctx)
    monkeypatch.setattr(x_pipeline.db, "generate_cuid", lambda: "version-row")
    monkeypatch.setattr(x_pipeline.storage, "put_markdown", AsyncMock(return_value=None))
    monkeypatch.setattr(
        thumbnail,
        "resolve_thumbnail_for_persist",
        AsyncMock(return_value=("/api/transcripts/t1/preview", "preview-key", "image/jpeg")),
    )
    monkeypatch.setattr(x_pipeline, "mark_reviewable_derivatives_stale", AsyncMock())
    brain_upsert = AsyncMock(return_value=True)
    monkeypatch.setattr(x_pipeline.db, "upsert_transcript_brain_node", brain_upsert)
    return conn


def _current_row(**overrides: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": TRANSCRIPT_ID,
        "status": "ACTIVE",
        "source": "X",
        "title": "Título antigo",
        "plainText": "Conteúdo antigo.",
        "mdPath": "workspaces/user1/transcripts/t1/sources/v1.md",
        "sourceChecksum": None,
        "sourceVersion": 1,
        "sourceMetadata": {"canonicalUrl": SOURCE_URL},
        "previewObjectKey": None,
        "previewMimeType": None,
        "thumbnailUrl": None,
    }
    row.update(overrides)
    return row


async def _persist(monkeypatch: pytest.MonkeyPatch, *, content: str) -> bool:
    return await x_pipeline._persist_refresh(
        user_id="user1",
        job_id="job1",
        transcript_id=TRANSCRIPT_ID,
        source_url=SOURCE_URL,
        content=content,
        probe_info=_probe(),
        title="Novo título",
        model="x-ai/grok-4.5",
        cost_usd=Decimal("0.01"),
        language="pt",
        log=_Logger(),
    )


async def test_unchanged_reprocess_skips_storage_and_versions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn = _install_connection(
        monkeypatch,
        _current_row(sourceChecksum=x_pipeline._content_checksum("Conteúdo antigo.")),
    )

    changed = await _persist(monkeypatch, content="Conteúdo antigo.")

    assert changed is False
    x_pipeline.storage.put_markdown.assert_not_awaited()  # type: ignore[attr-defined]
    x_pipeline.mark_reviewable_derivatives_stale.assert_not_awaited()  # type: ignore[attr-defined]
    statements = "\n".join(str(call.args[0]) for call in conn.execute.await_args_list)
    assert 'INSERT INTO "SourceContentVersion"' in statements
    assert 'UPDATE "Transcript"' in statements
    assert '"summaryMd" = NULL' not in statements
    assert "pg_advisory_lock" in statements
    assert "pg_advisory_unlock" in statements


async def test_changed_reprocess_versions_and_invalidates_derivatives(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn = _install_connection(monkeypatch, _current_row())

    changed = await _persist(monkeypatch, content="Conteúdo novo.")

    assert changed is True
    x_pipeline.storage.put_markdown.assert_awaited_once()  # type: ignore[attr-defined]
    x_pipeline.mark_reviewable_derivatives_stale.assert_awaited_once()  # type: ignore[attr-defined]
    x_pipeline.db.upsert_transcript_brain_node.assert_awaited_once()  # type: ignore[attr-defined]
    statements = "\n".join(str(call.args[0]) for call in conn.execute.await_args_list)
    assert 'INSERT INTO "SourceContentVersion"' in statements
    assert '"summaryMd" = NULL' in statements
    assert '"sourceVersion" = $17' in statements
    assert '"correctionState" = CASE' in statements
    assert 'DELETE FROM "TranscriptTag"' in statements
    assert "pg_advisory_unlock" in statements


async def test_reprocess_refuses_foreign_or_trashed_transcript(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_connection(monkeypatch, _current_row(status="TRASH"))

    with pytest.raises(PermanentError) as excinfo:
        await _persist(monkeypatch, content="Conteúdo novo.")

    assert excinfo.value.code == "SOURCE_REFRESH_MISSING"


async def test_reprocess_refuses_missing_transcript(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conn = _fake_connection(_current_row())
    conn.fetchrow = AsyncMock(return_value=None)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(x_pipeline.db, "connection", lambda: ctx)

    with pytest.raises(PermanentError) as excinfo:
        await _persist(monkeypatch, content="Conteúdo novo.")

    assert excinfo.value.code == "SOURCE_REFRESH_MISSING"


def test_content_checksum_ignores_whitespace_noise() -> None:
    assert x_pipeline._content_checksum("a  b\n\nc") == x_pipeline._content_checksum("a b c")
    assert x_pipeline._content_checksum("a b") != x_pipeline._content_checksum("a c")


def test_reprocess_render_keeps_x_markdown_contract() -> None:
    doc = TranscriptDoc(
        transcript_id=TRANSCRIPT_ID,
        user_id="user1",
        source="X",
        url=SOURCE_URL,
        video_id="123456789",
        title="Novo título",
        channel="@_heyrico",
        author="rico",
        duration_sec=0,
        published_at=_probe().published_at,
        thumbnail_url="/api/transcripts/t1/preview",
        language="pt",
        transcription_method="X_SEARCH",
        model="x-ai/grok-4.5",
        cost_usd=Decimal("0.01"),
        segments=(Segment(start_sec=0.0, text="Conteúdo novo."),),
        transcribed_at=datetime(2026, 9, 22, tzinfo=UTC),
    )
    from src.transcript_md import render_markdown

    markdown = render_markdown(doc)
    assert "## Análise do X" in markdown
    assert "Conteúdo novo." in markdown
    assert render_plain_text(doc) == "Conteúdo novo."


async def test_run_reprocess_unchanged_skips_enrichment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src import pipeline

    monkeypatch.setattr(
        x_pipeline.voxen_settings,
        "get_openrouter_model_config",
        AsyncMock(
            return_value=x_pipeline.voxen_settings.OpenRouterModelConfig(
                api_key="sk-test", model="x-ai/grok-4.5", fallback_model=None
            )
        ),
    )
    monkeypatch.setattr(x_pipeline.x_post, "fetch_x_post", AsyncMock(return_value=_capture()))
    monkeypatch.setattr(
        x_pipeline,
        "analyze_x_url",
        AsyncMock(
            return_value=type(
                "Result",
                (),
                {
                    "text": "## Análise nova",
                    "accessible": True,
                    "verdict_missing": False,
                    "model": "x-ai/grok-4.5",
                    "cost_usd": Decimal("0.01"),
                    "tokens_in": 1,
                    "tokens_out": 1,
                },
            )()
        ),
    )
    monkeypatch.setattr(x_pipeline, "_maybe_generate_title", AsyncMock(return_value=None))
    monkeypatch.setattr(x_pipeline, "_persist_refresh", AsyncMock(return_value=False))
    complete = AsyncMock(return_value=[])
    monkeypatch.setattr(x_pipeline, "_complete_persisted_job", complete)
    monkeypatch.setattr(pipeline, "is_cancelled", lambda _job_id: False)
    monkeypatch.setattr(pipeline.events, "publish_job_event", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline.db, "insert_cost_event", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline.db, "mark_job_done", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline.db, "link_job_transcript", AsyncMock(return_value=None))

    await x_pipeline.run(
        job_id="job1",
        user_id="user1",
        source_url=SOURCE_URL,
        refresh_transcript_id=TRANSCRIPT_ID,
        log=_Logger(),
    )

    complete.assert_not_awaited()
    pipeline.db.link_job_transcript.assert_not_awaited()  # type: ignore[attr-defined]
    pipeline.db.mark_job_done.assert_awaited_once_with("job1")  # type: ignore[attr-defined]


async def test_run_reprocess_changed_runs_enrichment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src import pipeline

    monkeypatch.setattr(
        x_pipeline.voxen_settings,
        "get_openrouter_model_config",
        AsyncMock(
            return_value=x_pipeline.voxen_settings.OpenRouterModelConfig(
                api_key="sk-test", model="x-ai/grok-4.5", fallback_model=None
            )
        ),
    )
    monkeypatch.setattr(x_pipeline.x_post, "fetch_x_post", AsyncMock(return_value=_capture()))
    monkeypatch.setattr(
        x_pipeline,
        "analyze_x_url",
        AsyncMock(
            return_value=type(
                "Result",
                (),
                {
                    "text": "## Análise nova",
                    "accessible": True,
                    "verdict_missing": False,
                    "model": "x-ai/grok-4.5",
                    "cost_usd": Decimal("0.01"),
                    "tokens_in": 1,
                    "tokens_out": 1,
                },
            )()
        ),
    )
    monkeypatch.setattr(x_pipeline, "_maybe_generate_title", AsyncMock(return_value=None))
    persist_refresh = AsyncMock(return_value=True)
    monkeypatch.setattr(x_pipeline, "_persist_refresh", persist_refresh)
    complete = AsyncMock(return_value=[])
    monkeypatch.setattr(x_pipeline, "_complete_persisted_job", complete)
    monkeypatch.setattr(pipeline, "is_cancelled", lambda _job_id: False)
    monkeypatch.setattr(pipeline.events, "publish_job_event", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline.db, "insert_cost_event", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline.db, "link_job_transcript", AsyncMock(return_value=None))

    await x_pipeline.run(
        job_id="job1",
        user_id="user1",
        source_url=SOURCE_URL,
        refresh_transcript_id=TRANSCRIPT_ID,
        log=_Logger(),
    )

    persist_refresh.assert_awaited_once()
    complete.assert_awaited_once()
    assert complete.await_args.kwargs["transcript_id"] == TRANSCRIPT_ID
    pipeline.db.link_job_transcript.assert_not_awaited()  # type: ignore[attr-defined]
