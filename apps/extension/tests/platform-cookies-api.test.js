import { afterEach, describe, expect, test } from 'bun:test';
import { fetchPlatformCookieStatus, sendPlatformCookies } from '../lib/api.js';
import { platformCookieUrl, platformCookiesUrl } from '../lib/config.js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('URLs da rota de cookies', () => {
  test('monta os endpoints pessoais', () => {
    expect(platformCookiesUrl('https://a.com/')).toBe('https://a.com/api/integrations/cookies');
    expect(platformCookieUrl('https://a.com', 'tiktok')).toBe(
      'https://a.com/api/integrations/cookies/tiktok',
    );
  });
});

describe('fetchPlatformCookieStatus', () => {
  test('devolve as plataformas em caso de sucesso', async () => {
    globalThis.fetch = async () =>
      Response.json({
        platforms: [{ platform: 'tiktok', hasCookie: true, capturedAt: null, stale: false }],
      });
    const res = await fetchPlatformCookieStatus({ baseUrl: 'https://a.com' });
    expect(res.ok).toBe(true);
    expect(res.platforms).toHaveLength(1);
  });

  test('403 vira forbidden (usuário não aprovado)', async () => {
    globalThis.fetch = async () => new Response('{}', { status: 403 });
    const res = await fetchPlatformCookieStatus({ baseUrl: 'https://a.com' });
    expect(res).toMatchObject({ ok: false, code: 'forbidden' });
  });

  test('401 vira unauthorized', async () => {
    globalThis.fetch = async () => new Response('{}', { status: 401 });
    const res = await fetchPlatformCookieStatus({ baseUrl: 'https://a.com' });
    expect(res).toMatchObject({ ok: false, code: 'unauthorized' });
  });

  test('erro de rede nunca lança', async () => {
    globalThis.fetch = async () => {
      throw new Error('Failed to fetch');
    };
    const res = await fetchPlatformCookieStatus({ baseUrl: 'https://a.com' });
    expect(res).toMatchObject({ ok: false, code: 'network' });
  });
});

describe('sendPlatformCookies', () => {
  test('faz PATCH com credenciais e devolve o status da plataforma', async () => {
    let seen = null;
    globalThis.fetch = async (url, init) => {
      seen = { url, init };
      return Response.json({ platform: 'tiktok', hasCookie: true, capturedAt: 'x', stale: false });
    };
    const res = await sendPlatformCookies({
      baseUrl: 'https://a.com',
      platform: 'tiktok',
      cookies: '# Netscape HTTP Cookie File\n.tiktok.com\tTRUE\t/\tTRUE\t0\tn\tv\n',
    });
    expect(res.ok).toBe(true);
    expect(res.status.hasCookie).toBe(true);
    expect(seen.url).toBe('https://a.com/api/integrations/cookies');
    expect(seen.init.method).toBe('PATCH');
    expect(seen.init.credentials).toBe('include');
    expect(JSON.parse(seen.init.body).platform).toBe('tiktok');
  });

  test('propaga a mensagem de erro do backend sem inventar sucesso', async () => {
    globalThis.fetch = async () => Response.json({ error: 'Linha 1 inválida.' }, { status: 422 });
    const res = await sendPlatformCookies({
      baseUrl: 'https://a.com',
      platform: 'tiktok',
      cookies: 'x',
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain('Linha 1');
  });

  test('403 vira forbidden', async () => {
    globalThis.fetch = async () => new Response('{}', { status: 403 });
    const res = await sendPlatformCookies({
      baseUrl: 'https://a.com',
      platform: 'tiktok',
      cookies: 'x',
    });
    expect(res).toMatchObject({ ok: false, code: 'forbidden' });
  });

  test('falha de rede não vaza o conteúdo do cookie na mensagem', async () => {
    const secret = 'COOKIE-SUPER-SECRETO';
    globalThis.fetch = async () => {
      // Mensagem arbitrária (não é o "Failed to fetch" reconhecido): mesmo
      // assim nada do payload pode chegar à UI.
      throw new Error(`boom ${secret}`);
    };
    const res = await sendPlatformCookies({
      baseUrl: 'https://a.com',
      platform: 'tiktok',
      cookies: `.tiktok.com\tTRUE\t/\tTRUE\t0\tsessionid\t${secret}`,
    });
    expect(res.ok).toBe(false);
    expect(res.message).not.toContain(secret);
  });
});
