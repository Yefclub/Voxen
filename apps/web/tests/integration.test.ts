// ============================================================================
// Integration tests — auth + admin approval flow
// ============================================================================
// Roda contra Postgres real (CI service / docker compose local).
// Skipa se DATABASE_URL não está setado.
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
  // Pega o primeiro cookie (better-auth.session_token)
  return set.split(';')[0] ?? '';
}

describeIfDb('auth + admin approval flow', () => {
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

  it('primeiro cadastro vira ADMIN + APPROVED', async () => {
    const res = await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    expect(res.status).toBe(200);
    const user = await db.user.findUnique({ where: { email: 'admin@voxen.local' } });
    expect(user).not.toBeNull();
    expect(user!.role).toBe('ADMIN');
    expect(user!.status).toBe('APPROVED');
    expect(user!.approvedAt).not.toBeNull();
  });

  it('segundo cadastro fica PENDING', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    await signUp('user@voxen.local', 'senha-super-segura-456', 'User');
    const user = await db.user.findUnique({ where: { email: 'user@voxen.local' } });
    expect(user!.role).toBe('USER');
    expect(user!.status).toBe('PENDING');
  });

  it('login de user PENDING é bloqueado com 403', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    await signUp('user@voxen.local', 'senha-super-segura-456', 'User');
    const res = await signIn('user@voxen.local', 'senha-super-segura-456');
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toMatch(/aguardando aprovação/i);
  });

  it('admin pode listar usuários via /api/admin/usuarios', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    await signUp('user@voxen.local', 'senha-super-segura-456', 'User');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    expect(signin.status).toBe(200);
    const cookie = extractCookie(signin);
    const list = await app.fetch(
      new Request('http://localhost/api/admin/usuarios', {
        headers: { cookie },
      }),
    );
    expect(list.status).toBe(200);
    const body = (await list.json()) as { users: { email: string; status: string }[] };
    expect(body.users).toHaveLength(2);
    const pending = body.users.find((u) => u.email === 'user@voxen.local');
    expect(pending?.status).toBe('PENDING');
  });

  it('admin pode aprovar user; depois user consegue logar', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    await signUp('user@voxen.local', 'senha-super-segura-456', 'User');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    const pending = await db.user.findUnique({ where: { email: 'user@voxen.local' } });
    const approveRes = await app.fetch(
      new Request(`http://localhost/api/admin/usuarios/${pending!.id}/approve`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(approveRes.status).toBe(200);
    const updated = await db.user.findUnique({ where: { email: 'user@voxen.local' } });
    expect(updated!.status).toBe('APPROVED');
    expect(updated!.approvedAt).not.toBeNull();
    expect(updated!.approvedBy).toBeTruthy();

    const userLogin = await signIn('user@voxen.local', 'senha-super-segura-456');
    expect(userLogin.status).toBe(200);
  });

  it('admin pode copiar prompt MCP com URL atual e token ativo', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);

    const rotate = await app.fetch(
      new Request('http://localhost/api/admin/mcp/rotate', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(rotate.status).toBe(200);
    const rotated = (await rotate.json()) as { token: string };

    const promptRes = await app.fetch(
      new Request('http://localhost/api/admin/mcp/prompt', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ appUrl: 'https://voxen.local/admin/integracoes' }),
      }),
    );
    expect(promptRes.status).toBe(200);
    const body = (await promptRes.json()) as { prompt: string };
    expect(body.prompt).toContain('https://voxen.local');
    expect(body.prompt).toContain('https://voxen.local/mcp');
    expect(body.prompt).toContain(rotated.token);
    expect(body.prompt).toContain('Voxen');
  });

  it('admin gera token de proxy: persiste cifrado e GET não vaza', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);

    // Estado inicial: não configurado.
    const before = await app.fetch(
      new Request('http://localhost/api/admin/proxy-agent', { headers: { cookie } }),
    );
    expect(before.status).toBe(200);
    const beforeBody = (await before.json()) as {
      configured: boolean;
      connected: boolean;
      conflict: boolean;
    };
    expect(beforeBody.configured).toBe(false);
    expect(beforeBody.connected).toBe(false);
    expect(beforeBody.conflict).toBe(false);

    // Gera o token.
    const gen = await app.fetch(
      new Request('http://localhost/api/admin/proxy-agent/token', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(gen.status).toBe(200);
    const genBody = (await gen.json()) as { token: string };
    // 32 bytes -> base64url (sem padding) = 43 chars. Garante entropia.
    expect(genBody.token.length).toBeGreaterThanOrEqual(43);
    expect(genBody.token).toMatch(/^[A-Za-z0-9_-]+$/);

    // Persistido CIFRADO no DB (valueEnc != texto puro do token).
    const row = await db.setting.findFirst({
      where: { scope: 'GLOBAL', userId: null, key: 'proxy_agent_token' },
      select: { valueEnc: true },
    });
    expect(row).not.toBeNull();
    expect(row!.valueEnc).not.toContain(genBody.token);

    // GET reporta configured=true mas NUNCA devolve o token.
    const after = await app.fetch(
      new Request('http://localhost/api/admin/proxy-agent', { headers: { cookie } }),
    );
    const afterBody = (await after.json()) as Record<string, unknown>;
    expect(afterBody.configured).toBe(true);
    // Sem agente conectado no ambiente de teste, o probe TCP a 127.0.0.1:1080 falha.
    expect(afterBody.connected).toBe(false);
    expect(afterBody.conflict).toBe(false);
    expect(JSON.stringify(afterBody)).not.toContain(genBody.token);

    // Revoga.
    const del = await app.fetch(
      new Request('http://localhost/api/admin/proxy-agent/token', {
        method: 'DELETE',
        headers: { cookie },
      }),
    );
    expect(del.status).toBe(200);
    const gone = await db.setting.findFirst({
      where: { scope: 'GLOBAL', userId: null, key: 'proxy_agent_token' },
    });
    expect(gone).toBeNull();
  });

  it('user comum recebe 403 em /api/admin/proxy-agent', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    await signUp('user@voxen.local', 'senha-super-segura-456', 'User');
    const adminSignin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const adminCookie = extractCookie(adminSignin);
    const pending = await db.user.findUnique({ where: { email: 'user@voxen.local' } });
    await app.fetch(
      new Request(`http://localhost/api/admin/usuarios/${pending!.id}/approve`, {
        method: 'POST',
        headers: { cookie: adminCookie, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const userSignin = await signIn('user@voxen.local', 'senha-super-segura-456');
    const userCookie = extractCookie(userSignin);

    const getRes = await app.fetch(
      new Request('http://localhost/api/admin/proxy-agent', { headers: { cookie: userCookie } }),
    );
    expect(getRes.status).toBe(403);

    const postRes = await app.fetch(
      new Request('http://localhost/api/admin/proxy-agent/token', {
        method: 'POST',
        headers: { cookie: userCookie, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(postRes.status).toBe(403);
  });

  it('non-authenticated recebe 401 em /api/admin/proxy-agent', async () => {
    const res = await app.fetch(new Request('http://localhost/api/admin/proxy-agent'));
    expect(res.status).toBe(401);
  });

  it('user comum recebe 403 em /api/admin/usuarios', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    await signUp('user@voxen.local', 'senha-super-segura-456', 'User');
    // Aprova primeiro pra conseguir logar
    const adminSignin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const adminCookie = extractCookie(adminSignin);
    const pending = await db.user.findUnique({ where: { email: 'user@voxen.local' } });
    await app.fetch(
      new Request(`http://localhost/api/admin/usuarios/${pending!.id}/approve`, {
        method: 'POST',
        headers: { cookie: adminCookie, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const userSignin = await signIn('user@voxen.local', 'senha-super-segura-456');
    const userCookie = extractCookie(userSignin);
    const res = await app.fetch(
      new Request('http://localhost/api/admin/usuarios', {
        headers: { cookie: userCookie },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('non-authenticated recebe 401 em /api/admin/usuarios', async () => {
    const res = await app.fetch(new Request('http://localhost/api/admin/usuarios'));
    expect(res.status).toBe(401);
  });
});
