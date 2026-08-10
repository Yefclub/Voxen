"""Testes puros do extrator grounded (spec 104)."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest

from src import brain_compilation, brain_compilation_db, brain_extract, openrouter
from src.brain_extract import (
    ExtractionSegment,
    GroundedExtractionResult,
    extract_grounded_concepts,
    is_grounded,
    parse_grounded_payload,
    parse_grounded_relations,
    segment_content,
    slugify_label,
)


def test_is_grounded_requires_substring() -> None:
    source = "O Docker facilita o deploy com containers isolados no servidor."
    assert is_grounded("Docker facilita o deploy", source)
    assert not is_grounded("Kubernetes orquestra pods", source)
    assert not is_grounded("curto", source)


def test_parse_keeps_only_grounded_items() -> None:
    source = (
        "LangExtract extrai entidades com trechos literais. "
        "O Voxen usa OpenRouter para o chat e a transcrição."
    )
    raw = """
    {
      "entities": [
        {
          "label": "LangExtract",
          "excerpt": "LangExtract extrai entidades com trechos literais",
          "confidence": 0.9
        },
        {
          "label": "Inventado",
          "excerpt": "texto que nao existe no fonte",
          "confidence": 0.9
        }
      ],
      "claims": [
        {
          "label": "Voxen usa OpenRouter",
          "excerpt": "O Voxen usa OpenRouter para o chat",
          "confidence": 0.8
        }
      ]
    }
    """
    items = parse_grounded_payload(raw, source)
    labels = {item.label for item in items}
    assert "LangExtract" in labels
    assert "Voxen usa OpenRouter" in labels
    assert "Inventado" not in labels


def test_slugify() -> None:
    assert slugify_label("Estúdio Ghibli") == "estudio-ghibli"


def test_parse_grounded_relations_requires_evidence_and_confident_alias() -> None:
    source = "PostgreSQL também é chamado de Postgres. PostgreSQL suporta índices GIN."
    raw = json.dumps(
        {
            "entities": [
                {"label": "PostgreSQL", "excerpt": "PostgreSQL também é chamado de Postgres"},
                {"label": "Postgres", "excerpt": "PostgreSQL também é chamado de Postgres"},
            ],
            "claims": [
                {
                    "label": "PostgreSQL suporta índices GIN",
                    "excerpt": "PostgreSQL suporta índices GIN",
                }
            ],
            "relations": [
                {
                    "subject": "PostgreSQL",
                    "predicate": "same_as",
                    "object": "Postgres",
                    "kind": "SAME_AS",
                    "excerpt": "PostgreSQL também é chamado de Postgres",
                    "confidence": 0.93,
                },
                {
                    "subject": "Postgres",
                    "predicate": "contradicts",
                    "object": "PostgreSQL suporta índices GIN",
                    "kind": "CONTRADICTS",
                    "excerpt": "evidência inventada",
                    "confidence": 0.9,
                },
            ],
        }
    )
    items = parse_grounded_payload(raw, source)
    relations = parse_grounded_relations(raw, source, items)

    assert [(relation.kind, relation.subject, relation.object) for relation in relations] == [
        ("SAME_AS", "PostgreSQL", "Postgres")
    ]


def test_segment_content_covers_long_markdown_with_lines_and_timestamps() -> None:
    content = "\n".join(
        [
            "# Introdução",
            "Contexto inicial " * 12,
            "## Transcrição",
            "[00:00:00](https://example.test?t=0) Primeiro bloco importante.",
            "[00:00:15](https://example.test?t=15) Segundo bloco importante.",
            "## Conclusão",
            "Conclusão posterior " * 15,
        ]
    )

    segments = segment_content(content, max_chars=180)

    assert len(segments) >= 3
    assert all(len(segment.text) <= 180 for segment in segments)
    assert segments[0].start_line == 1
    assert segments[-1].end_line == len(content.splitlines())
    timestamped = next(segment for segment in segments if segment.start_sec == 0)
    assert timestamped.end_sec == 15
    assert "Conclusão posterior" in segments[-1].text


def test_segment_content_uses_stable_key_and_splits_oversized_line() -> None:
    content = "A" * 260
    first = segment_content(content, max_chars=100)
    second = segment_content(content, max_chars=100)

    assert [segment.key for segment in first] == [segment.key for segment in second]
    assert len(first) == 3
    assert all(segment.start_line == segment.end_line == 1 for segment in first)


class _Lease:
    def locally_owned(self) -> bool:
        return True

    @asynccontextmanager
    async def heartbeat(self) -> Any:
        yield

    async def release(self) -> bool:
        return True


async def test_short_corrected_content_completes_durable_placeholder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        brain_compilation.db,
        "get_transcript_title_content_md_path",
        AsyncMock(return_value=("Título", "curto", None, 1, 2, "source-2")),
    )
    skipped = AsyncMock()
    monkeypatch.setattr(brain_compilation_db, "mark_transcript_compilation_skipped", skipped)

    await brain_compilation.extract_grounded_brain(
        user_id="user-1",
        transcript_id="transcript-1",
        log=SimpleNamespace(info=lambda *a, **k: None, warning=lambda *a, **k: None),
    )

    skipped.assert_awaited_once_with(
        user_id="user-1",
        transcript_id="transcript-1",
        correction_revision=1,
        source_version=2,
        source_checksum="source-2",
    )


async def test_segment_failure_keeps_following_segment_and_records_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = ExtractionSegment("first", "primeira seção", 1, 1, None, None)
    second = ExtractionSegment("second", "segunda seção grounded", 2, 2, 15, 15)
    monkeypatch.setattr(
        brain_compilation.db,
        "get_transcript_title_content_md_path",
        AsyncMock(return_value=("Título", "fallback suficiente " * 8, None, 1, 2, "source-2")),
    )
    monkeypatch.setattr(brain_extract, "segment_content", lambda _: [first, second])
    prepared = AsyncMock(
        return_value=("compilation-1", [{"segmentKey": "first"}, {"segmentKey": "second"}])
    )
    monkeypatch.setattr(
        brain_compilation.db,
        "prepare_grounded_brain_compilation",
        prepared,
    )
    claim = AsyncMock(return_value=[{"segmentKey": "first"}, {"segmentKey": "second"}])
    monkeypatch.setattr(brain_compilation_db, "claim_segments", claim)
    monkeypatch.setattr(
        brain_compilation.voxen_settings,
        "get_openrouter_model_config",
        AsyncMock(return_value=SimpleNamespace(api_key="key", model="model", fallback_model=None)),
    )
    monkeypatch.setattr(
        brain_compilation.voxen_settings,
        "get_app_language",
        AsyncMock(return_value="pt-BR"),
    )
    monkeypatch.setattr(
        brain_compilation, "acquire_graph_index_lease", AsyncMock(return_value=_Lease())
    )
    monkeypatch.setattr(brain_compilation.db, "insert_cost_event", AsyncMock())
    upsert = AsyncMock(return_value=1)
    failed = AsyncMock()
    monkeypatch.setattr(brain_compilation.db, "upsert_grounded_brain_items", upsert)
    monkeypatch.setattr(brain_compilation_db, "mark_segment_failed", failed)

    async def extract(**kwargs: Any) -> GroundedExtractionResult:
        if kwargs["content"] == "primeira seção":
            raise RuntimeError("provider indisponível")
        return GroundedExtractionResult(
            items=[], relations=[], cost_usd=Decimal("0"), model="model", tokens_in=10, tokens_out=2
        )

    monkeypatch.setattr(brain_extract, "extract_grounded_concepts", extract)

    await brain_compilation.extract_grounded_brain(
        user_id="user-1",
        transcript_id="transcript-1",
        log=SimpleNamespace(info=lambda *a, **k: None, warning=lambda *a, **k: None),
        worker_id="worker-test",
    )

    failed.assert_awaited_once()
    assert failed.await_args.kwargs["compilation_id"] == "compilation-1"
    assert failed.await_args.kwargs["segment_key"] == "first"
    assert failed.await_args.kwargs["error"] == "RuntimeError"
    assert failed.await_args.kwargs["worker_id"].startswith("worker-test:")
    upsert.assert_awaited_once()
    assert upsert.await_args.kwargs["segment"]["key"] == "second"

    async def extract_retry(**kwargs: Any) -> GroundedExtractionResult:
        return GroundedExtractionResult(
            items=[], relations=[], cost_usd=Decimal("0"), model="model", tokens_in=10, tokens_out=2
        )

    monkeypatch.setattr(brain_extract, "extract_grounded_concepts", extract_retry)
    prepared.return_value = ("compilation-1", [{"segmentKey": "first"}])
    claim.return_value = [{"segmentKey": "first"}]
    await brain_compilation.extract_grounded_brain(
        user_id="user-1",
        transcript_id="transcript-1",
        log=SimpleNamespace(info=lambda *a, **k: None, warning=lambda *a, **k: None),
        worker_id="worker-test",
    )
    assert upsert.await_count == 2
    assert upsert.await_args.kwargs["segment"]["key"] == "first"


async def test_grounded_model_runs_before_short_write_lease_and_contention_retries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    segment = ExtractionSegment("only", "conteúdo grounded suficiente", 1, 1, None, None)
    events: list[str] = []
    monkeypatch.setattr(
        brain_compilation.db,
        "get_transcript_title_content_md_path",
        AsyncMock(return_value=("Título", "fallback suficiente " * 8, None, 1, 2, "source-2")),
    )
    monkeypatch.setattr(brain_extract, "segment_content", lambda _: [segment])
    monkeypatch.setattr(
        brain_compilation.db,
        "prepare_grounded_brain_compilation",
        AsyncMock(return_value=("compilation-1", [{"segmentKey": "only"}])),
    )
    monkeypatch.setattr(
        brain_compilation_db,
        "claim_segments",
        AsyncMock(return_value=[{"segmentKey": "only"}]),
    )
    monkeypatch.setattr(
        brain_compilation.voxen_settings,
        "get_openrouter_model_config",
        AsyncMock(return_value=SimpleNamespace(api_key="key", model="model", fallback_model=None)),
    )
    monkeypatch.setattr(
        brain_compilation.voxen_settings,
        "get_app_language",
        AsyncMock(return_value="pt-BR"),
    )
    monkeypatch.setattr(brain_compilation.db, "insert_cost_event", AsyncMock())
    retry = AsyncMock()
    monkeypatch.setattr(brain_compilation_db, "mark_segment_failed", retry)
    upsert = AsyncMock()
    monkeypatch.setattr(brain_compilation.db, "upsert_grounded_brain_items", upsert)

    async def extract(**_kwargs: Any) -> GroundedExtractionResult:
        events.append("model")
        return GroundedExtractionResult(
            items=[], relations=[], cost_usd=Decimal("0"), model="model", tokens_in=10, tokens_out=2
        )

    async def acquire(_user_id: str) -> None:
        events.append("lease")
        return None

    monkeypatch.setattr(brain_extract, "extract_grounded_concepts", extract)
    monkeypatch.setattr(brain_compilation, "acquire_graph_index_lease", acquire)

    await brain_compilation.extract_grounded_brain(
        user_id="user-1",
        transcript_id="transcript-1",
        log=SimpleNamespace(info=lambda *a, **k: None, warning=lambda *a, **k: None),
        worker_id="worker-test",
    )

    assert events == ["model", "lease"]
    upsert.assert_not_awaited()
    retry.assert_awaited_once()
    assert retry.await_args.kwargs["compilation_id"] == "compilation-1"
    assert retry.await_args.kwargs["segment_key"] == "only"
    assert retry.await_args.kwargs["error"] == "GRAPH_WRITE_LEASE_UNAVAILABLE"
    assert retry.await_args.kwargs["worker_id"].startswith("worker-test:")


class _ExternalErrorClient:
    async def post(
        self,
        url: str,
        *,
        headers: dict[str, str],
        json: dict[str, Any],
    ) -> httpx.Response:
        return httpx.Response(
            502,
            text="Bearer body-secret sk-or-v1-secret socks5h://user:pass@127.0.0.1:1080",
        )


async def test_grounded_extraction_does_not_propagate_upstream_body() -> None:
    with pytest.raises(openrouter.OpenrouterTransientError) as raised:
        await extract_grounded_concepts(
            title="Título",
            content="Conteúdo suficiente para a extração estruturada.",
            api_key="sk-test",
            model="x-ai/grok-4.5",
            client=_ExternalErrorClient(),  # type: ignore[arg-type]
        )

    assert str(raised.value) == "OpenRouter temporariamente indisponível (HTTP 502)."
    assert "body-secret" not in str(raised.value)
