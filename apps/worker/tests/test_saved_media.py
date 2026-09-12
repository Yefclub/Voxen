from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import cast
from unittest.mock import AsyncMock, Mock

import asyncpg
import pytest

from src import pipeline, saved_media, saved_media_db, ytdl
from src.job_lease import JobLeaseToken, activate_job_lease


@pytest.mark.asyncio
async def test_download_media_is_single_item_and_enforces_byte_limit(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    captured: dict[str, object] = {}

    async def fake_options(**_kwargs: object) -> dict[str, object]:
        return {"proxy": "http://proxy.example"}

    async def fake_download(_url: str, opts: dict[str, object], *, user_id: str) -> None:
        captured.update(opts)
        assert user_id == "user-1"
        (tmp_path / "video.mp4").write_bytes(b"media")

    monkeypatch.setattr(ytdl, "_runtime_options", fake_options)
    monkeypatch.setattr(ytdl, "_download_with_cookies", fake_download)

    result = await saved_media.download_media(
        "https://youtu.be/abcdefghijk",
        tmp_path,
        user_id="user-1",
        max_size=10,
    )

    assert result.name == "video.mp4"
    assert captured["noplaylist"] is True
    assert captured["max_filesize"] == 10
    hooks = captured["progress_hooks"]
    assert isinstance(hooks, list)
    with pytest.raises(RuntimeError, match="SAVED_MEDIA_TOO_LARGE"):
        hooks[0]({"downloaded_bytes": 11})


@pytest.mark.asyncio
async def test_saved_media_pipeline_persists_metadata_and_durable_steps(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    media_id = "11111111-1111-4111-8111-111111111111"
    monkeypatch.setattr(
        saved_media.saved_media_db,
        "get",
        AsyncMock(
            return_value={
                "id": media_id,
                "sourceUrl": "https://youtu.be/abcdefghijk",
                "canonicalUrl": "https://youtu.be/abcdefghijk",
                "status": "QUEUED",
            }
        ),
    )
    monkeypatch.setattr(
        saved_media.saved_media_db, "mark_downloading", AsyncMock(return_value=True)
    )
    complete = AsyncMock()
    monkeypatch.setattr(saved_media.saved_media_db, "complete_download", complete)
    publish = AsyncMock()
    monkeypatch.setattr(saved_media.events, "publish_job_event", publish)
    monkeypatch.setattr(
        pipeline.ytdl,
        "probe",
        AsyncMock(
            return_value=ytdl.VideoProbe(
                video_id="abcdefghijk",
                title="Saved title",
                channel="Channel",
                duration_sec=42,
                published_at=None,
                thumbnail_url="https://example.com/thumb.jpg",
                language_hint=None,
                available_subtitles={},
                automatic_captions={},
                author="Author",
                canonical_url="https://youtu.be/abcdefghijk",
            )
        ),
    )

    async def fake_download(_url: str, out_dir: Path, *, user_id: str, max_size: int) -> Path:
        assert user_id == "user-1"
        assert max_size >= 50 * 1024 * 1024
        target = out_dir / "abcdefghijk.mp4"
        target.write_bytes(b"saved-media")
        return target

    monkeypatch.setattr(saved_media, "download_media", fake_download)
    monkeypatch.setattr(saved_media.storage, "put_file", AsyncMock())

    await saved_media.run_download(
        job_id="job-1",
        user_id="user-1",
        media_id=media_id,
        log=Mock(),
        retry_transient=pipeline._retry_transient,
        check_cancel=pipeline._check_cancel,
    )

    assert [call.args[2] for call in publish.await_args_list] == [
        "probing_media",
        "downloading_media",
        "storing_media",
        "media_ready",
        "done",
    ]
    assert complete.await_args.kwargs["filename"] == "Saved_title.mp4"
    assert complete.await_args.kwargs["job_id"] == "job-1"
    assert complete.await_args.kwargs["object_key"].startswith(
        f"workspaces/user-1/uploads/{media_id}/"
    )
    assert complete.await_args.kwargs["byte_size"] == len(b"saved-media")


@pytest.mark.asyncio
async def test_saved_media_cancellation_after_storage_removes_partial_object(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    media_id = "22222222-2222-4222-8222-222222222222"
    monkeypatch.setattr(
        saved_media.saved_media_db,
        "get",
        AsyncMock(
            return_value={
                "id": media_id,
                "sourceUrl": "https://youtu.be/abcdefghijk",
                "canonicalUrl": "https://youtu.be/abcdefghijk",
                "status": "QUEUED",
            }
        ),
    )
    monkeypatch.setattr(
        saved_media.saved_media_db, "mark_downloading", AsyncMock(return_value=True)
    )
    complete = AsyncMock()
    monkeypatch.setattr(saved_media.saved_media_db, "complete_download", complete)
    monkeypatch.setattr(saved_media.events, "publish_job_event", AsyncMock())
    monkeypatch.setattr(
        pipeline.ytdl,
        "probe",
        AsyncMock(
            return_value=ytdl.VideoProbe(
                video_id="abcdefghijk",
                title="Saved title",
                channel=None,
                duration_sec=42,
                published_at=None,
                thumbnail_url=None,
                language_hint=None,
                available_subtitles={},
                automatic_captions={},
            )
        ),
    )

    async def fake_download(_url: str, out_dir: Path, **_kwargs: object) -> Path:
        target = out_dir / "abcdefghijk.mp4"
        target.write_bytes(b"saved-media")
        return target

    monkeypatch.setattr(saved_media, "download_media", fake_download)
    monkeypatch.setattr(saved_media.storage, "put_file", AsyncMock())
    delete_object = AsyncMock()
    monkeypatch.setattr(saved_media.storage, "delete_object", delete_object)
    checks = 0

    def cancel_after_storage(_job_id: str) -> None:
        nonlocal checks
        checks += 1
        if checks == 4:
            raise saved_media.CancelledException

    with pytest.raises(saved_media.CancelledException):
        await saved_media.run_download(
            job_id="job-2",
            user_id="user-1",
            media_id=media_id,
            log=Mock(),
            retry_transient=pipeline._retry_transient,
            check_cancel=cancel_after_storage,
        )

    complete.assert_not_awaited()
    delete_object.assert_awaited_once()


@pytest.mark.asyncio
async def test_terminal_event_failure_does_not_revert_completed_media(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    media_id = "33333333-3333-4333-8333-333333333333"
    monkeypatch.setattr(
        saved_media.saved_media_db,
        "get",
        AsyncMock(
            return_value={
                "id": media_id,
                "sourceUrl": "https://youtu.be/abcdefghijk",
                "canonicalUrl": "https://youtu.be/abcdefghijk",
                "status": "QUEUED",
            }
        ),
    )
    monkeypatch.setattr(
        saved_media.saved_media_db, "mark_downloading", AsyncMock(return_value=True)
    )
    complete = AsyncMock()
    monkeypatch.setattr(saved_media.saved_media_db, "complete_download", complete)
    publish = AsyncMock(side_effect=[None, None, None, RuntimeError("redis unavailable")])
    monkeypatch.setattr(saved_media.events, "publish_job_event", publish)
    monkeypatch.setattr(
        pipeline.ytdl,
        "probe",
        AsyncMock(
            return_value=ytdl.VideoProbe(
                video_id="abcdefghijk",
                title="Saved title",
                channel=None,
                duration_sec=42,
                published_at=None,
                thumbnail_url=None,
                language_hint=None,
                available_subtitles={},
                automatic_captions={},
            )
        ),
    )

    async def fake_download(_url: str, out_dir: Path, **_kwargs: object) -> Path:
        target = out_dir / "abcdefghijk.mp4"
        target.write_bytes(b"saved-media")
        return target

    monkeypatch.setattr(saved_media, "download_media", fake_download)
    monkeypatch.setattr(saved_media.storage, "put_file", AsyncMock())

    await saved_media.run_download(
        job_id="job-3",
        user_id="user-1",
        media_id=media_id,
        log=Mock(),
        retry_transient=pipeline._retry_transient,
        check_cancel=pipeline._check_cancel,
    )

    complete.assert_awaited_once()
    assert publish.await_count == 4


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("job_type", "terminal_status", "expected_status"),
    [
        ("DOWNLOAD_MEDIA", "FAILED", "DOWNLOADING"),
        ("UPLOAD_AND_TRANSCRIBE", "READY", "PROCESSING"),
    ],
)
async def test_job_and_saved_media_fail_atomically_under_the_same_lease(
    monkeypatch: pytest.MonkeyPatch,
    job_type: str,
    terminal_status: str,
    expected_status: str,
) -> None:
    class Connection:
        def __init__(self) -> None:
            self.calls: list[tuple[str, tuple[object, ...]]] = []
            self.in_transaction = False

        @asynccontextmanager
        async def transaction(self) -> AsyncIterator[None]:
            self.in_transaction = True
            try:
                yield
            finally:
                self.in_transaction = False

        async def fetchrow(self, query: str, *args: object) -> dict[str, str]:
            assert self.in_transaction
            self.calls.append((query, args))
            return {"type": job_type} if 'UPDATE "Job"' in query else {"id": "media-1"}

    conn = Connection()

    @asynccontextmanager
    async def fake_connection() -> AsyncIterator[asyncpg.Connection]:
        yield cast(asyncpg.Connection, conn)

    monkeypatch.setattr(saved_media_db.db, "connection", fake_connection)
    token = JobLeaseToken("job-1", "worker-1", 2)
    with activate_job_lease(token):
        await saved_media_db.fail_job_and_media("job-1", "user-1", "media-1", "download failed")

    assert len(conn.calls) == 2
    job_query, job_args = conn.calls[0]
    media_query, media_args = conn.calls[1]
    assert '"workerId" = $6 AND attempt = $7' in job_query
    assert job_args[-2:] == ("worker-1", 2)
    assert '$6::"SavedMediaStatus"' in media_query
    assert media_args[2] == terminal_status
    assert media_args[5] == expected_status
