import { afterEach, describe, expect, test } from 'bun:test';
import { compareSemver, fetchJobStatus, fetchMe, submitUrlToVoxen } from '../lib/api.js';

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
    expect(await fetchMe('https://voxen.example.com')).toEqual({ theme: 'zinc' });
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

/**
 * Requisição sem prazo é o mesmo bloqueio do job irresolvível por outra porta:
 * uma instância que **pendura** (proxy de pé com o backend travado, rota com
 * DROP no caminho) nunca resolve nem rejeita, e a fase que libera o botão de
 * envio só roda depois que a consulta volta. Errar é recuperável; pendurar
 * não é.
 */
describe('prazo das requisições', () => {
  const originalFetch = globalThis.fetch;
  const BASE = 'https://voxen.example.com';

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /** @param {unknown} body */
  function captureInit(body) {
    /** @type {{ init: RequestInit | undefined }} */
    const captured = { init: undefined };
    globalThis.fetch = async (_url, init) => {
      captured.init = init;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    return captured;
  }

  test('fetchJobStatus manda um AbortSignal com prazo', async () => {
    const captured = captureInit({ job: { id: 'j1', status: 'QUEUED' } });
    await fetchJobStatus({ baseUrl: BASE, jobId: 'j1' });
    expect(captured.init?.signal).toBeInstanceOf(AbortSignal);
  });

  test('submitUrlToVoxen manda um AbortSignal com prazo', async () => {
    const captured = captureInit({ jobId: 'j1' });
    await submitUrlToVoxen({ baseUrl: BASE, pageUrl: 'https://exemplo.com/artigo' });
    expect(captured.init?.signal).toBeInstanceOf(AbortSignal);
  });

  test('fetchMe manda um AbortSignal com prazo', async () => {
    const captured = captureInit({ user: { theme: 'zinc' } });
    await fetchMe(BASE);
    expect(captured.init?.signal).toBeInstanceOf(AbortSignal);
  });

  test('timeout vira falha de rede recuperável, com mensagem em português', async () => {
    globalThis.fetch = async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    };
    const status = await fetchJobStatus({ baseUrl: BASE, jobId: 'j1' });
    expect(status.ok).toBe(false);
    expect(status.code).toBe('network');
    expect(status.message).toMatch(/não respondeu a tempo/);

    const submit = await submitUrlToVoxen({ baseUrl: BASE, pageUrl: 'https://exemplo.com/a' });
    expect(submit.ok).toBe(false);
    expect(submit.code).toBe('network');
    expect(submit.message).toMatch(/não respondeu a tempo/);
  });

  test('timeout não descarta o rastreamento nem finge desfecho', async () => {
    globalThis.fetch = async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    };
    const status = await fetchJobStatus({ baseUrl: BASE, jobId: 'j1' });
    // 'network' é o código que o worker trata como falha transitória e o popup
    // traduz em "acompanhamento indisponível" — sem travar o botão de envio.
    expect(status).not.toHaveProperty('job');
    expect(status.code).not.toBe('unauthorized');
  });
});
