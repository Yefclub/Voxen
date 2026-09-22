from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest

from src import pipeline
from src.pipeline_errors import PermanentError
from src.x_post import XPost

SOURCE_URL = "https://x.com/i/status/123456789"


class _Logger:
    def info(self, *_args: object, **_kwargs: object) -> None:
        pass

    def warning(self, *_args: object, **_kwargs: object) -> None:
        pass


def _capture() -> XPost:
    return XPost(
        status_id="123456789",
        text="Product design cheat sheet; bookmark this.",
        author_name="rico",
        author_handle="_heyrico",
        created_at=datetime(2026, 9, 21, 14, 59, 3, tzinfo=UTC),
        lang="fr",
        like_count=291,
        reply_count=13,
        media=(),
    )


def _analysis(text: str, accessible: bool | None) -> SimpleNamespace:
    return SimpleNamespace(
        text=text,
        cost_usd=Decimal("0.002"),
        model="x-ai/grok-4.1-fast",
        tokens_in=20,
        tokens_out=8,
        accessible=accessible,
    )


async def _run_pipeline(
    monkeypatch: pytest.MonkeyPatch,
    *,
    capture: XPost | None,
    analysis: SimpleNamespace | None = None,
    analysis_error: Exception | None = None,
) -> None:
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
    monkeypatch.setattr(pipeline.x_post, "fetch_x_post", AsyncMock(return_value=capture))
    monkeypatch.setattr(
        pipeline,
        "analyze_x_url",
        AsyncMock(return_value=analysis, side_effect=analysis_error),
    )
    monkeypatch.setattr(pipeline, "is_cancelled", lambda _job_id: False)
    monkeypatch.setattr(pipeline.events, "publish_job_event", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline.db, "insert_cost_event", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline, "_maybe_generate_title", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline, "_persist", AsyncMock(return_value="transcript-1"))
    monkeypatch.setattr(pipeline.db, "link_job_transcript", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline, "_enrich_persisted_transcript", AsyncMock(return_value=[]))
    monkeypatch.setattr(pipeline.db, "mark_job_done", AsyncMock(return_value=None))

    await pipeline._run_x_analysis_pipeline(
        job_id="job-1",
        user_id="user-1",
        source_url=SOURCE_URL,
        log=_Logger(),
    )


def _persisted(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    return pipeline._persist.await_args.kwargs


async def test_pipeline_persists_accessible_analysis(monkeypatch: pytest.MonkeyPatch) -> None:
    await _run_pipeline(monkeypatch, capture=None, analysis=_analysis("## Análise", True))

    assert _persisted(monkeypatch)["segments"][0].text == "## Análise"
    assert _persisted(monkeypatch)["model"] == "x-ai/grok-4.1-fast"
    assert pipeline.db.insert_cost_event.await_count == 1


async def test_pipeline_fails_when_post_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(PermanentError) as excinfo:
        await _run_pipeline(
            monkeypatch,
            capture=None,
            analysis=_analysis("O post não estava acessível.", False),
        )

    assert excinfo.value.code == "X_CONTENT_UNAVAILABLE"
    assert pipeline._persist.await_count == 0


async def test_pipeline_persists_capture_when_model_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    await _run_pipeline(
        monkeypatch,
        capture=_capture(),
        analysis_error=PermanentError.public("OPENROUTER_REQUEST_REJECTED", "rejeitado"),
    )

    content = _persisted(monkeypatch)["segments"][0].text
    assert content.startswith("Conteúdo capturado diretamente do X.")
    assert "Product design cheat sheet" in content
    assert _persisted(monkeypatch)["model"] is None
    assert _persisted(monkeypatch)["language"] == "fr"
    assert pipeline.db.insert_cost_event.await_count == 0


async def test_pipeline_uses_capture_metadata_for_transcript(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await _run_pipeline(monkeypatch, capture=_capture(), analysis=_analysis("## Análise", None))

    probe = _persisted(monkeypatch)["probe_info"]
    assert probe.channel == "@_heyrico"
    assert probe.published_at == datetime(2026, 9, 21, 14, 59, 3, tzinfo=UTC)
    assert probe.title == "Product design cheat sheet; bookmark this."
    assert _persisted(monkeypatch)["segments"][0].text == "## Análise"


async def test_pipeline_ignores_model_denial_when_capture_exists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await _run_pipeline(
        monkeypatch,
        capture=_capture(),
        analysis=_analysis("Não consegui acessar o post.", False),
    )

    content = _persisted(monkeypatch)["segments"][0].text
    assert content.startswith("Conteúdo capturado diretamente do X.")
