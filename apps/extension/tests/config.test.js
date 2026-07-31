import { describe, expect, test } from 'bun:test';
import {
  isSendableTabUrl,
  looksLikeVoxenTab,
  meUrl,
  normalizeBaseUrl,
  originPattern,
} from '../lib/config.js';

describe('normalizeBaseUrl', () => {
  test('aceita https e remove path', () => {
    const r = normalizeBaseUrl('https://voxen.example.com/foo');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.baseUrl).toBe('https://voxen.example.com');
  });

  test('rejeita scheme inválido', () => {
    const r = normalizeBaseUrl('ftp://x.com');
    expect(r.ok).toBe(false);
  });
});

describe('looksLikeVoxenTab', () => {
  test('paths conhecidos', () => {
    expect(looksLikeVoxenTab('https://voxen.example.com/extensao', 'Voxen')).toBe(true);
    expect(looksLikeVoxenTab('https://voxen.example.com/transcricoes', '')).toBe(true);
    expect(looksLikeVoxenTab('https://youtube.com/watch?v=1', 'Video')).toBe(false);
  });
});

describe('isSendableTabUrl / originPattern', () => {
  test('http only', () => {
    expect(isSendableTabUrl('https://a.com')).toBe(true);
    expect(isSendableTabUrl('chrome://extensions')).toBe(false);
  });
  test('pattern', () => {
    expect(originPattern('https://a.com')).toBe('https://a.com/*');
  });
});

describe('meUrl', () => {
  test('monta a URL de /api/me', () => {
    expect(meUrl('https://a.com')).toBe('https://a.com/api/me');
    expect(meUrl('https://a.com/')).toBe('https://a.com/api/me');
  });
});
