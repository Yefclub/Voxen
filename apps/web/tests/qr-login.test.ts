// ============================================================================
// QR quick login — one-time token (spec 060)
// ============================================================================
// Testes leves (sem DB): rotas montadas + geração exige auth (401).
// Testes de integração (Postgres real, skipa sem DATABASE_URL): geração com
// sessão, single-use (2º uso falha), expiração, e handoff (verify seta cookie).
// ============================================================================

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

async function wipeDb(): Promise<void> {
  await db.session.deleteMany();
  await db.account.deleteMany();
  await db.verification.deleteMany();
  await db.setting.deleteMany();
  await db.user.deleteMany();
}

async function signUp(email: string, password: string, name: string): Promise<Response> {
  return app.fetch(
    new Request('http://localhost/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    }),
  );
}

async function signIn(email: string, password: string): Promise<Response> {
  return app.fetch(
    new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  );
}

function extractCookie(res: Response): string {
  const set = res.headers.get('set-cookie') ?? '';
  return set.split(';')[0] ?? '';
}

async function genQrLogin(cookie: string): Promise<Response> {
  return app.fetch(
    new Request('http://localhost/api/account/qr-login', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }),
  );
}

function tokenFromLoginUrl(loginUrl: string): string {
  return new URL(loginUrl).searchParams.get('t') ?? '';
}

async function verifyToken(token: string): Promise<Response> {
  return app.fetch(
    new Request('http://localhost/api/auth/one-time-token/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    }),
  );
}

describe('QR login — mounting + auth guard (sem DB)', () => {
  it('rota verify do plugin está montada (não 404)', async () => {
    const res = await verifyToken('inexistente');
    // Sem DB pode dar 500; com DB, 400 (token inválido). Nunca 404.
    expect(res.status).not.toBe(404);
  });

  it('geração sem sessão → 401 (userId nunca vem do cliente)', async () => {
    const res = await genQrLogin('');
    expect(res.status).toBe(401);
  });
});

describeIfDb('QR login — fluxo completo (Postgres real)', () => {
  beforeAll(async () => {
    await wipeDb();
  });
  beforeEach(async () => {
    await wipeDb();
  });
  afterAll(async () => {
    await wipeDb();
    await db.$disconnect();
  });

  async function approvedAdminCookie(): Promise<string> {
    // Primeiro cadastro vira ADMIN + APPROVED automaticamente.
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    expect(signin.status).toBe(200);
    return extractCookie(signin);
  }

  it('geração com sessão → 200 com loginUrl + TTL; URL contém token', async () => {
    const cookie = await approvedAdminCookie();
    const res = await genQrLogin(cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { loginUrl: string; expiresInSec: number };
    expect(body.loginUrl).toContain('/qr-login?t=');
    expect(body.expiresInSec).toBeGreaterThan(0);
    expect(tokenFromLoginUrl(body.loginUrl).length).toBeGreaterThan(10);
  });

  it('verify do token válido → 200 e seta cookie de sessão (handoff)', async () => {
    const cookie = await approvedAdminCookie();
    const gen = await genQrLogin(cookie);
    const { loginUrl } = (await gen.json()) as { loginUrl: string };
    const token = tokenFromLoginUrl(loginUrl);

    const verify = await verifyToken(token);
    expect(verify.status).toBe(200);
    // Handoff: o verify estabelece a sessão no device (Set-Cookie).
    expect(verify.headers.get('set-cookie') ?? '').toContain('session_token');
  });

  it('token é single-use: 2ª verificação falha', async () => {
    const cookie = await approvedAdminCookie();
    const gen = await genQrLogin(cookie);
    const { loginUrl } = (await gen.json()) as { loginUrl: string };
    const token = tokenFromLoginUrl(loginUrl);

    const first = await verifyToken(token);
    expect(first.status).toBe(200);

    const second = await verifyToken(token);
    expect(second.status).not.toBe(200);
    expect(second.status).toBeGreaterThanOrEqual(400);
  });

  it('token expirado falha (TTL estourado)', async () => {
    const cookie = await approvedAdminCookie();
    const gen = await genQrLogin(cookie);
    const { loginUrl } = (await gen.json()) as { loginUrl: string };
    const token = tokenFromLoginUrl(loginUrl);

    // O plugin guarda o token (hasheado) em `verification` com identifier
    // `one-time-token:<hash>`. Forçamos a expiração para o passado. O token
    // NUNCA foi consumido, então o verify o ENCONTRA, deleta, e só então falha
    // por expiração — exercitando o caminho de TTL (REQ-8), não o de "não
    // encontrado". Validamos a mensagem específica pra isolar esse caminho.
    await db.verification.updateMany({
      where: { identifier: { startsWith: 'one-time-token:' } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await verifyToken(token);
    expect(res.status).not.toBe(200);
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    expect(body.message ?? '').toMatch(/expired/i);
  });

  it('geração persiste apenas o HASH do token (DB não revela token usável)', async () => {
    const cookie = await approvedAdminCookie();
    const gen = await genQrLogin(cookie);
    const { loginUrl } = (await gen.json()) as { loginUrl: string };
    const token = tokenFromLoginUrl(loginUrl);

    const rows = await db.verification.findMany({
      where: { identifier: { startsWith: 'one-time-token:' } },
    });
    expect(rows.length).toBe(1);
    // O identifier guarda o hash, não o token cru.
    expect(rows[0]!.identifier).not.toContain(token);
  });
});
