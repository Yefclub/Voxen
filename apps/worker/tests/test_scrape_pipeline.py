"""Testes do scrape_pipeline.run (mocked: scraper + storage + db + events + summary)."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from src import scrape_pipeline, scraper
from src.cancellation import CancelledException
from src.pipeline import PermanentError


class _FakeLogger:
    def info(self, *_a: object, **_kw: object) -> None:
        pass

    def warning(self, *_a: object, **_kw: object) -> None:
        pass

    def exception(self, *_a: object, **_kw: object) -> None:
        pass


def _scrape_result() -> scraper.ScrapeResult:
    return scraper.ScrapeResult(
        url="https://example.com/post",
        title="Como aprender Python",
        site_name="Blog Tech",
        author="João Silva",
        published_at=datetime(2026, 1, 15),
        thumbnail_url="https://example.com/cover.jpg",
        language="pt",
        markdown="# Como aprender Python\n\nPython é...",
        plain_text="Como aprender Python. Python é...",
    )


async def test_happy_path_persists_and_publishes_events(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Pipeline completo: fetch → persist → link_job_done → summary → publica done."""
    # Mock scraper.fetch_and_extract → retorna ScrapeResult válido
    monkeypatch.setattr(
        scrape_pipeline.scraper,
        "fetch_and_extract",
        AsyncMock(return_value=_scrape_result()),
    )

    # Mock storage.put_markdown
    monkeypatch.setattr(
        scrape_pipeline.storage,
        "put_markdown",
        AsyncMock(return_value=None),
    )

    # Mock events.publish_job_event — coleta os stages publicados
    events_published: list[str] = []

    async def fake_publish(uid: str, jid: str, stage: str, **kw: object) -> None:
        events_published.append(stage)

    monkeypatch.setattr(scrape_pipeline.events, "publish_job_event", fake_publish)

    # Mock db: connection() + link_job_transcript/mark_job_done
    fake_conn = MagicMock()
    fake_conn.execute = AsyncMock(return_value=None)
    fake_ctx = MagicMock()
    fake_ctx.__aenter__ = AsyncMock(return_value=fake_conn)
    fake_ctx.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(scrape_pipeline.db, "connection", lambda: fake_ctx)
    monkeypatch.setattr(scrape_pipeline.db, "generate_cuid", lambda: "ctest123")
    monkeypatch.setattr(scrape_pipeline.db, "link_job_transcript", AsyncMock(return_value=None))
    monkeypatch.setattr(scrape_pipeline.db, "mark_job_done", AsyncMock(return_value=None))
    monkeypatch.setattr(
        scrape_pipeline.db,
        "upsert_transcript_brain_node",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(
        scrape_pipeline.db,
        "reindex_transcript_brain_node",
        AsyncMock(return_value=True),
    )

    # Mock summary.maybe_generate (best-effort, não precisa testar aqui)
    monkeypatch.setattr(
        scrape_pipeline.summary,
        "maybe_generate",
        AsyncMock(return_value=None),
    )

    # cancel = false
    monkeypatch.setattr(scrape_pipeline, "is_cancelled", lambda _: False)

    await scrape_pipeline.run(
        job_id="job1",
        user_id="user1",
        source_url="https://example.com/post",
        log=_FakeLogger(),
    )

    # Eventos esperados na ordem
    assert "downloading" in events_published
    assert "uploading" in events_published
    assert "indexing" in events_published
    assert "summarizing" in events_published
    assert "done" in events_published

    # Job só vira DONE depois da tentativa de resumo.
    scrape_pipeline.db.link_job_transcript.assert_awaited_once_with("job1", "ctest123")  # type: ignore[attr-defined]
    scrape_pipeline.db.upsert_transcript_brain_node.assert_awaited_once()  # type: ignore[attr-defined]
    scrape_pipeline.db.reindex_transcript_brain_node.assert_awaited_once_with("user1", "ctest123")  # type: ignore[attr-defined]
    scrape_pipeline.db.mark_job_done.assert_awaited_once_with("job1")  # type: ignore[attr-defined]


async def test_robots_blocked_raises_permanent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """robots.txt proíbe → PermanentError (Job FAILED)."""
    monkeypatch.setattr(
        scrape_pipeline.scraper,
        "fetch_and_extract",
        AsyncMock(side_effect=scraper.RobotsBlockedError("robots blocked")),
    )
    monkeypatch.setattr(scrape_pipeline.events, "publish_job_event", AsyncMock())
    monkeypatch.setattr(scrape_pipeline, "is_cancelled", lambda _: False)

    with pytest.raises(PermanentError) as exc_info:
        await scrape_pipeline.run(
            job_id="job1",
            user_id="user1",
            source_url="https://blocked.example.com/",
            log=_FakeLogger(),
        )
    assert exc_info.value.code == "SCRAPE_ROBOTS_BLOCKED"
    assert (
        exc_info.value.public_message == "O site não permite a leitura automatizada deste conteúdo."
    )
    assert "robots blocked" not in exc_info.value.public_message


async def test_fetch_blocked_raises_permanent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """4xx no fetch → PermanentError."""
    monkeypatch.setattr(
        scrape_pipeline.scraper,
        "fetch_and_extract",
        AsyncMock(side_effect=scraper.FetchBlockedError("HTTP 403")),
    )
    monkeypatch.setattr(scrape_pipeline.events, "publish_job_event", AsyncMock())
    monkeypatch.setattr(scrape_pipeline, "is_cancelled", lambda _: False)

    with pytest.raises(PermanentError) as exc_info:
        await scrape_pipeline.run(
            job_id="job1",
            user_id="user1",
            source_url="https://example.com/",
            log=_FakeLogger(),
        )
    assert exc_info.value.code == "SCRAPE_ACCESS_BLOCKED"
    assert exc_info.value.public_message == "Não foi possível acessar esta página com segurança."
    assert "HTTP 403" not in exc_info.value.public_message


async def test_empty_content_raises_permanent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Conteúdo curto/paywall/JS-heavy → PermanentError."""
    monkeypatch.setattr(
        scrape_pipeline.scraper,
        "fetch_and_extract",
        AsyncMock(side_effect=scraper.EmptyContentError("vazio")),
    )
    monkeypatch.setattr(scrape_pipeline.events, "publish_job_event", AsyncMock())
    monkeypatch.setattr(scrape_pipeline, "is_cancelled", lambda _: False)

    with pytest.raises(PermanentError) as exc_info:
        await scrape_pipeline.run(
            job_id="job1",
            user_id="user1",
            source_url="https://paywall.example.com/",
            log=_FakeLogger(),
        )
    assert exc_info.value.code == "SCRAPE_CONTENT_EMPTY"
    assert (
        exc_info.value.public_message == "A página não ofereceu conteúdo suficiente para análise."
    )
    assert "vazio" not in exc_info.value.public_message


async def test_cancel_before_start(monkeypatch: pytest.MonkeyPatch) -> None:
    """Cancel pré-fetch → CancelledException."""
    monkeypatch.setattr(scrape_pipeline, "is_cancelled", lambda _: True)
    monkeypatch.setattr(scrape_pipeline.events, "publish_job_event", AsyncMock())

    with pytest.raises(CancelledException):
        await scrape_pipeline.run(
            job_id="job1",
            user_id="user1",
            source_url="https://example.com/",
            log=_FakeLogger(),
        )
