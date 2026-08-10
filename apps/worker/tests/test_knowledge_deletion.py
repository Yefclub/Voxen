from typing import Any
from unittest.mock import AsyncMock, Mock

import pytest

from src import db, events, knowledge_deletion, storage


class FetchConnection:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.rows = rows
        self.query = ""
        self.args: tuple[object, ...] = ()

    async def fetch(self, query: str, *args: object) -> list[dict[str, object]]:
        self.query = query
        self.args = args
        return self.rows


@pytest.mark.asyncio
async def test_storage_cleanup_deduplicates_exact_non_empty_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    remove = AsyncMock()
    monkeypatch.setattr(storage, "delete_object", remove)

    await knowledge_deletion._delete_storage_keys(["a/file.md", None, "a/file.md", "b/video.mp4"])

    assert [call.kwargs["key"] for call in remove.await_args_list] == [
        "a/file.md",
        "b/video.mp4",
    ]


@pytest.mark.asyncio
async def test_owned_note_tree_rejects_cross_workspace_relations() -> None:
    conn = FetchConnection(
        [
            {"id": "note-root", "userId": "user-a"},
            {"id": "note-child", "userId": "user-b"},
        ]
    )

    with pytest.raises(RuntimeError, match="cross-workspace"):
        await knowledge_deletion._owned_tree_ids(conn, "Note", "user-a", "note-root")

    assert 'FROM "Note"' in conn.query
    assert conn.args == ("note-root",)


@pytest.mark.asyncio
async def test_owned_tree_rejects_dynamic_table_names() -> None:
    conn = FetchConnection([])
    with pytest.raises(ValueError, match="unsupported tree table"):
        await knowledge_deletion._owned_tree_ids(conn, 'Note"; DROP TABLE "User', "u", "n")
    assert conn.query == ""


@pytest.mark.asyncio
async def test_run_dispatches_scoped_deletion_and_publishes_durable_stages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    delete_note = AsyncMock()
    publish_job = AsyncMock()
    publish_graph = AsyncMock()
    mark_done = AsyncMock()
    monkeypatch.setattr(knowledge_deletion, "_delete_note", delete_note)
    monkeypatch.setattr(events, "publish_job_event", publish_job)
    monkeypatch.setattr(events, "publish_graph_invalidation", publish_graph)
    monkeypatch.setattr(db, "mark_job_done", mark_done)

    await knowledge_deletion.run(
        job_id="job-1",
        user_id="user-1",
        target_type="NOTE",
        target_id="note-1",
        log=Mock(),
    )

    delete_note.assert_awaited_once_with("job-1", "user-1", "note-1")
    assert [call.args[2] for call in publish_job.await_args_list] == [
        "deleting_content",
        "updating_graph",
        "done",
    ]
    publish_graph.assert_awaited_once_with("user-1")
    mark_done.assert_awaited_once_with("job-1")


@pytest.mark.asyncio
async def test_run_rejects_unknown_target_before_any_side_effect(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    publish_job = AsyncMock()
    monkeypatch.setattr(events, "publish_job_event", publish_job)

    with pytest.raises(ValueError, match="unsupported knowledge deletion target"):
        await knowledge_deletion.run(
            job_id="job-1",
            user_id="user-1",
            target_type="USER",
            target_id="user-2",
            log=Mock(),
        )

    publish_job.assert_not_awaited()


@pytest.mark.asyncio
async def test_graph_cleanup_always_scopes_source_deletes_to_user_and_ids() -> None:
    class GraphConnection:
        def __init__(self) -> None:
            self.fetch_calls: list[tuple[str, tuple[Any, ...]]] = []
            self.execute_calls: list[tuple[str, tuple[Any, ...]]] = []

        async def fetch(self, query: str, *args: object) -> list[dict[str, object]]:
            self.fetch_calls.append((query, args))
            return [{"edgeId": "edge-1"}]

        async def execute(self, query: str, *args: object) -> str:
            self.execute_calls.append((query, args))
            return "DELETE 1"

    conn = GraphConnection()
    await knowledge_deletion._delete_graph_sources(
        conn,
        user_id="owner-1",
        source_type="NOTE",
        source_ids=["note-1", "note-1", "note-2"],
    )

    assert conn.fetch_calls[0][1] == ("owner-1", "NOTE", ["note-1", "note-2"])
    source_delete = next(
        call for call in conn.execute_calls if 'DELETE FROM "BrainSource"' in call[0]
    )
    assert source_delete[1] == ("owner-1", "NOTE", ["note-1", "note-2"])
    edge_delete = next(call for call in conn.execute_calls if 'DELETE FROM "BrainEdge"' in call[0])
    assert "edge.method <> 'manual'" in edge_delete[0]
    assert edge_delete[1] == ("owner-1", ["edge-1"])
