"""Testes puros de tags (spec 075/096) — sem rede/DB."""

from __future__ import annotations

from typing import Any

import httpx

from src.tags import generate_content_tags, pick_folder_id, resolve_tags_decision, slugify_tag


def test_slugify_lowercases_and_strips_accents() -> None:
    assert slugify_tag("Anime") == "anime"
    assert slugify_tag("Estúdio Ghibli") == "estudio-ghibli"
    assert slugify_tag("Programação") == "programacao"


def test_slugify_collapses_non_alnum() -> None:
    assert slugify_tag("  Web  Security!! ") == "web-security"
    assert slugify_tag("---") == ""


def test_resolve_json_array() -> None:
    assert resolve_tags_decision('["Anime","Review"]', []) == ["Anime", "Review"]


def test_resolve_fenced_and_object() -> None:
    assert resolve_tags_decision('```json\n["Elden Ring","RPG"]\n```', []) == [
        "Elden Ring",
        "RPG",
    ]
    assert resolve_tags_decision('{"tags":["TypeScript","Bun"]}', []) == [
        "TypeScript",
        "Bun",
    ]


def test_resolve_lines_commas() -> None:
    assert resolve_tags_decision("- Anime\n- Review", []) == ["Anime", "Review"]
    assert resolve_tags_decision("Anime, Review, Estúdio Ghibli", []) == [
        "Anime",
        "Review",
        "Estúdio Ghibli",
    ]


def test_resolve_dedup_and_reuse_existing() -> None:
    assert resolve_tags_decision('["Anime","anime","ANIME"]', []) == ["Anime"]
    assert resolve_tags_decision('["anime","review"]', ["Anime", "Review"]) == [
        "Anime",
        "Review",
    ]


def test_resolve_caps_at_5() -> None:
    assert len(resolve_tags_decision('["a1","b2","c3","d4","e5","f6","g7"]', [])) == 5


def test_resolve_drops_noise() -> None:
    assert resolve_tags_decision('["The content is about anime","Anime"]', []) == ["Anime"]
    assert resolve_tags_decision('["Looking at the content","Docker"]', []) == ["Docker"]
    assert resolve_tags_decision('["Its about driver.js library","API"]', []) == ["API"]
    assert resolve_tags_decision('["conteúdo","misc","various","Anime"]', []) == ["Anime"]
    assert resolve_tags_decision('["a really long tag with too many words here","OK Tag"]', []) == [
        "OK Tag"
    ]


def test_resolve_empty() -> None:
    assert resolve_tags_decision("", []) == []
    assert resolve_tags_decision("none", []) == []


class _CaptureClient:
    def __init__(self) -> None:
        self.payload: dict[str, Any] | None = None

    async def post(
        self,
        _url: str,
        *,
        headers: dict[str, str],
        json: dict[str, Any],
    ) -> httpx.Response:
        assert headers["Authorization"] == "Bearer sk-test"
        self.payload = json
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": '{"tags":["Python","Automação"]}'}}],
                "usage": {"cost": "0.001", "prompt_tokens": 10, "completion_tokens": 5},
            },
        )


async def test_generation_uses_structured_output_without_reasoning() -> None:
    client = _CaptureClient()
    result = await generate_content_tags(
        title="Automação em Python",
        content="Conteúdo longo sobre automações confiáveis escritas em Python.",
        existing_tags=[],
        api_key="sk-test",
        model="x-ai/grok-4.5",
        client=client,  # type: ignore[arg-type]
    )

    assert result.tags == ["Python", "Automação"]
    assert client.payload is not None
    assert client.payload["reasoning"] == {"enabled": False}
    assert client.payload["max_tokens"] >= 256
    response_format = client.payload["response_format"]
    assert isinstance(response_format, dict)
    assert response_format["type"] == "json_schema"


def test_pick_folder_id() -> None:
    assert pick_folder_id("folder-1", "tag-folder-2") == "folder-1"
    assert pick_folder_id(None, "tag-folder-2") == "tag-folder-2"
    assert pick_folder_id(None, None) is None
