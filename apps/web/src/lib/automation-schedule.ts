// ============================================================================
// Cálculo de próxima execução de automação (timezone-aware).
// ============================================================================
// Espelha a lógica em apps/worker/src/automation_schedule.py — alterar
// nos dois lados juntos. Testes em tests/automation-schedule.test.ts.
// ============================================================================

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface ScheduleInput {
  frequency: Frequency;
  hour: number; // 0-23 no timezone
  minute: number; // 0-59
  dayOfWeek?: number | null; // 0=segunda..6=domingo (WEEKLY)
  dayOfMonth?: number | null; // 1-31 (MONTHLY, clampa último dia)
  timezone: string; // IANA, ex: "America/Sao_Paulo"
}

// Retorna o próximo Date UTC em que a regra dispara, estritamente depois
// de `from`. Estratégia: trabalha no calendário do timezone do user
// avançando o "candidato" até casar a regra, depois converte pra UTC via
// Intl.DateTimeFormat (idempotente em DST porque sempre vamos pra frente
// — não há "duas vezes na mesma hora").
export function computeNextRun(input: ScheduleInput, from: Date = new Date()): Date {
  const { frequency, hour, minute, timezone } = input;
  // Parte do "hoje no tz do user" às HH:MM
  const local = toLocalParts(from, timezone);
  let year = local.year;
  let month = local.month; // 1-12
  let day = local.day;

  // Constrói candidato no calendário local
  let candidate = makeUtcFromLocal(year, month, day, hour, minute, timezone);
  if (candidate <= from) {
    // Já passou hoje — avança 1 dia
    const tomorrow = addDaysLocal(year, month, day, 1);
    year = tomorrow.year;
    month = tomorrow.month;
    day = tomorrow.day;
    candidate = makeUtcFromLocal(year, month, day, hour, minute, timezone);
  }

  if (frequency === 'DAILY') {
    return candidate;
  }

  if (frequency === 'WEEKLY') {
    const target = input.dayOfWeek ?? 0; // 0=segunda..6=domingo
    while (localDayOfWeekMonStart(candidate, timezone) !== target) {
      const next = addDaysLocal(year, month, day, 1);
      year = next.year;
      month = next.month;
      day = next.day;
      candidate = makeUtcFromLocal(year, month, day, hour, minute, timezone);
    }
    return candidate;
  }

  // MONTHLY — pega o dia desejado, clampa pro último do mês se exceder
  const wanted = input.dayOfMonth ?? 1;
  // Primeira tentativa: dia desejado no mês corrente
  let attemptDay = clampDayOfMonth(year, month, wanted);
  candidate = makeUtcFromLocal(year, month, attemptDay, hour, minute, timezone);
  if (candidate <= from) {
    // Já passou esse mês — vai pro próximo
    if (month === 12) {
      year += 1;
      month = 1;
    } else {
      month += 1;
    }
    attemptDay = clampDayOfMonth(year, month, wanted);
    candidate = makeUtcFromLocal(year, month, attemptDay, hour, minute, timezone);
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Helpers — manipulação de calendário local sem libs externas.
// ---------------------------------------------------------------------------

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
}

function toLocalParts(date: Date, timezone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0');
  // hourCycle h23 (00-23) — em alguns runtimes vem '24'; normaliza
  let h = get('hour');
  if (h === 24) h = 0;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: h,
    minute: get('minute'),
  };
}

// Cria um Date UTC tal que, no timezone informado, o calendário mostre
// year/month/day/hour/minute. Usa busca iterativa com o offset do tz
// (suficientemente precisa: convergente em 1-2 iterações).
function makeUtcFromLocal(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  // Chute inicial: trata como se fosse UTC
  let candidate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  for (let i = 0; i < 3; i++) {
    const parts = toLocalParts(candidate, timezone);
    const diffMinutes =
      (year - parts.year) * 525_600 +
      (month - parts.month) * 43_200 + // aprox; corrige no próximo passo
      (day - parts.day) * 1440 +
      (hour - parts.hour) * 60 +
      (minute - parts.minute);
    if (diffMinutes === 0) return candidate;
    candidate = new Date(candidate.getTime() + diffMinutes * 60_000);
  }
  return candidate;
}

function addDaysLocal(
  year: number,
  month: number,
  day: number,
  delta: number,
): { year: number; month: number; day: number } {
  // Usa Date para somar dias (em UTC, mas só nos importamos com o calendário)
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  d.setUTCDate(d.getUTCDate() + delta);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function clampDayOfMonth(year: number, month: number, wanted: number): number {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate(); // month aqui é 1-12 → próximo mês dia 0 = último do mês corrente
  return Math.min(Math.max(1, wanted), lastDay);
}

// Retorna dia da semana 0=segunda..6=domingo no tz informado.
function localDayOfWeekMonStart(date: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  });
  const wk = fmt.format(date);
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return map[wk] ?? 0;
}
