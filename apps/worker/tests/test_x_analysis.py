from __future__ import annotations

from typing import Any

import httpx

from src.x_analysis import analyze_x_url, looks_unavailable, split_access_verdict


class XContentClient:
    def __init__(self, content: str) -> None:
        self.content = content
        self.payload: dict[str, Any] | None = None

    async def post(
        self,
        url: str,
        *,
        headers: dict[str, str],
        json: dict[str, Any],
    ) -> httpx.Response:
        assert headers["Authorization"] == "Bearer sk-test"
        self.payload = json
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": self.content}}],
                "usage": {"cost": "0.001", "prompt_tokens": 12, "completion_tokens": 8},
            },
        )


async def test_analyze_x_url_uses_native_x_search_with_media_understanding() -> None:
    client = XContentClient("Resumo do post")

    result = await analyze_x_url(
        url="https://x.com/i/status/1234567890",
        api_key="sk-test",
        model="x-ai/grok-4-fast",
        client=client,  # type: ignore[arg-type]
    )

    assert result.text == "Resumo do post"
    # Sem marcador de veredito e sem frase de falha: assume acesso.
    assert result.accessible is True
    assert client.payload is not None
    assert client.payload["tools"] == [
        {
            "type": "openrouter:web_search",
            "parameters": {"engine": "native", "max_uses": 1},
        }
    ]
    assert client.payload["max_tool_calls"] == 1
    assert "plugins" not in client.payload
    assert client.payload["x_search_filter"] == {
        "enable_image_understanding": True,
        "enable_video_understanding": True,
    }


async def test_analyze_x_url_grounds_analysis_on_captured_content() -> None:
    client = XContentClient("## Em poucas linhas\nAnálise ancorada na captura.")

    result = await analyze_x_url(
        url="https://x.com/i/status/1234567890",
        api_key="sk-test",
        model="x-ai/grok-4-fast",
        post_context="Autor: rico (@_heyrico)\nTexto do post:\nProduct design cheat sheet",
        client=client,  # type: ignore[arg-type]
    )

    assert client.payload is not None
    assert "tools" not in client.payload
    assert "max_tool_calls" not in client.payload
    assert "x_search_filter" not in client.payload
    messages = str(client.payload["messages"])
    assert "Product design cheat sheet" in messages
    assert "Conteúdo capturado" in messages
    # Sem veredito e sem frase de falha: acesso assumido; a captura é a evidência.
    assert result.accessible is True
    assert result.verdict_missing is False
    assert result.text == "## Em poucas linhas\nAnálise ancorada na captura."


async def test_analyze_x_url_rejects_failure_wording_even_with_capture() -> None:
    client = XContentClient("Não consegui acessar o post pelas ferramentas disponíveis.")

    result = await analyze_x_url(
        url="https://x.com/i/status/1234567890",
        api_key="sk-test",
        model="x-ai/grok-4-fast",
        post_context="Autor: rico (@_heyrico)\nTexto do post:\nProduct design cheat sheet",
        client=client,  # type: ignore[arg-type]
    )

    assert result.accessible is False


async def test_analyze_x_url_strips_ok_verdict_from_content() -> None:
    client = XContentClient("ACESSO: OK\n\n## Em poucas linhas\nPost recuperado na busca.")

    result = await analyze_x_url(
        url="https://x.com/i/status/1234567890",
        api_key="sk-test",
        model="x-ai/grok-4-fast",
        client=client,  # type: ignore[arg-type]
    )

    assert result.accessible is True
    assert result.text == "## Em poucas linhas\nPost recuperado na busca."


async def test_analyze_x_url_ok_verdict_without_body_is_empty_content() -> None:
    client = XContentClient("ACESSO: OK")

    result = await analyze_x_url(
        url="https://x.com/i/status/1234567890",
        api_key="sk-test",
        model="x-ai/grok-4-fast",
        client=client,  # type: ignore[arg-type]
    )

    assert result.accessible is True
    assert result.text == ""


async def test_analyze_x_url_flags_unavailable_verdict() -> None:
    client = XContentClient("ACESSO: INDISPONIVEL\n\nNão localizei o post.")

    result = await analyze_x_url(
        url="https://x.com/i/status/1234567890",
        api_key="sk-test",
        model="x-ai/grok-4-fast",
        client=client,  # type: ignore[arg-type]
    )

    assert result.accessible is False


async def test_analyze_x_url_detects_missing_verdict_failure_wording() -> None:
    client = XContentClient(
        "O post não estava acessível pelas ferramentas disponíveis; "
        "não foi possível recuperar o texto."
    )

    result = await analyze_x_url(
        url="https://x.com/i/status/1234567890",
        api_key="sk-test",
        model="x-ai/grok-4-fast",
        client=client,  # type: ignore[arg-type]
    )

    assert result.accessible is False
    assert result.verdict_missing is True


def test_split_access_verdict_handles_case_and_missing_line() -> None:
    assert split_access_verdict("acesso: ok\n\ncorpo") == (True, "corpo")
    assert split_access_verdict("ACESSO: INDISPONIVEL\ncorpo") == (False, "corpo")
    assert split_access_verdict("## Título\ncorpo") == (None, "## Título\ncorpo")


def test_looks_unavailable_ignores_generic_caveats() -> None:
    assert looks_unavailable("Resumo do post. Não foi possível verificar a data exata.") is False
    assert looks_unavailable("The page is not accessible without login.") is False
    assert looks_unavailable("The post is not accessible without login.") is True
