import { describe, expect, it } from 'bun:test';
import {
  isSendableTabUrl,
  jobsAutoUrl,
  loginUrl,
  normalizeBaseUrl,
  originPattern,
} from '../lib/config.js';

describe('normalizeBaseUrl', () => {
  it('aceita https completo e remove path', () => {
    const r = normalizeBaseUrl('https://voxen.example.com/app/');
    expect(r).toEqual({ ok: true, baseUrl: 'https://voxen.example.com' });
  });

  it('adiciona https quando scheme ausente', () => {
    const r = normalizeBaseUrl('voxen.example.com');
    expect(r).toEqual({ ok: true, baseUrl: 'https://voxen.example.com' });
  });

  it('preserva porta e http local', () => {
    const r = normalizeBaseUrl('http://localhost:3000/');
    expect(r).toEqual({ ok: true, baseUrl: 'http://localhost:3000' });
  });

  it('rejeita vazio e scheme inválido', () => {
    expect(normalizeBaseUrl('').ok).toBe(false);
    expect(normalizeBaseUrl('ftp://x').ok).toBe(false);
  });
});

describe('originPattern / login / jobs url', () => {
  it('monta pattern e endpoints', () => {
    expect(originPattern('https://voxen.example.com')).toBe('https://voxen.example.com/*');
    expect(jobsAutoUrl('https://voxen.example.com')).toBe(
      'https://voxen.example.com/api/jobs/auto',
    );
    expect(loginUrl('https://voxen.example.com', '/fila')).toBe(
      'https://voxen.example.com/entrar?next=%2Ffila',
    );
  });
});

describe('isSendableTabUrl', () => {
  it('só http(s)', () => {
    expect(isSendableTabUrl('https://youtube.com/watch?v=1')).toBe(true);
    expect(isSendableTabUrl('http://localhost:3000')).toBe(true);
    expect(isSendableTabUrl('chrome://extensions')).toBe(false);
    expect(isSendableTabUrl('chrome-extension://abc/popup.html')).toBe(false);
    expect(isSendableTabUrl(undefined)).toBe(false);
  });
});
