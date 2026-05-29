"""Testes runtime das tools que criam jobs e leem resumo (#38/#41)."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from src import tools


async def test_transcribe_video_queues_canonical_youtube(monkeypatch: pytest.MonkeyPatch) -> None:
    create_job = AsyncMock(
        return_value={
            "id": "job1",
            "status": "QUEUED",
            "sourceUrl": "https://youtu.be/dQw4w9WgXcQ",
        }
    )
    publish = AsyncMock()
    monkeypatch.setattr(
        tools.voxen_settings, "get_default_x_analysis_model", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(tools.db, "create_transcribe_job", create_job)
    monkeypatch.setattr(tools.redis_pub, "publish_new_job", publish)

    result = await tools.execute_tool(
        "transcribe_video",
        {"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42", "wait": False},
        "user1",
    )

    assert result["status"] == "queued"
    assert result["source_url"] == "https://youtu.be/dQw4w9WgXcQ"
    create_job.assert_awaited_once_with("user1", "https://youtu.be/dQw4w9WgXcQ")
    publish.assert_awaited_once_with("job1")


async def test_transcribe_video_returns_duplicate_transcript(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        tools.voxen_settings, "get_default_x_analysis_model", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(
        tools.db,
        "create_transcribe_job",
        AsyncMock(return_value={"duplicate": "transcript", "transcript_id": "t1"}),
    )
    monkeypatch.setattr(
        tools.db,
        "get_user_transcript",
        AsyncMock(
            return_value={
                "id": "t1",
                "title": "Vídeo existente",
                "source": "YOUTUBE",
                "summaryMd": "Resumo pronto.",
                "plainText": "Texto completo.",
            }
        ),
    )
    publish = AsyncMock()
    monkeypatch.setattr(tools.redis_pub, "publish_new_job", publish)

    result = await tools.execute_tool(
        "transcribe_video",
        {"url": "https://youtu.be/dQw4w9WgXcQ"},
        "user1",
    )

    assert result == {
        "status": "already_transcribed",
        "transcript_id": "t1",
        "transcript": {
            "id": "t1",
            "title": "Vídeo existente",
            "source": "YOUTUBE",
            "summary": "Resumo pronto.",
            "text_preview": "Resumo pronto.",
        },
        "message": "Esse vídeo já está na biblioteca.",
    }
    publish.assert_not_awaited()


async def test_transcribe_video_returns_duplicate_job(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        tools.voxen_settings, "get_default_x_analysis_model", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(
        tools.db,
        "create_transcribe_job",
        AsyncMock(return_value={"duplicate": "job", "id": "job1", "status": "RUNNING"}),
    )
    publish = AsyncMock()
    monkeypatch.setattr(tools.redis_pub, "publish_new_job", publish)

    result = await tools.execute_tool(
        "transcribe_video",
        {"url": "https://youtu.be/dQw4w9WgXcQ", "wait": False},
        "user1",
    )

    assert result["status"] == "already_queued"
    assert result["job_id"] == "job1"
    assert result["job_status"] == "RUNNING"
    publish.assert_not_awaited()


async def test_transcribe_video_uses_x_analysis_model_for_x_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create_x_job = AsyncMock(
        return_value={
            "id": "xjob1",
            "status": "QUEUED",
            "sourceUrl": "https://x.com/i/status/123456789012345",
        }
    )
    monkeypatch.setattr(
        tools.voxen_settings,
        "get_default_x_analysis_model",
        AsyncMock(return_value="x-ai/grok-4"),
    )
    monkeypatch.setattr(tools.db, "create_x_analysis_job", create_x_job)
    publish = AsyncMock()
    monkeypatch.setattr(tools.redis_pub, "publish_new_job", publish)

    result = await tools.execute_tool(
        "transcribe_video",
        {"url": "https://twitter.com/elon/status/123456789012345", "wait": False},
        "user1",
    )

    assert result["status"] == "queued"
    assert result["source_url"] == "https://x.com/i/status/123456789012345"
    create_x_job.assert_awaited_once_with("user1", "https://x.com/i/status/123456789012345")
    publish.assert_awaited_once_with("xjob1")


async def test_transcribe_video_waits_for_completed_job(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        tools.voxen_settings, "get_default_x_analysis_model", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(
        tools.db,
        "create_transcribe_job",
        AsyncMock(
            return_value={
                "id": "job1",
                "status": "QUEUED",
                "sourceUrl": "https://youtu.be/dQw4w9WgXcQ",
            }
        ),
    )
    monkeypatch.setattr(
        tools.db,
        "get_user_job",
        AsyncMock(return_value={"id": "job1", "status": "DONE", "transcriptId": "t1"}),
    )
    monkeypatch.setattr(
        tools.db,
        "get_user_transcript",
        AsyncMock(
            return_value={
                "id": "t1",
                "title": "Vídeo processado",
                "source": "YOUTUBE",
                "summaryMd": "Resumo final.",
                "plainText": "Texto final.",
            }
        ),
    )
    publish = AsyncMock()
    monkeypatch.setattr(tools.redis_pub, "publish_new_job", publish)

    result = await tools.execute_tool(
        "transcribe_video",
        {"url": "https://youtu.be/dQw4w9WgXcQ", "wait_timeout_sec": 5},
        "user1",
    )

    assert result["status"] == "completed"
    assert result["job_id"] == "job1"
    assert result["transcript_id"] == "t1"
    assert result["transcript"]["title"] == "Vídeo processado"
    publish.assert_awaited_once_with("job1")


async def test_transcribe_video_rejects_invalid_url() -> None:
    result = await tools.execute_tool("transcribe_video", {"url": "https://vimeo.com/123"}, "u1")
    assert "error" in result
    assert "URL não suportada" in str(result["error"])


async def test_read_transcript_summary_returns_summary(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        tools.db,
        "get_user_transcript",
        AsyncMock(return_value={"id": "t1", "title": "Título", "summaryMd": "## TL;DR\nResumo"}),
    )

    result = await tools.execute_tool("read_transcript_summary", {"transcript_id": "t1"}, "u1")

    assert result == {"id": "t1", "title": "Título", "summary": "## TL;DR\nResumo"}


async def test_read_transcript_summary_hints_when_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        tools.db,
        "get_user_transcript",
        AsyncMock(return_value={"id": "t1", "title": "Título", "summaryMd": None}),
    )

    result = await tools.execute_tool("read_transcript_summary", {"transcript_id": "t1"}, "u1")

    assert result["summary"] is None
    assert "read_transcript" in str(result["hint"])


async def test_scrape_url_returns_already_indexed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        tools.db,
        "create_scrape_job",
        AsyncMock(return_value={"duplicate": "transcript", "transcript_id": "t1"}),
    )
    publish = AsyncMock()
    monkeypatch.setattr(tools.redis_pub, "publish_new_job", publish)

    result = await tools.execute_tool("scrape_url", {"url": "https://example.com/a#b"}, "u1")

    assert result["status"] == "already_indexed"
    assert result["transcript_id"] == "t1"
    publish.assert_not_awaited()


async def test_scrape_url_returns_already_queued(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        tools.db,
        "create_scrape_job",
        AsyncMock(return_value={"duplicate": "job", "id": "job1"}),
    )
    publish = AsyncMock()
    monkeypatch.setattr(tools.redis_pub, "publish_new_job", publish)

    result = await tools.execute_tool("scrape_url", {"url": "https://example.com/a"}, "u1")

    assert result["status"] == "already_queued"
    assert result["job_id"] == "job1"
    publish.assert_not_awaited()


async def test_scrape_url_queues_normalized_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        tools.db,
        "create_scrape_job",
        AsyncMock(return_value={"id": "job1", "status": "QUEUED"}),
    )
    publish = AsyncMock()
    monkeypatch.setattr(tools.redis_pub, "publish_new_job", publish)

    result = await tools.execute_tool("scrape_url", {"url": "https://example.com/a#frag"}, "u1")

    assert result["status"] == "queued"
    assert result["source_url"] == "https://example.com/a"
    publish.assert_awaited_once_with("job1")
