"""Voxen Chat — FastAPI + Agno entrypoint.

Implementação completa virá em PRs subsequentes conforme .specs/.
MVP atual: apenas /health pra CI funcionar.
"""

from fastapi import FastAPI

app = FastAPI(title="Voxen Chat", version="0.0.0")


@app.get("/health")
async def health() -> dict[str, object]:
    return {"ok": True, "service": "chat"}
