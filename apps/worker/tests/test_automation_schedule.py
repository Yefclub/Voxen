"""Testes pra src/automation_schedule.py — cálculo timezone-aware de cron.

Espelha apps/web/tests/automation-schedule.test.ts. Mudar nos dois lados.
"""

from __future__ import annotations

from datetime import UTC, datetime

from src.automation_schedule import compute_next_run


def utc(iso: str) -> datetime:
    """Cria datetime aware UTC a partir de uma ISO string."""
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(UTC)


# ---------------------------------------------------------------------------
# DAILY
# ---------------------------------------------------------------------------


def test_daily_today_future() -> None:
    # 2026-05-18 14:00 UTC = 11:00 SP. Schedule pra 15:30 SP = 18:30 UTC hoje.
    next_run = compute_next_run(
        frequency="DAILY",
        hour=15,
        minute=30,
        timezone="America/Sao_Paulo",
        from_dt=utc("2026-05-18T14:00:00Z"),
    )
    assert next_run.isoformat() == "2026-05-18T18:30:00+00:00"


def test_daily_today_already_passed_goes_to_tomorrow() -> None:
    # 22:00 UTC = 19:00 SP. Schedule pra 9:00 SP → vai pra amanhã.
    next_run = compute_next_run(
        frequency="DAILY",
        hour=9,
        minute=0,
        timezone="America/Sao_Paulo",
        from_dt=utc("2026-05-18T22:00:00Z"),
    )
    assert next_run.isoformat() == "2026-05-19T12:00:00+00:00"


# ---------------------------------------------------------------------------
# WEEKLY
# ---------------------------------------------------------------------------


def test_weekly_same_week_future_day() -> None:
    # 2026-05-18 = segunda 12:00 UTC = 9:00 SP. Schedule pra quarta 10:00 SP.
    next_run = compute_next_run(
        frequency="WEEKLY",
        hour=10,
        minute=0,
        day_of_week=2,  # quarta
        timezone="America/Sao_Paulo",
        from_dt=utc("2026-05-18T12:00:00Z"),
    )
    # próxima quarta = 2026-05-20 às 10:00 SP = 13:00 UTC
    assert next_run.isoformat() == "2026-05-20T13:00:00+00:00"


def test_weekly_day_already_passed_in_week_next_week() -> None:
    # 2026-05-22 sexta 15:00 UTC = 12:00 SP. Schedule quarta 10:00 SP.
    next_run = compute_next_run(
        frequency="WEEKLY",
        hour=10,
        minute=0,
        day_of_week=2,  # quarta
        timezone="America/Sao_Paulo",
        from_dt=utc("2026-05-22T15:00:00Z"),
    )
    # próxima quarta = 2026-05-27 às 10:00 SP = 13:00 UTC
    assert next_run.isoformat() == "2026-05-27T13:00:00+00:00"


def test_weekly_same_day_but_hour_passed_goes_next_week() -> None:
    # 2026-05-18 segunda 18:00 UTC = 15:00 SP. Schedule segunda 9:00 SP.
    next_run = compute_next_run(
        frequency="WEEKLY",
        hour=9,
        minute=0,
        day_of_week=0,  # segunda
        timezone="America/Sao_Paulo",
        from_dt=utc("2026-05-18T18:00:00Z"),
    )
    # próxima segunda = 2026-05-25 às 9:00 SP = 12:00 UTC
    assert next_run.isoformat() == "2026-05-25T12:00:00+00:00"


# ---------------------------------------------------------------------------
# MONTHLY
# ---------------------------------------------------------------------------


def test_monthly_day_future_in_month() -> None:
    # 2026-05-18 12:00 UTC. Schedule dia 25 às 9:00 SP.
    next_run = compute_next_run(
        frequency="MONTHLY",
        hour=9,
        minute=0,
        day_of_month=25,
        timezone="America/Sao_Paulo",
        from_dt=utc("2026-05-18T12:00:00Z"),
    )
    assert next_run.isoformat() == "2026-05-25T12:00:00+00:00"


def test_monthly_day_already_passed_in_month_next_month() -> None:
    # 2026-05-20 12:00 UTC. Schedule dia 10.
    next_run = compute_next_run(
        frequency="MONTHLY",
        hour=9,
        minute=0,
        day_of_month=10,
        timezone="America/Sao_Paulo",
        from_dt=utc("2026-05-20T12:00:00Z"),
    )
    # 10 de junho às 9:00 SP = 12:00 UTC
    assert next_run.isoformat() == "2026-06-10T12:00:00+00:00"


def test_monthly_day_31_clamp_february() -> None:
    # Jan 15. Próximo dia 31 → 31 jan funciona (jan tem 31 dias)
    next_run = compute_next_run(
        frequency="MONTHLY",
        hour=9,
        minute=0,
        day_of_month=31,
        timezone="America/Sao_Paulo",
        from_dt=utc("2026-01-15T12:00:00Z"),
    )
    assert next_run.isoformat() == "2026-01-31T12:00:00+00:00"


def test_monthly_day_31_clamps_to_last_day_of_april() -> None:
    # 2026-04-01 → dia 31 em abril (que tem 30 dias) clampa pra 30
    next_run = compute_next_run(
        frequency="MONTHLY",
        hour=9,
        minute=0,
        day_of_month=31,
        timezone="America/Sao_Paulo",
        from_dt=utc("2026-04-01T12:00:00Z"),
    )
    assert next_run.isoformat() == "2026-04-30T12:00:00+00:00"


# ---------------------------------------------------------------------------
# UTC fuso identidade
# ---------------------------------------------------------------------------


def test_utc_simple() -> None:
    next_run = compute_next_run(
        frequency="DAILY",
        hour=14,
        minute=30,
        timezone="UTC",
        from_dt=utc("2026-05-18T08:00:00Z"),
    )
    assert next_run.isoformat() == "2026-05-18T14:30:00+00:00"
