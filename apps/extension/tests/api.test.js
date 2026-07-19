import { afterEach, describe, expect, it, mock } from 'bun:test';
import { submitUrlToVoxen } from '../lib/api.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('submitUrlToVoxen', () => {
  it('retorna jobId em 201', async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ jobId: 'job-1', status: 'QUEUED', sourceUrl: 'https://x.test' }, { status: 201 }),
    );
    const r = await submitUrlToVoxen({
      baseUrl: 'https://voxen.test',
      pageUrl: 'https://youtube.com/watch?v=1',
    });
    expect(r).toEqual({
      ok: true,
      jobId: 'job-1',
      status: 'QUEUED',
      sourceUrl: 'https://x.test',
    });
  });

  it('mapeia 401 para unauthorized', async () => {
    globalThis.fetch = mock(async () => Response.json({ error: 'Não autenticado.' }, { status: 401 }));
    const r = await submitUrlToVoxen({
      baseUrl: 'https://voxen.test',
      pageUrl: 'https://example.com',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthorized');
  });

  it('mapeia falha de rede', async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError('Failed to fetch');
    });
    const r = await submitUrlToVoxen({
      baseUrl: 'https://voxen.test',
      pageUrl: 'https://example.com',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('network');
  });

  it('envia Authorization quando token presente', async () => {
    /** @type {RequestInit | undefined} */
    let init;
    globalThis.fetch = mock(async (_url, options) => {
      init = options;
      return Response.json({ jobId: 'j2' }, { status: 201 });
    });
    await submitUrlToVoxen({
      baseUrl: 'https://voxen.test',
      pageUrl: 'https://example.com',
      token: ' secret ',
    });
    const headers = /** @type {Record<string, string>} */ (init?.headers);
    expect(headers.Authorization).toBe('Bearer secret');
  });
});
