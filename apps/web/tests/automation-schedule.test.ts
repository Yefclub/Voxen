import { describe, test, expect } from 'bun:test';
import { computeNextRun } from '../src/lib/automation-schedule';

// Helper: cria Date UTC pra um instante específico.
function utc(iso: string): Date {
  return new Date(iso);
}

describe('computeNextRun — DAILY', () => {
  test('agendado hoje no futuro → retorna hoje', () => {
    // 2026-05-18 14:00 UTC = 11:00 em São Paulo (UTC-3, sem DST)
    const from = utc('2026-05-18T14:00:00Z');
    const next = computeNextRun(
      { frequency: 'DAILY', hour: 15, minute: 30, timezone: 'America/Sao_Paulo' },
      from,
    );
    // 15:30 São Paulo = 18:30 UTC
    expect(next.toISOString()).toBe('2026-05-18T18:30:00.000Z');
  });

  test('agendado hoje já passou → retorna amanhã', () => {
    const from = utc('2026-05-18T22:00:00Z'); // 19:00 SP
    const next = computeNextRun(
      { frequency: 'DAILY', hour: 9, minute: 0, timezone: 'America/Sao_Paulo' },
      from,
    );
    // 9:00 SP de 2026-05-19 = 12:00 UTC
    expect(next.toISOString()).toBe('2026-05-19T12:00:00.000Z');
  });
});

describe('computeNextRun — WEEKLY', () => {
  test('mesma semana, ainda não chegou no dia', () => {
    // 2026-05-18 é segunda-feira (weekday=0 na nossa convenção Mon=0)
    const from = utc('2026-05-18T12:00:00Z'); // segunda 09:00 SP
    const next = computeNextRun(
      {
        frequency: 'WEEKLY',
        hour: 10,
        minute: 0,
        dayOfWeek: 2, // quarta
        timezone: 'America/Sao_Paulo',
      },
      from,
    );
    // próxima quarta = 2026-05-20 às 10:00 SP = 13:00 UTC
    expect(next.toISOString()).toBe('2026-05-20T13:00:00.000Z');
  });

  test('dia já passou nesta semana → vai pra próxima', () => {
    const from = utc('2026-05-22T15:00:00Z'); // sexta 12:00 SP
    const next = computeNextRun(
      {
        frequency: 'WEEKLY',
        hour: 10,
        minute: 0,
        dayOfWeek: 2, // quarta
        timezone: 'America/Sao_Paulo',
      },
      from,
    );
    // próxima quarta = 2026-05-27 às 10:00 SP = 13:00 UTC
    expect(next.toISOString()).toBe('2026-05-27T13:00:00.000Z');
  });

  test('dia igual ao corrente mas hora já passou → próxima semana', () => {
    // 2026-05-18 = segunda 15:00 SP → quer segunda 09:00
    const from = utc('2026-05-18T18:00:00Z');
    const next = computeNextRun(
      {
        frequency: 'WEEKLY',
        hour: 9,
        minute: 0,
        dayOfWeek: 0, // segunda
        timezone: 'America/Sao_Paulo',
      },
      from,
    );
    // próxima segunda = 2026-05-25 às 9:00 SP = 12:00 UTC
    expect(next.toISOString()).toBe('2026-05-25T12:00:00.000Z');
  });
});

describe('computeNextRun — MONTHLY', () => {
  test('dia ainda não chegou no mês', () => {
    const from = utc('2026-05-18T12:00:00Z'); // 09:00 SP
    const next = computeNextRun(
      {
        frequency: 'MONTHLY',
        hour: 9,
        minute: 0,
        dayOfMonth: 25,
        timezone: 'America/Sao_Paulo',
      },
      from,
    );
    // 25 de maio às 9:00 SP = 12:00 UTC
    expect(next.toISOString()).toBe('2026-05-25T12:00:00.000Z');
  });

  test('dia já passou nesse mês → próximo mês', () => {
    const from = utc('2026-05-20T12:00:00Z'); // 09:00 SP
    const next = computeNextRun(
      {
        frequency: 'MONTHLY',
        hour: 9,
        minute: 0,
        dayOfMonth: 10,
        timezone: 'America/Sao_Paulo',
      },
      from,
    );
    // 10 de junho às 9:00 SP = 12:00 UTC
    expect(next.toISOString()).toBe('2026-06-10T12:00:00.000Z');
  });

  test('dia 31 em fevereiro → clampa pro último dia (28)', () => {
    const from = utc('2026-01-15T12:00:00Z');
    const next = computeNextRun(
      {
        frequency: 'MONTHLY',
        hour: 9,
        minute: 0,
        dayOfMonth: 31,
        timezone: 'America/Sao_Paulo',
      },
      from,
    );
    // 2026 não é bissexto → 28 de fev. 9:00 SP = 12:00 UTC
    expect(next.toISOString()).toBe('2026-01-31T12:00:00.000Z');
  });

  test('dia 31 em abril (30 dias) → clampa pro último dia (30)', () => {
    // 2026-04-15 → próximo dia 31 cai em abril, clampa pra 30
    const from = utc('2026-04-01T12:00:00Z');
    const next = computeNextRun(
      {
        frequency: 'MONTHLY',
        hour: 9,
        minute: 0,
        dayOfMonth: 31,
        timezone: 'America/Sao_Paulo',
      },
      from,
    );
    expect(next.toISOString()).toBe('2026-04-30T12:00:00.000Z');
  });
});

describe('computeNextRun — fuso UTC (timezone identidade)', () => {
  test('DAILY simples', () => {
    const from = utc('2026-05-18T08:00:00Z');
    const next = computeNextRun(
      { frequency: 'DAILY', hour: 14, minute: 30, timezone: 'UTC' },
      from,
    );
    expect(next.toISOString()).toBe('2026-05-18T14:30:00.000Z');
  });
});
