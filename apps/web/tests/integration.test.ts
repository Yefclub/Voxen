// ============================================================================
// Integration tests — auth + admin approval flow
// ============================================================================
// Roda contra Postgres real (CI service / docker compose local).
// Skipa se DATABASE_URL não está setado.
// ============================================================================

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { getSetting, setSetting } from '../src/lib/settings';

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
    expect(rotate.status).toBe(201);
    const rotated = (await rotate.json()) as { token: string };

    const promptRes = await app.fetch(
      new Request('http://localhost/api/admin/mcp/prompt', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          appUrl: 'https://voxen.local/admin/integracoes',
          token: rotated.token,
        }),
      }),
    );
    expect(promptRes.status).toBe(200);
    const body = (await promptRes.json()) as { prompt: string };
    expect(body.prompt).toContain('https://voxen.local');
    expect(body.prompt).toContain('https://voxen.local/mcp');
    expect(body.prompt).toContain(rotated.token);
    expect(body.prompt).toContain('Voxen');
    const metadata = await app.fetch(
      new Request('http://localhost/api/admin/mcp', { headers: { cookie } }),
    );
    const adminMcp = (await metadata.json()) as { tokens: { id: string; token?: string }[] };
    expect(adminMcp.tokens[0]).not.toHaveProperty('token');
    const revoke = await app.fetch(
      new Request(`http://localhost/api/admin/mcp/tokens/${adminMcp.tokens[0]!.id}`, {
        method: 'DELETE',
        headers: { cookie },
      }),
    );
    expect(revoke.status).toBe(200);
    const legacyToken = 'legacy-only-mcp-token';
    await setSetting('mcp_api_token', `legacy-owner:${legacyToken}`);
    const legacyAuth = await app.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { authorization: `Bearer ${legacyToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );
    expect(legacyAuth.status).toBe(401);
    const revokeLegacy = await app.fetch(
      new Request('http://localhost/api/admin/mcp', { method: 'DELETE', headers: { cookie } }),
    );
    expect(revokeLegacy.status).toBe(200);
    expect(await getSetting('mcp_api_token')).toBeNull();
  });

  it('emite token MCP por usuário, respeita escopo e permite revogação', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    await signUp('mcp-user@voxen.local', 'senha-super-segura-456', 'MCP User');
    const adminCookie = extractCookie(await signIn('admin@voxen.local', 'senha-super-segura-123'));
    const pending = await db.user.findUnique({ where: { email: 'mcp-user@voxen.local' } });
    await app.fetch(
      new Request(`http://localhost/api/admin/usuarios/${pending!.id}/approve`, {
        method: 'POST',
        headers: { cookie: adminCookie, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const userCookie = extractCookie(
      await signIn('mcp-user@voxen.local', 'senha-super-segura-456'),
    );
    const denied = await app.fetch(
      new Request('http://localhost/api/mcp/tokens', {
        method: 'POST',
        headers: { cookie: userCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Cursor', scopes: ['READ'] }),
      }),
    );
    expect(denied.status).toBe(403);
    const policy = await app.fetch(
      new Request('http://localhost/api/admin/mcp', {
        method: 'PATCH',
        headers: { cookie: adminCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ allowUserTokens: true }),
      }),
    );
    expect(policy.status).toBe(200);
    const created = await app.fetch(
      new Request('http://localhost/api/mcp/tokens', {
        method: 'POST',
        headers: { cookie: userCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Cursor', scopes: ['READ'] }),
      }),
    );
    expect(created.status).toBe(201);
    const token = (await created.json()) as { token: string; metadata: { id: string } };
    const list = await app.fetch(
      new Request('http://localhost/api/mcp/tokens', { headers: { cookie: userCookie } }),
    );
    const listBody = (await list.json()) as { tokens: Record<string, unknown>[] };
    expect(listBody.tokens[0]).not.toHaveProperty('token');
    const tools = await app.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token.token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );
    const toolBody = (await tools.json()) as { result?: { tools?: { name: string }[] } };
    expect(toolBody.result?.tools?.map((item) => item.name)).not.toContain('voxen_create_note');
    const revoke = await app.fetch(
      new Request(`http://localhost/api/mcp/tokens/${token.metadata.id}`, {
        method: 'DELETE',
        headers: { cookie: userCookie },
      }),
    );
    expect(revoke.status).toBe(200);
    const rejected = await app.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { authorization: `Bearer ${token.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );
    expect(rejected.status).toBe(401);
    const delegated = await app.fetch(
      new Request('http://localhost/api/admin/mcp/tokens', {
        method: 'POST',
        headers: { cookie: adminCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ userId: pending!.id, label: 'Admin-managed', scopes: ['READ'] }),
      }),
    );
    const delegatedBody = (await delegated.json()) as { metadata: { id: string } };
    expect(delegated.status).toBe(201);
    const adminRevoke = await app.fetch(
      new Request(`http://localhost/api/admin/mcp/tokens/${delegatedBody.metadata.id}`, {
        method: 'DELETE',
        headers: { cookie: adminCookie },
      }),
    );
    expect(adminRevoke.status).toBe(200);
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

  it('switch do proxy: PATCH liga/desliga o roteamento sem apagar o token', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);

    // Gera o token → liga o switch e aponta o worker pro SOCKS local.
    const gen = await app.fetch(
      new Request('http://localhost/api/admin/proxy-agent/token', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(gen.status).toBe(200);

    const proxyKey = { scope: 'GLOBAL' as const, userId: null, key: 'yt_dlp_proxy_urls' };
    const afterGen = (await (
      await app.fetch(
        new Request('http://localhost/api/admin/proxy-agent', { headers: { cookie } }),
      )
    ).json()) as { enabled: boolean };
    expect(afterGen.enabled).toBe(true);
    expect(await db.setting.findFirst({ where: proxyKey })).not.toBeNull();

    // Desliga: enabled=false e o proxy local é removido (worker baixa direto).
    const off = await app.fetch(
      new Request('http://localhost/api/admin/proxy-agent', {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      }),
    );
    expect(off.status).toBe(200);
    const afterOff = (await (
      await app.fetch(
        new Request('http://localhost/api/admin/proxy-agent', { headers: { cookie } }),
      )
    ).json()) as { enabled: boolean; configured: boolean };
    expect(afterOff.enabled).toBe(false);
    expect(afterOff.configured).toBe(true); // token permanece
    expect(await db.setting.findFirst({ where: proxyKey })).toBeNull();

    // Liga de novo: o proxy local volta.
    const on = await app.fetch(
      new Request('http://localhost/api/admin/proxy-agent', {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }),
    );
    expect(on.status).toBe(200);
    expect(await db.setting.findFirst({ where: proxyKey })).not.toBeNull();

    // Body inválido → 400.
    const bad = await app.fetch(
      new Request('http://localhost/api/admin/proxy-agent', {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: 'yes' }),
      }),
    );
    expect(bad.status).toBe(400);
  });

  it('switch do proxy: PATCH enabled=true sem token é recusado (409)', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);

    const res = await app.fetch(
      new Request('http://localhost/api/admin/proxy-agent', {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }),
    );
    expect(res.status).toBe(409);
    // Não ligou o setting sem token.
    const enabledRow = await db.setting.findFirst({
      where: { scope: 'GLOBAL', userId: null, key: 'proxy_agent_enabled' },
    });
    expect(enabledRow).toBeNull();
  });

  it('user comum recebe 403 em /api/admin/proxy-agent PATCH', async () => {
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

    const res = await app.fetch(
      new Request('http://localhost/api/admin/proxy-agent', {
        method: 'PATCH',
        headers: { cookie: userCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      }),
    );
    expect(res.status).toBe(403);
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
