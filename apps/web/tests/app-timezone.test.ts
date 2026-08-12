import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_APP_TIMEZONE,
  buildAgentClockInstructions,
  buildInstanceClock,
  formatUtcOffset,
  isValidIanaTimezone,
  makeUtcFromLocal,
  normalizeAppTimezone,
} from '../src/lib/app-timezone';

describe('isValidIanaTimezone / normalizeAppTimezone', () => {
  test('accepts common IANA zones', () => {
    expect(isValidIanaTimezone('America/Sao_Paulo')).toBe(true);
    expect(isValidIanaTimezone('UTC')).toBe(true);
    expect(isValidIanaTimezone('Europe/Lisbon')).toBe(true);
  });

  test('rejects garbage', () => {
    expect(isValidIanaTimezone('')).toBe(false);
    expect(isValidIanaTimezone('Foo/Bar')).toBe(false);
    expect(isValidIanaTimezone('not a zone')).toBe(false);
  });

  test('normalize falls back to default', () => {
    expect(normalizeAppTimezone(null)).toBe(DEFAULT_APP_TIMEZONE);
    expect(normalizeAppTimezone('Nope')).toBe(DEFAULT_APP_TIMEZONE);
    expect(normalizeAppTimezone('UTC')).toBe('UTC');
  });
});

describe('buildInstanceClock', () => {
  test('Sao Paulo afternoon is still the same local date as input wall', () => {
    // 2026-07-14 18:30 UTC = 15:30 in America/Sao_Paulo (UTC-3, no DST)
    const now = new Date(Date.UTC(2026, 6, 14, 18, 30, 0));
    const clock = buildInstanceClock(now, 'America/Sao_Paulo');
    expect(clock.timezone).toBe('America/Sao_Paulo');
    expect(clock.localDate).toBe('2026-07-14');
    expect(clock.localTime.startsWith('15:30')).toBe(true);
    expect(clock.utcOffset).toBe('-03:00');
    expect(clock.weekdayEn.toLowerCase()).toContain('tuesday');
    expect(clock.startOfLocalDayUtcIso).toBe(
      makeUtcFromLocal(2026, 7, 14, 0, 0, 0, 'America/Sao_Paulo').toISOString(),
    );
    // Week of 2026-07-14 (Tue) starts Monday 2026-07-13 00:00 SP
    expect(clock.startOfLocalWeekUtcIso).toBe(
      makeUtcFromLocal(2026, 7, 13, 0, 0, 0, 'America/Sao_Paulo').toISOString(),
    );
  });

  test('UTC zone keeps identity', () => {
    const now = new Date(Date.UTC(2026, 0, 5, 12, 0, 0));
    const clock = buildInstanceClock(now, 'UTC');
    expect(clock.localDate).toBe('2026-01-05');
    expect(clock.localTime.startsWith('12:00')).toBe(true);
    expect(clock.utcOffset).toBe('+00:00');
  });

  test('agent instructions include trusted clock block and temporal guidance', () => {
    const clock = buildInstanceClock(
      new Date(Date.UTC(2026, 6, 14, 18, 0, 0)),
      'America/Sao_Paulo',
    );
    const text = buildAgentClockInstructions(clock);
    expect(text).toContain('<instance_clock trusted="true">');
    expect(text).toContain('start_of_local_day_utc=');
    expect(text).toContain('start_of_local_week_monday_utc=');
    expect(text).toContain('list_transcripts / list_notes');
    expect(text).toContain(clock.localDate);
  });
});

describe('formatUtcOffset', () => {
  test('formats SP offset', () => {
    const now = new Date(Date.UTC(2026, 6, 14, 18, 0, 0));
    expect(formatUtcOffset(now, 'America/Sao_Paulo')).toBe('-03:00');
  });
});

describe('wiring (source contracts)', () => {
  test('runtime injects clock into stream instructions', () => {
    const runtime = readFileSync(join(import.meta.dir, '../src/lib/chat/runtime.ts'), 'utf8');
    expect(runtime).toContain('buildAgentClockInstructions');
    expect(runtime).toContain('getAppTimezone');
    expect(runtime).toContain('AGENT_INSTRUCTIONS +');
    expect(runtime).toContain('clock +');
    expect(runtime).toContain('suggestions +');
    expect(runtime).toContain('personalInstructions +');
  });

  test('settings key app_timezone exists', () => {
    const settings = readFileSync(join(import.meta.dir, '../src/lib/settings.ts'), 'utf8');
    expect(settings).toContain("'app_timezone'");
    expect(settings).toContain('getAppTimezone');
  });

  test('admin instance and onboarding accept timezone', () => {
    const admin = readFileSync(join(import.meta.dir, '../src/routes/admin.ts'), 'utf8');
    const onboarding = readFileSync(join(import.meta.dir, '../src/routes/onboarding.ts'), 'utf8');
    expect(admin).toContain('timezone');
    expect(admin).toContain('app_timezone');
    expect(onboarding).toContain('app_timezone');
  });
});
