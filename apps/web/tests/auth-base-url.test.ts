import { describe, expect, it } from 'bun:test';
import { resolveAuthBaseURL } from '../src/lib/auth';

const FALLBACK = 'http://localhost:3000';

describe('resolveAuthBaseURL', () => {
  it('aceita URL https válida com host', () => {
    expect(resolveAuthBaseURL('https://voxen.exemplo.com')).toBe('https://voxen.exemplo.com');
  });

  it('aceita URL http válida com porta', () => {
    expect(resolveAuthBaseURL('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('cai no fallback quando ausente (undefined)', () => {
    expect(resolveAuthBaseURL(undefined)).toBe(FALLBACK);
  });

  it('cai no fallback quando string vazia', () => {
    expect(resolveAuthBaseURL('')).toBe(FALLBACK);
  });

  it('cai no fallback quando só o esquema (sem host)', () => {
    expect(resolveAuthBaseURL('https://')).toBe(FALLBACK);
  });

  it('cai no fallback quando esquema não-http (ex.: ftp)', () => {
    expect(resolveAuthBaseURL('ftp://host')).toBe(FALLBACK);
  });

  it('cai no fallback quando completamente malformado', () => {
    expect(resolveAuthBaseURL('not a url')).toBe(FALLBACK);
  });
});
