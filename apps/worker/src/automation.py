"""Pipeline de execução de automação (spec 008).

Componentes:
- scheduler_tick: varre Automation ACTIVE com nextRunAt <= NOW(), cria
  AutomationRun PENDING e enfileira via Redis.
- process_run: claim PENDING e marca FAILED — runtime do agente vivia em
  apps/chat (removido). CRUD/scheduler preservados; reimplementação futura.
- Reconciliation: pega AutomationRun status=PENDING órfãos.
"""

from __future__ import annotations

from datetime import UTC, datetime

import structlog

from . import db, events
from .automation_schedule import compute_next_run

log = structlog.get_logger(__name__)

AUTOMATION_AGENT_REMOVED_MSG = (
    "Agente de automação removido (apps/chat). "
    "Use o MCP server (/mcp) como interface de agente por enquanto."
)


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
                    run_id,
                    a["id"],
                    a["userId"],
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
    """Claim PENDING → FAILED: runtime do agente (apps/chat) foi removido.

    Mantemos scheduler + CRUD + tabelas. Entrega Telegram e call HTTP ao
    chat service saíram com o serviço. Reimplementação futura via MCP/worker.
    """
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

    log.warning(
        "automation-run-agent-removed",
        run_id=run_id,
        automation_id=claimed["automationId"],
    )
    await _mark_failed(run_id, AUTOMATION_AGENT_REMOVED_MSG)


async def _mark_failed(run_id: str, error_msg: str) -> None:
    async with db.connection() as conn:
        await conn.execute(
            """
            UPDATE "AutomationRun"
            SET status = 'FAILED', "finishedAt" = NOW(), "errorMessage" = $2
            WHERE id = $1
            """,
            run_id,
            error_msg[:1000],
        )
    log.warning("automation-run-failed", run_id=run_id, error=error_msg[:200])
