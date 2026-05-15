import { describe, expect, it } from 'bun:test';
import app from '../src/index';

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await app.fetch(new Request('http://localhost/health'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body).toEqual({ ok: true, service: 'web' });
  });
});
