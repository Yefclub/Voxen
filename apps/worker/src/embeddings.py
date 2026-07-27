"""Embeddings opt-in via OpenRouter (spec 104). Sem pgvector."""

from __future__ import annotations

from typing import Any

import httpx

from . import openrouter

OR_BASE_URL = openrouter.OR_BASE_URL
DEFAULT_EMBED_MODEL = "openai/text-embedding-3-small"
MAX_CHARS = 8_000


async def embed_text(
    *,
    text: str,
    api_key: str,
    model: str = DEFAULT_EMBED_MODEL,
    client: httpx.AsyncClient | None = None,
) -> list[float]:
    clean = (text or "").strip().replace("\x00", " ")[:MAX_CHARS]
    if len(clean) < 20:
        return []
    payload = {"model": model, "input": clean}
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/Yefclub/Voxen",
        "X-Title": "Voxen Embeddings",
    }
    owns = client is None
    http = client or httpx.AsyncClient(timeout=60.0)
    try:
        res = await http.post(f"{OR_BASE_URL}/embeddings", headers=headers, json=payload)
        if res.status_code in (401, 403):
            raise openrouter.OpenrouterAuthError(res.text[:200])
        if res.status_code >= 500:
            raise openrouter.OpenrouterTransientError(res.text[:200])
        res.raise_for_status()
        data: dict[str, Any] = res.json()
    finally:
        if owns:
            await http.aclose()
    rows = data.get("data") or []
    if not rows:
        return []
    vector = rows[0].get("embedding")
    if not isinstance(vector, list):
        return []
    return [float(x) for x in vector if isinstance(x, (int, float))]
