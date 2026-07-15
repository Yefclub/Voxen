// ============================================================================
// Fuso da instância + relógio para o agente (spec 095)
// ============================================================================
// Persistido em Setting GLOBAL `app_timezone` (IANA). Sem dependências externas
// — usa Intl.DateTimeFormat, igual ao módulo de automações.
// ============================================================================

/** Default alinhado ao fuso padrão das automações. */
export const DEFAULT_APP_TIMEZONE = 'America/Sao_Paulo';

/**
 * Lista curta para selects de UI. Qualquer IANA válido ainda é aceito na API
 * (ex.: detectado pelo browser e não listado aqui).
 */
export const COMMON_TIMEZONES = [
  'America/Sao_Paulo',
  'America/Fortaleza',
  'America/Recife',
  'America/Bahia',
  'America/Belem',
  'America/Manaus',
  'America/Cuiaba',
  'America/Campo_Grande',
  'America/Porto_Velho',
  'America/Boa_Vista',
  'America/Rio_Branco',
  'America/Noronha',
  'America/Argentina/Buenos_Aires',
  'America/Santiago',
  'America/Bogota',
  'America/Lima',
  'America/Mexico_City',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Amsterdam',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
] as const;

export function isValidIanaTimezone(tz: string): boolean {
  if (typeof tz !== 'string') return false;
  const value = tz.trim();
  if (value.length < 1 || value.length > 64) return false;
  try {
    // Throws RangeError for unknown zones in modern runtimes.
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeAppTimezone(value: string | null | undefined): string {
  if (value && isValidIanaTimezone(value)) return value.trim();
  return DEFAULT_APP_TIMEZONE;
}

export type InstanceClock = {
  timezone: string;
  nowUtcIso: string;
  localDate: string;
  localTime: string;
  localDateTime: string;
  weekdayEn: string;
  weekdayPt: string;
  utcOffset: string;
  startOfLocalDayUtcIso: string;
  endOfLocalDayUtcIso: string;
  startOfLocalWeekUtcIso: string;
};

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function toLocalParts(date: Date, timezone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0');
  let h = get('hour');
  if (h === 24) h = 0;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: h,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Date UTC such that local calendar in `timezone` shows the given wall time. */
export function makeUtcFromLocal(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timezone: string,
): Date {
  let candidate = new Date(Date.UTC(year, month - 1, day, hour, minute, second, 0));
  for (let i = 0; i < 4; i++) {
    const parts = toLocalParts(candidate, timezone);
    const diffSeconds =
      (year - parts.year) * 31_536_000 +
      (month - parts.month) * 2_592_000 +
      (day - parts.day) * 86_400 +
      (hour - parts.hour) * 3_600 +
      (minute - parts.minute) * 60 +
      (second - parts.second);
    if (diffSeconds === 0) return candidate;
    candidate = new Date(candidate.getTime() + diffSeconds * 1000);
  }
  return candidate;
}

function weekdayLong(date: Date, timezone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: 'long' }).format(date);
}

/**
 * Offset like `-03:00` or `+00:00` for `date` in `timezone`.
 * Prefers `longOffset` / `shortOffset`; falls back to numeric diff.
 */
export function formatUtcOffset(date: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    }).formatToParts(date);
    const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    // "GMT-3" | "GMT-03:00" | "GMT+5:30" | "Coordinated Universal Time"
    const m = raw.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
    if (m) {
      const sign = m[1];
      const hh = m[2].padStart(2, '0');
      const mm = (m[3] ?? '00').padStart(2, '0');
      return `${sign}${hh}:${mm}`;
    }
    if (/UTC|Coordinated Universal Time/i.test(raw) || timezone === 'UTC') return '+00:00';
  } catch {
    /* fall through */
  }
  // Fallback: compare local wall parts to UTC parts.
  const local = toLocalParts(date, timezone);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  const diffMin = Math.round((asUtc - date.getTime()) / 60_000);
  const sign = diffMin >= 0 ? '+' : '-';
  const abs = Math.abs(diffMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

/** Monday = 0 … Sunday = 6 in the given timezone. */
function localDayOfWeekMonStart(date: Date, timezone: string): number {
  const wk = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(
    date,
  );
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return map[wk] ?? 0;
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  delta: number,
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  d.setUTCDate(d.getUTCDate() + delta);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function buildInstanceClock(
  now: Date = new Date(),
  timezoneInput: string = DEFAULT_APP_TIMEZONE,
): InstanceClock {
  const timezone = normalizeAppTimezone(timezoneInput);
  const local = toLocalParts(now, timezone);
  const localDate = `${String(local.year).padStart(4, '0')}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
  const localTime = `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}:${String(local.second).padStart(2, '0')}`;
  const startOfDay = makeUtcFromLocal(local.year, local.month, local.day, 0, 0, 0, timezone);
  const endOfDay = new Date(
    makeUtcFromLocal(local.year, local.month, local.day, 23, 59, 59, timezone).getTime() + 999,
  );
  // Week starts Monday 00:00 local.
  const dow = localDayOfWeekMonStart(now, timezone);
  const weekStartCal = addCalendarDays(local.year, local.month, local.day, -dow);
  const startOfWeek = makeUtcFromLocal(
    weekStartCal.year,
    weekStartCal.month,
    weekStartCal.day,
    0,
    0,
    0,
    timezone,
  );

  return {
    timezone,
    nowUtcIso: now.toISOString(),
    localDate,
    localTime,
    localDateTime: `${localDate} ${localTime}`,
    weekdayEn: weekdayLong(now, timezone, 'en-US'),
    weekdayPt: weekdayLong(now, timezone, 'pt-BR'),
    utcOffset: formatUtcOffset(now, timezone),
    startOfLocalDayUtcIso: startOfDay.toISOString(),
    endOfLocalDayUtcIso: endOfDay.toISOString(),
    startOfLocalWeekUtcIso: startOfWeek.toISOString(),
  };
}

/**
 * Bloco confiado (servidor) anexado às instructions do agente.
 * NÃO é untrusted metadata — o modelo deve tratar como verdade do sistema.
 */
export function buildAgentClockInstructions(clock: InstanceClock): string {
  return [
    '',
    '<instance_clock trusted="true">',
    `timezone=${clock.timezone}`,
    `now_utc=${clock.nowUtcIso}`,
    `now_local=${clock.localDateTime}`,
    `local_date=${clock.localDate}`,
    `local_time=${clock.localTime}`,
    `weekday_pt=${clock.weekdayPt}`,
    `weekday_en=${clock.weekdayEn}`,
    `utc_offset=${clock.utcOffset}`,
    `start_of_local_day_utc=${clock.startOfLocalDayUtcIso}`,
    `end_of_local_day_utc=${clock.endOfLocalDayUtcIso}`,
    `start_of_local_week_monday_utc=${clock.startOfLocalWeekUtcIso}`,
    '</instance_clock>',
    'Relógio da instância (fonte da verdade para tempo):',
    `- Agora no fuso do usuário: ${clock.localDateTime} (${clock.weekdayPt} / ${clock.weekdayEn}), offset ${clock.utcOffset}, zona ${clock.timezone}.`,
    `- "Hoje" = ${clock.localDate} (desde ${clock.startOfLocalDayUtcIso} até ${clock.endOfLocalDayUtcIso} em UTC).`,
    `- "Esta semana" = a partir de segunda 00:00 local (${clock.startOfLocalWeekUtcIso} UTC) até agora.`,
    '- Ao usar list_transcripts / list_notes com since/until, converta o calendário local para ISO-8601 UTC usando os marcos acima — nunca assuma que o servidor está em UTC “como se fosse” o dia local do usuário.',
    '- Ao citar horários ao usuário, prefira o fuso da instância (e mencione o fuso se houver ambiguidade).',
  ].join('\n');
}
