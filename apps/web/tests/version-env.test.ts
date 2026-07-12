import { describe, expect, it } from 'bun:test';
import { isDevVersion, resolveVersionEnvironment } from '../src/client/lib/version-env';

describe('isDevVersion', () => {
  it('retorna true para versão com marcador -dev.<unix_ts>', () => {
    expect(isDevVersion('0.11.0-dev.1783824951')).toBe(true);
  });

  it('retorna false para versão limpa (release/produção)', () => {
    expect(isDevVersion('0.11.0')).toBe(false);
  });

  it('retorna false para string vazia', () => {
    expect(isDevVersion('')).toBe(false);
  });

  it('retorna false para undefined', () => {
    expect(isDevVersion(undefined)).toBe(false);
  });

  it('retorna false para null', () => {
    expect(isDevVersion(null)).toBe(false);
  });

  it('não confunde pre-release semver comum (sem o marcador exato) com dev', () => {
    expect(isDevVersion('0.11.0-rc.1')).toBe(false);
    expect(isDevVersion('0.11.0-dev')).toBe(false);
  });
});

describe('resolveVersionEnvironment', () => {
  it("retorna 'dev' para versão com marcador -dev.", () => {
    expect(resolveVersionEnvironment('0.11.0-dev.1783824951')).toBe('dev');
  });

  it("retorna 'prod' para versão limpa", () => {
    expect(resolveVersionEnvironment('0.11.0')).toBe('prod');
  });

  it("retorna 'prod' para string vazia", () => {
    expect(resolveVersionEnvironment('')).toBe('prod');
  });

  it("retorna 'prod' para undefined", () => {
    expect(resolveVersionEnvironment(undefined)).toBe('prod');
  });
});
