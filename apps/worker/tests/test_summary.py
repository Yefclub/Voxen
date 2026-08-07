"""Testes do summary.maybe_generate (best-effort, OpenRouter direto no worker)."""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from src import summary


@pytest.fixture(autouse=True)
def _summary_enrichment_state(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(summary.db, "start_summary_enrichment", AsyncMock(return_value=1))
    monkeypatch.setattr(summary.db, "finish_summary_enrichment", AsyncMock(return_value=None))
    monkeypatch.setattr(summary.db, "complete_summary_enrichment", AsyncMock(return_value=True))
    monkeypatch.setattr(
        summary.voxen_settings,
        "get_summary_research_mode",
        AsyncMock(return_value="OFF"),
    )
    monkeypatch.setattr(
        summary.research_db,
        "queue_auto_transcript_enrichment",
        AsyncMock(return_value=False),
    )


class _FakeLogger:
    def __init__(self) -> None:
        self.events: list[tuple[str, str]] = []
        self.warning_details: list[tuple[str, dict[str, object]]] = []
        self.error_details: list[tuple[str, dict[str, object]]] = []

    def info(self, event: str, **_kw: object) -> None:
        self.events.append(("info", event))

    def warning(self, event: str, **kw: object) -> None:
        self.events.append(("warning", event))
        self.warning_details.append((event, kw))

    def error(self, event: str, **kw: object) -> None:
        self.events.append(("error", event))
        self.error_details.append((event, kw))


def _patch_db_fetch(monkeypatch: pytest.MonkeyPatch, row: dict[str, object] | None) -> MagicMock:
    fake_conn = MagicMock()
    fake_conn.fetchrow = AsyncMock(return_value=row)
    fake_conn.execute = AsyncMock()
    fake_ctx = MagicMock()
    fake_ctx.__aenter__ = AsyncMock(return_value=fake_conn)
    fake_ctx.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(summary.db, "connection", lambda: fake_ctx)
    return fake_conn


def _patch_model_config(
    monkeypatch: pytest.MonkeyPatch,
    *,
    api_key: str | None,
    model: str | None,
) -> None:
    monkeypatch.setattr(
        summary.voxen_settings,
        "get_openrouter_model_config",
        AsyncMock(
            return_value=summary.voxen_settings.OpenRouterModelConfig(
                api_key=api_key,
                model=model,
            )
        ),
    )


async def test_skip_when_cancelled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(summary, "is_cancelled", lambda _job_id: True)
    log = _FakeLogger()
    await summary.maybe_generate(user_id="u1", transcript_id="t1", job_id="j1", log=log)
    assert ("info", "summary-skipped-cancelled") in log.events


async def test_skip_when_row_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(summary, "is_cancelled", lambda _: False)
    _patch_db_fetch(monkeypatch, None)

    log = _FakeLogger()
    await summary.maybe_generate(user_id="u1", transcript_id="t1", job_id="j1", log=log)
    assert ("info", "summary-skipped-empty-text") in log.events


async def test_skip_when_plain_text_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(summary, "is_cancelled", lambda _: False)
    _patch_db_fetch(monkeypatch, {"title": "X", "plainText": ""})

    log = _FakeLogger()
    await summary.maybe_generate(user_id="u1", transcript_id="t1", job_id="j1", log=log)
    assert ("info", "summary-skipped-empty-text") in log.events


async def test_skip_when_missing_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(summary, "is_cancelled", lambda _: False)
    _patch_db_fetch(monkeypatch, {"title": "T", "plainText": "lorem ipsum"})
    _patch_model_config(monkeypatch, api_key=None, model="openai/gpt-4o-mini")

    log = _FakeLogger()
    await summary.maybe_generate(user_id="u1", transcript_id="t1", job_id="j1", log=log)
    assert ("warning", "summary-skipped-missing-config") in log.events


async def test_logs_done_on_200_with_summary(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(summary, "is_cancelled", lambda _: False)
    _patch_db_fetch(monkeypatch, {"title": "T", "plainText": "lorem ipsum"})
    _patch_model_config(monkeypatch, api_key="sk-test", model="openai/gpt-4o-mini")
    monkeypatch.setattr(
        summary.voxen_settings,
        "get_summary_timeout_sec",
        AsyncMock(return_value=42.0),
    )
    monkeypatch.setattr(
        summary.voxen_settings,
        "get_app_language",
        AsyncMock(return_value="pt-BR"),
    )
    queue_research = AsyncMock(return_value=True)
    monkeypatch.setattr(summary.research_db, "queue_auto_transcript_enrichment", queue_research)
    insert_cost = AsyncMock()
    monkeypatch.setattr(summary.db, "insert_cost_event", insert_cost)

    fake_response = MagicMock()
    fake_response.status_code = 200
    fake_response.json = MagicMock(
        return_value={
            "choices": [{"message": {"content": "## Em poucas linhas\nfoo"}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "cost": "0.001"},
        }
    )
    seen_timeout: dict[str, object] = {}

    async def fake_post(self: httpx.AsyncClient, *args: object, **kw: object) -> object:
        return fake_response

    original_init = httpx.AsyncClient.__init__

    def fake_init(self: httpx.AsyncClient, *args: object, **kw: object) -> None:
        seen_timeout["value"] = kw.get("timeout")
        original_init(self, *args, **kw)

    with (
        patch.object(httpx.AsyncClient, "__init__", fake_init),
        patch.object(httpx.AsyncClient, "post", fake_post),
    ):
        log = _FakeLogger()
        await summary.maybe_generate(user_id="u1", transcript_id="t1", job_id="j1", log=log)

    assert ("info", "summary-done") in log.events
    assert ("info", "research-enrichment-queued") in log.events
    queue_research.assert_awaited_once_with("u1", "t1")
    assert seen_timeout["value"] == 42.0
    summary.db.complete_summary_enrichment.assert_awaited_once_with(  # type: ignore[attr-defined]
        "u1",
        "t1",
        claim_attempt=1,
        summary_md="## Em poucas linhas\nfoo",
    )
    insert_cost.assert_awaited()
    kwargs = insert_cost.await_args.kwargs
    assert kwargs["kind"] == "CHAT"
    assert kwargs["cost_usd"] == Decimal("0.001")
    assert kwargs["meta"]["transcript_id"] == "t1"


async def test_logs_empty_when_200_without_summary(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(summary, "is_cancelled", lambda _: False)
    _patch_db_fetch(monkeypatch, {"title": "T", "plainText": "lorem"})
    _patch_model_config(monkeypatch, api_key="sk-test", model="openai/gpt-4o-mini")
    monkeypatch.setattr(
        summary.voxen_settings,
        "get_summary_timeout_sec",
        AsyncMock(return_value=120.0),
    )
    monkeypatch.setattr(
        summary.voxen_settings,
        "get_app_language",
        AsyncMock(return_value="pt-BR"),
    )

    fake_response = MagicMock()
    fake_response.status_code = 200
    fake_response.json = MagicMock(
        return_value={"choices": [{"message": {"content": ""}}], "usage": {}}
    )

    async def fake_post(self: httpx.AsyncClient, *args: object, **kw: object) -> object:
        return fake_response

    with patch.object(httpx.AsyncClient, "post", fake_post):
        log = _FakeLogger()
        await summary.maybe_generate(user_id="u1", transcript_id="t1", job_id="j1", log=log)
    assert ("info", "summary-empty") in log.events


async def test_warns_on_non_200(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(summary, "is_cancelled", lambda _: False)
    _patch_db_fetch(monkeypatch, {"title": "T", "plainText": "lorem"})
    _patch_model_config(monkeypatch, api_key="sk-test", model="openai/gpt-4o-mini")
    monkeypatch.setattr(
        summary.voxen_settings,
        "get_summary_timeout_sec",
        AsyncMock(return_value=120.0),
    )
    monkeypatch.setattr(
        summary.voxen_settings,
        "get_app_language",
        AsyncMock(return_value="pt-BR"),
    )

    fake_response = MagicMock()
    fake_response.status_code = 502
    fake_response.text = (
        "Bearer body-secret sk-or-v1-upstream-secret socks5h://proxy-user:proxy-pass@127.0.0.1:1080"
    )

    async def fake_post(self: httpx.AsyncClient, *args: object, **kw: object) -> object:
        return fake_response

    with patch.object(httpx.AsyncClient, "post", fake_post):
        log = _FakeLogger()
        await summary.maybe_generate(user_id="u1", transcript_id="t1", job_id="j1", log=log)
    assert ("warning", "summary-upstream-non-200") in log.events
    assert ("summary-upstream-non-200", {"status": 502}) in log.warning_details
    logged = repr(log.warning_details)
    assert "body-secret" not in logged
    assert "upstream-secret" not in logged
    assert "proxy-user" not in logged
    assert "proxy-pass" not in logged


async def test_network_error_log_does_not_include_proxy_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(summary, "is_cancelled", lambda _: False)
    _patch_db_fetch(monkeypatch, {"title": "T", "plainText": "lorem"})
    _patch_model_config(monkeypatch, api_key="sk-test", model="openai/gpt-4o-mini")
    monkeypatch.setattr(
        summary.voxen_settings,
        "get_summary_timeout_sec",
        AsyncMock(return_value=120.0),
    )
    monkeypatch.setattr(
        summary.voxen_settings,
        "get_app_language",
        AsyncMock(return_value="pt-BR"),
    )

    async def fake_post(self: httpx.AsyncClient, *args: object, **kw: object) -> object:
        raise httpx.ProxyError("socks5h://proxy-user:proxy-pass@127.0.0.1:1080")

    with patch.object(httpx.AsyncClient, "post", fake_post):
        log = _FakeLogger()
        await summary.maybe_generate(user_id="u1", transcript_id="t1", job_id="j1", log=log)

    assert log.warning_details == [
        (
            "summary-network-error",
            {
                "error_code": "SUMMARY_UPSTREAM_UNAVAILABLE",
                "error_type": "ProxyError",
            },
        )
    ]
    assert "proxy-user" not in repr(log.warning_details)
    assert "proxy-pass" not in repr(log.warning_details)


async def test_exception_is_logged_but_not_raised(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(summary, "is_cancelled", lambda _: False)

    def boom() -> object:
        raise RuntimeError("DB exploded")

    monkeypatch.setattr(summary.db, "connection", boom)

    log = _FakeLogger()
    # Não levanta — best-effort
    await summary.maybe_generate(user_id="u1", transcript_id="t1", job_id="j1", log=log)
    assert ("error", "summary-failed") in log.events
    assert log.error_details == [
        (
            "summary-failed",
            {
                "transcript_id": "t1",
                "error_code": "SUMMARY_FAILED",
                "error_type": "RuntimeError",
            },
        )
    ]
    assert "DB exploded" not in repr(log.error_details)


def test_build_summarize_prompt_no_tldr_pt_and_en() -> None:
    pt = summary.build_summarize_prompt("pt-BR")
    en = summary.build_summarize_prompt("en")
    assert "## TL;DR" not in pt and "## TLDR" not in pt
    assert "Em poucas linhas" in pt
    assert "## TL;DR" not in en and "## TLDR" not in en
    assert "In short" in en
