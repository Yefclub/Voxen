import { afterEach, describe, expect, test } from 'bun:test';
import { compareSemver, fetchMe } from '../lib/api.js';

describe('compareSemver', () => {
  test('ordena versões', () => {
    expect(compareSemver('0.2.0', '0.1.0')).toBeGreaterThan(0);
    expect(compareSemver('0.1.0', '0.2.0')).toBeLessThan(0);
    expect(compareSemver('0.2.0', '0.2.0')).toBe(0);
    expect(compareSemver('1.0.0', '0.9.9')).toBeGreaterThan(0);
  });
});

describe('fetchMe', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('retorna o tema quando a sessão está autenticada', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ user: { theme: 'zinc' } }), { status: 200 });
    expect(await fetchMe('https://voxen.example.com')).toEqual({ theme: 'zinc', role: null });
  });

  test('retorna a role quando a instância informa (decide se mostra contas)', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ user: { theme: 'zinc', role: 'ADMIN' } }), { status: 200 });
    expect(await fetchMe('https://voxen.example.com')).toEqual({ theme: 'zinc', role: 'ADMIN' });
  });

  test('retorna null quando não autenticado (sem tema pra herdar)', async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ user: null }), { status: 200 });
    expect(await fetchMe('https://voxen.example.com')).toBeNull();
  });

  test('retorna null em erro de rede (nunca lança)', async () => {
    globalThis.fetch = async () => {
      throw new Error('Failed to fetch');
    };
    expect(await fetchMe('https://voxen.example.com')).toBeNull();
  });

  test('retorna null em resposta HTTP não-ok', async () => {
    globalThis.fetch = async () => new Response('', { status: 500 });
    expect(await fetchMe('https://voxen.example.com')).toBeNull();
  });
});
