"""Testes do scrape_pipeline.run (mocked: scraper + storage + db + events + summary)."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from src import pipeline, scrape_pipeline, scraper, thumbnail
from src.cancellation import CancelledException
from src.job_lease import JobLeaseLostError, JobLeaseToken, activate_job_lease
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
    enrich = AsyncMock(side_effect=lambda **_: events_published.append("enrich"))
    monkeypatch.setattr(pipeline, "_enrich_persisted_transcript", enrich)

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
    assert "done" in events_published
    assert events_published.index("done") < events_published.index("enrich")

    # Conteúdo canônico vira DONE antes dos enriquecimentos derivados.
    scrape_pipeline.db.link_job_transcript.assert_awaited_once_with("job1", "ctest123")  # type: ignore[attr-defined]
    scrape_pipeline.db.upsert_transcript_brain_node.assert_awaited_once()  # type: ignore[attr-defined]
    scrape_pipeline.db.mark_job_done.assert_awaited_once_with("job1")  # type: ignore[attr-defined]


async def test_unchanged_refresh_skips_storage_and_all_derived_work(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mesmo checksum atualiza a coleta, mas não gera custo nem reindexa."""
    result = _scrape_result()
    checksum = scrape_pipeline._source_checksum(result.plain_text)
    fake_conn = MagicMock()
    fake_conn.fetchrow = AsyncMock(
        return_value={
            "source": "WEB",
            "sourceChecksum": checksum,
            "sourceVersion": 1,
            "mdPath": "workspaces/user1/transcripts/t1/sources/v1.md",
            "plainText": result.plain_text,
            "sourceMetadata": {},
        }
    )
    fake_conn.execute = AsyncMock(return_value=None)
    fake_ctx = MagicMock()
    fake_ctx.__aenter__ = AsyncMock(return_value=fake_conn)
    fake_ctx.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(scrape_pipeline.db, "connection", lambda: fake_ctx)
    monkeypatch.setattr(scrape_pipeline.db, "generate_cuid", lambda: "version-row")
    put_markdown = AsyncMock(return_value=None)
    monkeypatch.setattr(scrape_pipeline.storage, "put_markdown", put_markdown)
    title = AsyncMock(return_value="não deveria chamar")
    monkeypatch.setattr(scrape_pipeline, "_maybe_generate_title", title)

    persisted = await scrape_pipeline._persist(
        user_id="user1",
        job_id="job1",
        source_url=result.url,
        result=result,
        refresh_transcript_id="t1",
        log=_FakeLogger(),
    )

    assert persisted == scrape_pipeline.PersistResult("t1", changed=False)
    put_markdown.assert_not_awaited()
    title.assert_not_awaited()
    assert fake_conn.execute.await_count == 4
    assert "pg_advisory_lock" in fake_conn.execute.await_args_list[0].args[0]
    assert "pg_advisory_unlock" in fake_conn.execute.await_args_list[-1].args[0]


async def test_unchanged_refresh_run_skips_summary_tags_brain_and_embedding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        scrape_pipeline.scraper,
        "fetch_and_extract",
        AsyncMock(return_value=_scrape_result()),
    )
    monkeypatch.setattr(
        scrape_pipeline,
        "_persist",
        AsyncMock(return_value=scrape_pipeline.PersistResult("t1", changed=False)),
    )
    monkeypatch.setattr(scrape_pipeline, "is_cancelled", lambda _: False)
    monkeypatch.setattr(scrape_pipeline.events, "publish_job_event", AsyncMock())
    monkeypatch.setattr(scrape_pipeline.db, "link_job_transcript", AsyncMock())
    monkeypatch.setattr(scrape_pipeline.db, "mark_job_done", AsyncMock())
    enrich = AsyncMock()
    monkeypatch.setattr(pipeline, "_enrich_persisted_transcript", enrich)

    await scrape_pipeline.run(
        job_id="job1",
        user_id="user1",
        source_url="https://example.com/post",
        refresh_transcript_id="t1",
        log=_FakeLogger(),
    )

    enrich.assert_not_awaited()
    scrape_pipeline.db.link_job_transcript.assert_not_awaited()  # type: ignore[attr-defined]


