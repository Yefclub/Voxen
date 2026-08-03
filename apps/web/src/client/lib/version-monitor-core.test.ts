import { describe, test, expect } from 'bun:test';
import {
  createVersionSnooze,
  parseVersionSnooze,
  resolveDisplayedFromVersion,
  resolveServerBuild,
  shouldNotify,
  UPDATE_SNOOZE_MS,
} from './version-monitor-core';

describe('resolveServerBuild', () => {
  test('prioriza gitSha quando presente', () => {
    expect(resolveServerBuild({ version: '0.10.1', gitSha: 'abc123' })).toBe('abc123');
  });

  test('cai para version quando gitSha é nulo/vazio', () => {
    expect(resolveServerBuild({ version: '0.10.1', gitSha: null })).toBe('0.10.1');
    expect(resolveServerBuild({ version: '0.10.1', gitSha: '' })).toBe('0.10.1');
  });

  test('retorna null sem version nem gitSha', () => {
    expect(resolveServerBuild({})).toBeNull();
    expect(resolveServerBuild({ version: '', gitSha: '' })).toBeNull();
  });
});

describe('shouldNotify', () => {
  test('false quando serverBuild == loadedBuild (mesmo build)', () => {
    expect(
      shouldNotify({
        serverBuild: 'abc',
        loadedBuild: 'abc',
        snoozedBuild: null,
        snoozedUntil: null,
        now: 1_000,
      }),
    ).toBe(false);
  });

  test('false enquanto o mesmo build estiver adiado', () => {
    expect(
      shouldNotify({
        serverBuild: 'new',
        loadedBuild: 'old',
        snoozedBuild: 'new',
        snoozedUntil: 2_000,
        now: 1_000,
      }),
    ).toBe(false);
  });

  test('true com service worker esperando mesmo quando servidor e bundle têm o mesmo build', () => {
    expect(
      shouldNotify({
        serverBuild: 'abc',
        loadedBuild: 'abc',
        waitingServiceWorker: true,
        snoozedBuild: null,
        snoozedUntil: null,
        now: 1_000,
      }),
    ).toBe(true);
  });

  test('service worker esperando respeita o adiamento e volta a notificar após expirar', () => {
    expect(
      shouldNotify({
        serverBuild: 'abc',
        loadedBuild: 'abc',
        waitingServiceWorker: true,
        snoozedBuild: 'abc',
        snoozedUntil: 2_000,
        now: 1_000,
      }),
    ).toBe(false);
    expect(
      shouldNotify({
        serverBuild: 'abc',
        loadedBuild: 'abc',
        waitingServiceWorker: true,
        snoozedBuild: 'abc',
        snoozedUntil: 2_000,
        now: 2_000,
      }),
    ).toBe(true);
  });

  test('true quando o adiamento expira e o bundle continua antigo', () => {
    expect(
      shouldNotify({
        serverBuild: 'new',
        loadedBuild: 'old',
        snoozedBuild: 'new',
        snoozedUntil: 999,
        now: 1_000,
      }),
    ).toBe(true);
  });

  test('true quando aparece build diferente do adiado', () => {
    expect(
      shouldNotify({
        serverBuild: 'newer',
        loadedBuild: 'old',
        snoozedBuild: 'new',
        snoozedUntil: 2_000,
        now: 1_000,
      }),
    ).toBe(true);
  });

  test('false para serverBuild nulo/vazio', () => {
    expect(
      shouldNotify({
        serverBuild: null,
        loadedBuild: 'old',
        snoozedBuild: null,
        snoozedUntil: null,
        now: 1_000,
      }),
    ).toBe(false);
    expect(
      shouldNotify({
        serverBuild: '',
        loadedBuild: 'old',
        snoozedBuild: null,
        snoozedUntil: null,
        now: 1_000,
      }),
    ).toBe(false);
  });
});

describe('resolveDisplayedFromVersion', () => {
  test('omite a origem quando as versões amigáveis são iguais', () => {
    expect(resolveDisplayedFromVersion('0.13.0', '0.13.0')).toBeNull();
  });

  test('preserva a origem quando há uma transição real de versão', () => {
    expect(resolveDisplayedFromVersion('0.13.0', '0.13.1')).toBe('0.13.0');
  });

  test('não inventa uma origem ausente', () => {
    expect(resolveDisplayedFromVersion(null, '0.13.1')).toBeNull();
  });
});

describe('adiamento persistido', () => {
  test('dura exatamente 30 minutos e volta a notificar depois do prazo', () => {
    const snooze = createVersionSnooze('new', 1_000);
    expect(snooze).toEqual({ build: 'new', until: 1_000 + UPDATE_SNOOZE_MS });
    expect(
      shouldNotify({
        serverBuild: 'new',
        loadedBuild: 'old',
        snoozedBuild: snooze.build,
        snoozedUntil: snooze.until,
        now: snooze.until - 1,
      }),
    ).toBe(false);
    expect(
      shouldNotify({
        serverBuild: 'new',
        loadedBuild: 'old',
        snoozedBuild: snooze.build,
        snoozedUntil: snooze.until,
        now: snooze.until,
      }),
    ).toBe(true);
  });

  test('aceita somente JSON persistido completo e finito', () => {
    expect(parseVersionSnooze('{"build":"new","until":1234}')).toEqual({
      build: 'new',
      until: 1234,
    });
    for (const raw of [
      null,
      '',
      'not-json',
      '{}',
      '{"build":"","until":1234}',
      '{"build":"new","until":"later"}',
      '{"build":"new","until":1e999}',
    ]) {
      expect(parseVersionSnooze(raw), String(raw)).toBeNull();
    }
  });
});
