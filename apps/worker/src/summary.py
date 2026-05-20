"""Best-effort summary do Transcript via chat service.

Worker (pipeline vídeo e scrape_pipeline web) chama esta função após persistir
o Transcript. O chat service é o owner único do prompt + chamada OpenRouter,
e grava `summaryMd` + CostEvent.

Falhas viram warning e NÃO bloqueiam o Job — summary é melhoria, não pré-req.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

from . import db, voxen_settings
from .cancellation import is_cancelled


async def maybe_generate(
    *,
    user_id: str,
    transcript_id: str,
    job_id: str,
    log: Any,  # noqa: ANN401
) -> None:
    # Respeita cancel pedido entre link_job_done e o summary (janela curta).
    if is_cancelled(job_id):
        log.info("summary-skipped-cancelled")
        return
    try:
        async with db.connection() as conn:
            row = await conn.fetchrow(
                'SELECT title, "plainText" FROM "Transcript" WHERE id = $1',
                transcript_id,
            )
        if not row or not row["plainText"]:
            log.info("summary-skipped-empty-text")
            return

        chat_url = os.environ.get("CHAT_SERVICE_URL", "http://chat:8001")
        timeout = await voxen_settings.get_summary_timeout_sec()
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(
                f"{chat_url}/summarize-transcript",
                headers={"X-Voxen-User-Id": user_id},
                json={
                    "transcript_id": transcript_id,
                    "title": row["title"],
                    "plain_text": row["plainText"],
                },
            )
        if res.status_code != 200:
            log.warning(
                "summary-upstream-non-200",
                status=res.status_code,
                body=res.text[:200],
            )
            return
        data = res.json()
        if data.get("summary_md"):
            log.info("summary-done", transcript_id=transcript_id)
        else:
            log.info("summary-empty")
    except Exception:  # noqa: BLE001 — resumo é melhoria, não bloqueia
        log.exception("summary-failed", transcript_id=transcript_id)