async def test_changed_refresh_versions_and_invalidates_only_affected_artifacts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mudança preserva o snapshot e limpa apenas derivados do transcript."""
    result = _scrape_result()
    first_conn = MagicMock()
    first_conn.fetchrow = AsyncMock(
        return_value={
            "source": "WEB",
            "sourceChecksum": "checksum-antigo",
            "sourceVersion": 1,
            "mdPath": "workspaces/user1/transcripts/t1/sources/v1.md",
            "plainText": "Texto da versão anterior.",
            "sourceMetadata": {"url": result.url},
        }
    )
    first_conn.execute = AsyncMock(return_value=None)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=first_conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(scrape_pipeline.db, "connection", lambda: ctx)
    monkeypatch.setattr(scrape_pipeline.db, "generate_cuid", lambda: "version-row")
    monkeypatch.setattr(scrape_pipeline.storage, "put_markdown", AsyncMock())
    monkeypatch.setattr(
        scrape_pipeline, "_maybe_generate_title", AsyncMock(return_value=result.title)
    )
    monkeypatch.setattr(
        thumbnail,
        "resolve_thumbnail_for_persist",
        AsyncMock(return_value=(None, None, None)),
    )
    monkeypatch.setattr(scrape_pipeline.db, "upsert_transcript_brain_node", AsyncMock())

    persisted = await scrape_pipeline._persist(
        user_id="user1",
        job_id="job1",
        source_url=result.url,
        result=result,
        refresh_transcript_id="t1",
        log=_FakeLogger(),
    )

    assert persisted == scrape_pipeline.PersistResult("t1", changed=True)
    statements = "\n".join(str(call.args[0]) for call in first_conn.execute.await_args_list)
    assert 'INSERT INTO "SourceContentVersion"' in statements
    assert '"sourceVersion" = $16' in statements
    assert 'DELETE FROM "TranscriptTag"' in statements
    assert 'UPDATE "ChatMessage"' in statements
    assert "pg_advisory_lock" in first_conn.execute.await_args_list[0].args[0]
    assert "pg_advisory_unlock" in first_conn.execute.await_args_list[-1].args[0]


async def test_stale_refresh_attempt_is_fenced_before_transcript_write(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    result = _scrape_result()
    fake_conn = MagicMock()
    fake_conn.execute = AsyncMock(return_value=None)

    async def reject_stale_owner(query: str, *_args: object) -> object:
        assert 'FROM "Job"' in query
        return None

    fake_conn.fetchrow = AsyncMock(side_effect=reject_stale_owner)
    fake_tx = MagicMock()
    fake_tx.__aenter__ = AsyncMock(return_value=None)
    fake_tx.__aexit__ = AsyncMock(return_value=False)
    fake_conn.transaction.return_value = fake_tx
    fake_ctx = MagicMock()
    fake_ctx.__aenter__ = AsyncMock(return_value=fake_conn)
    fake_ctx.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(scrape_pipeline.db, "connection", lambda: fake_ctx)
    put_markdown = AsyncMock()
    monkeypatch.setattr(scrape_pipeline.storage, "put_markdown", put_markdown)

    token = JobLeaseToken("job1", "old-worker", 1)
    with activate_job_lease(token), pytest.raises(JobLeaseLostError):
        await scrape_pipeline._persist(
            user_id="user1",
            job_id="job1",
            source_url=result.url,
            result=result,
            refresh_transcript_id="t1",
            log=_FakeLogger(),
        )

    put_markdown.assert_not_awaited()
    statements = "\n".join(str(call.args[0]) for call in fake_conn.execute.await_args_list)
    assert 'UPDATE "Transcript"' not in statements


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
