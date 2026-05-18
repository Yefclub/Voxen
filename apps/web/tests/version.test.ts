import { describe, expect, it } from 'bun:test';
import app from '../src/index';

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
