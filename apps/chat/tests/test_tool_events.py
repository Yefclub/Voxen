"""Testes do payload SSE `tool_end` — atividade de tools + fontes (spec 026)."""

from __future__ import annotations

from src.main import TOOL_END_MAX_SOURCES, TOOL_END_MAX_TITLE_CHARS, _tool_end_payload


def test_payload_without_sources() -> None:
    payload = _tool_end_payload("read_transcript", {"id": "t1", "title": "Vídeo"})
    assert payload["name"] == "read_transcript"
    assert "sources" not in payload
    assert isinstance(payload["preview"], str)


def test_payload_with_sources_filters_non_http() -> None:
    result = {
        "answer": "ok",
        "sources": [
            {"url": "https://example.com/a", "title": "Artigo A"},
            {"url": "javascript:alert(1)", "title": "xss"},
            {"url": "  ", "title": "vazio"},
            {"url": "http://example.com/b", "title": ""},
            "lixo",
        ],
    }
    payload = _tool_end_payload("web_search", result)
    assert payload["sources"] == [
        {"url": "https://example.com/a", "title": "Artigo A"},
        # Sem título → usa a própria URL.
        {"url": "http://example.com/b", "title": "http://example.com/b"},
    ]


def test_payload_caps_sources_and_title() -> None:
    result = {
        "sources": [{"url": f"https://e.com/{i}", "title": "x" * 999} for i in range(50)],
    }
    payload = _tool_end_payload("web_search", result)
    assert len(payload["sources"]) == TOOL_END_MAX_SOURCES
    assert all(len(s["title"]) == TOOL_END_MAX_TITLE_CHARS for s in payload["sources"])


def test_payload_hitl_keeps_action_summary() -> None:
    payload = _tool_end_payload("request_user_confirmation", {"action_summary": "Criar nota X"})
    assert payload["action_summary"] == "Criar nota X"


def test_payload_non_dict_result() -> None:
    payload = _tool_end_payload("web_search", "erro qualquer")
    assert payload == {"name": "web_search", "preview": '"erro qualquer"'}


# --- _tool_summary (spec 027) ---


def test_summary_error_wins() -> None:
    payload = _tool_end_payload("web_search", {"error": "OpenRouter sem configuração."})
    assert payload["summary"] == "OpenRouter sem configuração."


def test_summary_web_search_counts_sources() -> None:
    result = {"answer": "ok", "sources": [{"url": "https://a.com", "title": "A"}]}
    assert _tool_end_payload("web_search", result)["summary"] == "1 fonte consultada"
    result["sources"].append({"url": "https://b.com", "title": "B"})
    assert _tool_end_payload("web_search", result)["summary"] == "2 fontes consultadas"


def test_summary_web_search_without_sources() -> None:
    assert _tool_end_payload("web_search", {"answer": "ok"})["summary"] == "Pesquisa concluída"


def test_summary_counts_results_and_lists() -> None:
    assert (
        _tool_end_payload("search_transcripts", {"results": [1, 2, 3]})["summary"] == "3 resultados"
    )
    assert _tool_end_payload("list_transcripts", {"transcripts": [1]})["summary"] == "1 transcrição"
    assert _tool_end_payload("list_notes", {"notes": []})["summary"] == "0 notas"


def test_summary_uses_title_including_nested() -> None:
    assert _tool_end_payload("read_transcript", {"title": "Vídeo X"})["summary"] == "Vídeo X"
    nested = {"status": "completed", "transcript": {"title": "Vídeo Y"}}
    assert _tool_end_payload("transcribe_video", nested)["summary"] == "Vídeo Y"


def test_summary_absent_when_no_heuristic_matches() -> None:
    payload = _tool_end_payload("get_metadata", {"id": "x", "metadata": {}})
    assert "summary" not in payload


def test_summary_falls_back_to_message() -> None:
    queued = {"status": "queued", "job_id": "j1", "message": "Job criado. Worker vai processar."}
    assert _tool_end_payload("transcribe_video", queued)["summary"] == (
        "Job criado. Worker vai processar."
    )
