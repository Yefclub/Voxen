import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import app from '../src/index';
import { formatDevVersionFromDeploy } from '../src/index';

describe('GET /api/version', () => {
  it('retorna version e builtAt sempre populados', async () => {
    const res = await app.fetch(new Request('http://localhost/api/version'));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { version: string; gitSha: string | null; builtAt: string };
    expect(typeof data.version).toBe('string');
    expect(data.version.length).toBeGreaterThan(0);
    expect(typeof data.builtAt).toBe('string');
    // gitSha pode ser null se não rodando em CI/Docker
    expect(data.gitSha === null || typeof data.gitSha === 'string').toBe(true);
  });

  it('aceita acesso sem autenticação (informação não-sensível)', async () => {
    const res = await app.fetch(new Request('http://localhost/api/version'));
    // Sem cookie de sessão, ainda devolve 200 (versão é pública)
    expect(res.status).toBe(200);
  });
});

describe('dev version formatting', () => {
  it('usa próxima patch e normaliza DEPLOY_TIMESTAMP em milissegundos', () => {
    expect(formatDevVersionFromDeploy('0.9.3', '1780337076625', 'abc123')).toBe(
      '0.9.4-dev.1780337076',
    );
  });

  it('preserva a prerelease canônica do package.json', () => {
    expect(formatDevVersionFromDeploy('0.13.0-dev.1785366299', '1785372519', 'abc123')).toBe(null);
    expect(formatDevVersionFromDeploy('0.13.0-rc.1', '1785372519', 'abc123')).toBe(null);
  });

  it('não gera versão dev sem sha ou timestamp válido', () => {
    expect(formatDevVersionFromDeploy('0.9.3', '1780337076')).toBe(null);
    expect(formatDevVersionFromDeploy('0.9.3', 'not-a-number', 'abc123')).toBe(null);
  });
});

describe('static cache headers', () => {
  it('responde com cache control adequado pra dist se existir', async () => {
    // Não dá pra testar sem build do front; só confirmamos que o handler
    // retorna algo (404 ou redirect ok). Sanity check de que rota * não quebra.
    const res = await app.fetch(new Request('http://localhost/qualquer-rota-spa'));
    // Em dev sem dist, retorna 404 com hint; em test mode pode falhar a static
    // mas o status code é determinístico (não 5xx).
    expect(res.status).toBeLessThan(500);
  });
});

describe('build identity meta', () => {
  // Só roda quando o dist do Vite existe (build local/CI com front buildado).
  // Sem dist, o handler * devolve o hint de dev e não há HTML pra inspecionar.
  const distIndexExists = existsSync(new URL('../dist/index.html', import.meta.url));

  it.skipIf(!distIndexExists)('injeta meta voxen-build no HTML servido', async () => {
    const res = await app.fetch(new Request('http://localhost/'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toMatch(
      /<head><meta name="voxen-build" content="[^"]+"><meta name="voxen-version" content="[^"]+">/,
    );
  });

  it.skipIf(!distIndexExists)('injeta o mesmo meta no fallback SPA', async () => {
    const res = await app.fetch(new Request('http://localhost/qualquer-rota-spa'));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/<meta name="voxen-build" content="[^"]+">/);
    expect(html).toMatch(/<meta name="voxen-version" content="[^"]+">/);
  });
});
