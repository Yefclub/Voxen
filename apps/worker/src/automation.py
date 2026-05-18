"""Pipeline de execução de automação (spec 008).

Componentes:
- scheduler_tick: varre Automation ACTIVE com nextRunAt <= NOW(), cria
  AutomationRun PENDING e enfileira via Redis.
- process_run: pega um run PENDING, chama chat:8001/automation/run, salva
  output + custos, dispara Telegram se aplicável.
- Reconciliation: pega AutomationRun status=PENDING órfãos.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from decimal import Decimal

import httpx
import structlog

from . import db, events
from .automation_schedule import compute_next_run

log = structlog.get_logger(__name__)

CHAT_SERVICE_URL = os.environ.get("CHAT_SERVICE_URL", "http://chat:8001")
AUTOMATION_TIMEOUT_SEC = 300.0  # 5 min — tools podem demorar (web_search etc)
TELEGRAM_TRUNCATE = 4000


async def scheduler_tick() -> int:
    """Varre automações ACTIVE com nextRunAt vencido. Cria AutomationRun
    pendente, recalcula nextRunAt, publica no Redis pra processamento.
    Retorna a quantidade de runs criadas."""
    now = datetime.now(UTC).replace(tzinfo=None)
    created_count = 0
    async with db.connection() as conn:
        async with conn.transaction():
            rows = await conn.fetch(
                """
                SELECT id, "userId", frequency, hour, minute, "dayOfWeek",
                       "dayOfMonth", timezone
                FROM "Automation"
                WHERE status = 'ACTIVE'
                  AND "nextRunAt" IS NOT NULL
                  AND "nextRunAt" <= $1
                ORDER BY "nextRunAt" ASC
                LIMIT 50
                FOR UPDATE SKIP LOCKED
                """,
                now,
            )
            for a in rows:
                run_id = db.generate_cuid()
                await conn.execute(
                    """
                    INSERT INTO "AutomationRun"
                        (id, "automationId", "userId", status, "createdAt", "triggeredBy")
                    VALUES ($1, $2, $3, 'PENDING', NOW(), 'scheduler')
                    """,
                    run_id, a["id"], a["userId"],
                )
                # Recalcula próximo run
                next_run = None
                schedule_error = False
                try:
                    next_run = compute_next_run(
                        frequency=a["frequency"],
                        hour=a["hour"],
                        minute=a["minute"],
                        day_of_week=a["dayOfWeek"],
                        day_of_month=a["dayOfMonth"],
                        timezone=a["timezone"],
                        from_dt=datetime.now(UTC),
                    )
                except Exception:  # noqa: BLE001
                    log.exception(
                        "compute-next-run-failed",
                        automation_id=a["id"],
                        timezone=a["timezone"],
                    )
                    schedule_error = True
                if schedule_error:
                    # Timezone inválido ou outro erro de schedule → pausa a
                    # automação em vez de deixar com nextRunAt=NULL (que
                    # parece "ACTIVE mas sem agendar" — confuso pro user).
                    await conn.execute(
                        """
                        UPDATE "Automation"
                        SET status = 'PAUSED', "nextRunAt" = NULL,
                            "lastRunAt" = NOW(), "updatedAt" = NOW()
                        WHERE id = $1
                        """,
                        a["id"],
                    )
                else:
                    await conn.execute(
                        """
                        UPDATE "Automation"
                        SET "lastRunAt" = NOW(), "nextRunAt" = $2, "updatedAt" = NOW()
                        WHERE id = $1
                        """,
                        a["id"],
                        next_run.replace(tzinfo=None) if next_run else None,
                    )
                created_count += 1
                # Publica fora da transação seria mais correto, mas Redis
                # publish é best-effort — reconciliation pega o que falhar.
                try:
                    client = await events.get_redis()
                    await client.publish(events.AUTOMATION_RUN_CHANNEL, run_id)
                except Exception:  # noqa: BLE001
                    log.exception("automation-run-publish-failed", run_id=run_id)
    if created_count:
        log.info("automations-scheduled", count=created_count)
    return created_count


async def list_pending_run_ids(limit: int = 10) -> list[str]:
    """Reconciliation: pega AutomationRun status=PENDING órfãos."""
    async with db.connection() as conn:
        rows = await conn.fetch(
            """
            SELECT id FROM "AutomationRun"
            WHERE status = 'PENDING'
            ORDER BY "createdAt" ASC
            LIMIT $1
            """,
            limit,
        )
    return [r["id"] for r in rows]


# Runs em RUNNING há mais que isto sem terminar são consideradas órfãs
# (worker crashou entre claim e finish). AUTOMATION_TIMEOUT_SEC é 300s, então
# 900s = 15min dá folga generosa pra latência de OR + tools.
STALE_RUNNING_THRESHOLD_SEC = 900


async def reap_stale_running_runs() -> int:
    """Marca como FAILED runs presas em RUNNING há mais que o threshold.
    Evita que crash do worker (OOM, SIGKILL, container restart entre claim
    e write final) deixe runs zumbis sem feedback pro user.

    Retorna a quantidade de runs marcadas.
    """
    async with db.connection() as conn:
        result = await conn.fetch(
            """
            UPDATE "AutomationRun"
            SET status = 'FAILED',
                "finishedAt" = NOW(),
                "errorMessage" = 'Timeout — worker pode ter crashado durante o processamento.'
            WHERE status = 'RUNNING'
              AND "startedAt" IS NOT NULL
              AND "startedAt" < NOW() - ($1 || ' seconds')::interval
            RETURNING id
            """,
            str(STALE_RUNNING_THRESHOLD_SEC),
        )
    if result:
        log.warning("automation-stale-running-reaped", count=len(result))
    return len(result)


async def process_run(run_id: str) -> None:
    """Pega um AutomationRun pelo id, executa via chat service, persiste
    resultado + custos + delivery Telegram."""
    # Claim atomicamente: PENDING → RUNNING
    async with db.connection() as conn:
        claimed = await conn.fetchrow(
            """
            UPDATE "AutomationRun"
            SET status = 'RUNNING', "startedAt" = NOW()
            WHERE id = $1 AND status = 'PENDING'
            RETURNING id, "automationId", "userId"
            """,
            run_id,
        )
    if not claimed:
        log.info("automation-run-skipped-not-pending", run_id=run_id)
        return

    # Busca automation + user details
    async with db.connection() as conn:
        a = await conn.fetchrow(
            """
            SELECT a.id, a."userId", a.name, a.type, a.prompt, a.delivery,
                   a.timezone, u.name AS user_name, tl."chatId" AS telegram_chat_id
            FROM "Automation" a
            JOIN "User" u ON u.id = a."userId"
            LEFT JOIN "TelegramLink" tl ON tl."userId" = a."userId"
            WHERE a.id = $1
            """,
            claimed["automationId"],
        )
    if not a:
        await _mark_failed(run_id, "Automação não encontrada (deletada?)")
        return

    log.info("automation-run-starting", run_id=run_id, type=a["type"])
    try:
        async with httpx.AsyncClient(timeout=AUTOMATION_TIMEOUT_SEC) as client:
            res = await client.post(
                f"{CHAT_SERVICE_URL}/automation/run",
                headers={"X-Voxen-User-Id": a["userId"]},
                json={
                    "automation_type": a["type"],
                    "prompt": a["prompt"],
                    "automation_id": a["id"],
                    "user_name": a["user_name"] or "usuário",
                    "user_timezone": a["timezone"],
                },
            )
        if res.status_code != 200:
            await _mark_failed(
                run_id,
                f"Chat service retornou {res.status_code}: {res.text[:200]}",
            )
            return
        data = res.json()
    except Exception as e:  # noqa: BLE001
        log.exception("automation-run-http-failed", run_id=run_id)
        await _mark_failed(run_id, f"Falha de rede: {e}")
        return

    output_md = data.get("output_md", "")
    tokens_in = int(data.get("tokens_in", 0) or 0)
    tokens_out = int(data.get("tokens_out", 0) or 0)
    note_id = data.get("note_id")
    try:
        cost_usd = Decimal(str(data.get("cost_usd", "0")))
    except (ValueError, ArithmeticError):
        cost_usd = Decimal("0")

    async with db.connection() as conn:
        await conn.execute(
            """
            UPDATE "AutomationRun"
            SET status = 'SUCCESS', "finishedAt" = NOW(),
                "outputMd" = $2, "tokensIn" = $3, "tokensOut" = $4,
                "costUsd" = $5, "noteId" = $6
            WHERE id = $1
            """,
            run_id, output_md, tokens_in, tokens_out, cost_usd, note_id,
        )
    log.info("automation-run-success", run_id=run_id, tokens_in=tokens_in, tokens_out=tokens_out)

    # Delivery Telegram (opcional)
    if a["delivery"] in ("TELEGRAM", "BOTH") and a["telegram_chat_id"]:
        await _send_telegram(
            chat_id=a["telegram_chat_id"],
            automation_name=a["name"],
            output_md=output_md,
            run_id=run_id,
        )


async def _mark_failed(run_id: str, error_msg: str) -> None:
    async with db.connection() as conn:
        await conn.execute(
            """
            UPDATE "AutomationRun"
            SET status = 'FAILED', "finishedAt" = NOW(), "errorMessage" = $2
            WHERE id = $1
            """,
            run_id, error_msg[:1000],
        )
    log.warning("automation-run-failed", run_id=run_id, error=error_msg[:200])


async def _send_telegram(
    *,
    chat_id: int,
    automation_name: str,
    output_md: str,
    run_id: str,
) -> None:
    """Envia output_md ao chat_id via bot Telegram. Best-effort — falha
    não marca a run como FAILED (output já foi salvo)."""
    # Bot token via setting cifrado
    from . import voxen_settings

    token = await voxen_settings.get_telegram_bot_token()
    if not token:
        log.warning("telegram-send-skipped-no-token", run_id=run_id)
        return

    truncated = output_md
    if len(truncated) > TELEGRAM_TRUNCATE:
        truncated = truncated[:TELEGRAM_TRUNCATE] + "\n\n...(truncado)"
    message = f"📋 *{automation_name}*\n\n{truncated}"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={
                    "chat_id": chat_id,
                    "text": message,
                    "parse_mode": "Markdown",
                    "disable_web_page_preview": True,
                },
            )
        if res.status_code == 200:
            async with db.connection() as conn:
                await conn.execute(
                    'UPDATE "AutomationRun" SET "telegramSent" = TRUE WHERE id = $1',
                    run_id,
                )
            log.info("telegram-sent", run_id=run_id, chat_id=chat_id)
        else:
            log.warning(
                "telegram-send-non-200",
                run_id=run_id,
                status=res.status_code,
                body=res.text[:200],
            )
    except Exception:  # noqa: BLE001
        log.exception("telegram-send-failed", run_id=run_id)
