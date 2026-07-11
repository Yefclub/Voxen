import { describe, test, expect } from 'bun:test';
import { resolveServerBuild, shouldNotify } from './version-monitor-core';

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
    expect(shouldNotify({ serverBuild: 'abc', loadedBuild: 'abc', lastHandledBuild: null })).toBe(
      false,
    );
  });

  test('false quando serverBuild já foi tratado (dispensado/acionado)', () => {
    expect(shouldNotify({ serverBuild: 'new', loadedBuild: 'old', lastHandledBuild: 'new' })).toBe(
      false,
    );
  });

  test('true quando serverBuild é novo e nunca tratado', () => {
    expect(shouldNotify({ serverBuild: 'new', loadedBuild: 'old', lastHandledBuild: null })).toBe(
      true,
    );
  });

  test('true quando aparece build diferente do último tratado', () => {
    expect(
      shouldNotify({ serverBuild: 'newer', loadedBuild: 'old', lastHandledBuild: 'new' }),
    ).toBe(true);
  });

  test('false para serverBuild nulo/vazio', () => {
    expect(shouldNotify({ serverBuild: null, loadedBuild: 'old', lastHandledBuild: null })).toBe(
      false,
    );
    expect(shouldNotify({ serverBuild: '', loadedBuild: 'old', lastHandledBuild: null })).toBe(
      false,
    );
  });
});
