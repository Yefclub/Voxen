import { describe, test, expect } from 'bun:test';
import { formatUpdateMessage, resolveServerBuild, shouldNotify } from './version-monitor-core';

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

describe('formatUpdateMessage', () => {
  // t() fake que aplica a interpolação {var} igual ao i18n real.
  const t = ((key: string, vars?: Record<string, string | number>): string => {
    const templates: Record<string, string> = {
      'shell.updateAvailable': 'Nova versão disponível',
      'shell.updateAvailableTo': 'Nova versão disponível ({to})',
      'shell.updateAvailableFromTo': 'Nova versão disponível ({from} → {to})',
    };
    const template = templates[key] ?? key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (m, name: string) =>
      vars[name] === undefined ? m : String(vars[name]),
    );
  }) as Parameters<typeof formatUpdateMessage>[0];

  test('de→para quando ambas versões conhecidas e diferentes', () => {
    expect(formatUpdateMessage(t, { loadedVersion: '0.10.0', serverVersion: '0.10.1' })).toBe(
      'Nova versão disponível (0.10.0 → 0.10.1)',
    );
  });

  test('só a nova quando a carregada é desconhecida', () => {
    expect(formatUpdateMessage(t, { loadedVersion: null, serverVersion: '0.10.1' })).toBe(
      'Nova versão disponível (0.10.1)',
    );
  });

  test('só a nova quando carregada == nova (não mostra X → X)', () => {
    expect(formatUpdateMessage(t, { loadedVersion: '0.10.1', serverVersion: '0.10.1' })).toBe(
      'Nova versão disponível (0.10.1)',
    );
  });

  test('genérico quando nenhuma versão é conhecida', () => {
    expect(formatUpdateMessage(t, { loadedVersion: null, serverVersion: null })).toBe(
      'Nova versão disponível',
    );
  });
});
