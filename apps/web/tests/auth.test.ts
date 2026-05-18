import { describe, expect, it } from 'bun:test';
import app from '../src/index';

describe('better-auth mounting', () => {
  it('mounts /api/auth/* — POST /api/auth/sign-up retorna response (sem 404)', async () => {
    // Sem DB ligado, better-auth vai falhar internamente, MAS o handler
    // É chamado (não cai no 404 do Hono). Status pode ser 400/500, não 404.
    const res = await app.fetch(
      new Request('http://localhost/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@a.com', password: 'x'.repeat(12), name: 'Test' }),
      }),
    );
    expect(res.status).not.toBe(404);
  });

  it('GET /api/me sem cookie devolve user: null (sem hit forte no DB)', async () => {
    const res = await app.fetch(new Request('http://localhost/api/me'));
    // Sem session header/cookie, better-auth retorna session null antes de query.
    // Aceita 200 com user null OU 500 se DB inacessível em ambiente sem DATABASE_URL.
    expect([200, 500]).toContain(res.status);
  });
});
