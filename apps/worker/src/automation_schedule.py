"""Cálculo de próxima execução de automação (timezone-aware).

Espelha apps/web/src/lib/automation-schedule.ts — alterar nos dois lados
juntos. Testes em apps/worker/tests/test_automation_schedule.py.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

Frequency = Literal["DAILY", "WEEKLY", "MONTHLY"]


def compute_next_run(
    *,
    frequency: Frequency,
    hour: int,
    minute: int,
    day_of_week: int | None = None,  # 0=segunda..6=domingo
    day_of_month: int | None = None,  # 1-31 (clampa último dia do mês)
    timezone: str = "America/Sao_Paulo",
    from_dt: datetime | None = None,
) -> datetime:
    """Retorna o próximo datetime UTC em que a regra dispara, estritamente
    depois de `from_dt` (default = agora UTC)."""
    if from_dt is None:
        from_dt = datetime.now(UTC)
    elif from_dt.tzinfo is None:
        from_dt = from_dt.replace(tzinfo=UTC)

    tz = ZoneInfo(timezone)
    local_now = from_dt.astimezone(tz)

    # Constrói candidato local no dia corrente
    candidate_local = local_now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate_local <= local_now:
        candidate_local += timedelta(days=1)

    if frequency == "DAILY":
        return candidate_local.astimezone(UTC)

    if frequency == "WEEKLY":
        target = day_of_week if day_of_week is not None else 0
        # Python: Monday=0..Sunday=6 — bate com a nossa convenção
        while candidate_local.weekday() != target:
            candidate_local += timedelta(days=1)
        return candidate_local.astimezone(UTC)

    # MONTHLY
    wanted = day_of_month if day_of_month is not None else 1
    # Primeiro tenta no mês corrente
    year = candidate_local.year
    month = candidate_local.month
    attempt_day = _clamp_day_of_month(year, month, wanted)
    candidate_local = candidate_local.replace(
        year=year, month=month, day=attempt_day, hour=hour, minute=minute, second=0, microsecond=0
    )
    if candidate_local <= local_now:
        # Avança pro próximo mês
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1
        attempt_day = _clamp_day_of_month(year, month, wanted)
        candidate_local = candidate_local.replace(year=year, month=month, day=attempt_day)
    return candidate_local.astimezone(UTC)


def _clamp_day_of_month(year: int, month: int, wanted: int) -> int:
    """Retorna o `wanted` clampado para o último dia válido do mês."""
    # Último dia: vai pro próximo mês e volta um dia
    if month == 12:
        next_month_first = datetime(year + 1, 1, 1)
    else:
        next_month_first = datetime(year, month + 1, 1)
    last_day = (next_month_first - timedelta(days=1)).day
    return max(1, min(wanted, last_day))
