// ============================================================================
// Integration tests — auth + admin approval flow
// ============================================================================
// Roda contra Postgres real (CI service / docker compose local).
// Skipa se DATABASE_URL não está setado.
// ============================================================================

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import app from '../src/index';
import { auth } from '../src/lib/auth';
import { db } from '../src/lib/db';
import { getMasterKey } from '../src/lib/master-key';
import { getSetting, setSetting } from '../src/lib/settings';
import { decryptOidcConfig, encryptOidcConfig, type StoredOidcConfig } from '../src/lib/sso-oidc';
import {
  createOidcProvider,
  disableOidcProvider,
  requestOidcDomainVerification,
  updateOidcProvider,
} from '../src/lib/sso-provider-service';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;
const oidcKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const oidcPublicJwk = {
  ...oidcKeyPair.publicKey.export({ format: 'jwk' }),
  alg: 'RS256',
  kid: 'voxen-integration-test',
  use: 'sig',
};

function encodeJwtPart(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function oidcIdToken(input: { email: string; emailVerified: boolean; subject: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJwtPart({ alg: 'RS256', kid: oidcPublicJwk.kid, typ: 'JWT' });
  const payload = encodeJwtPart({
    iss: 'https://8.8.8.8',
    aud: 'voxen-corporate-client',
    sub: input.subject,
    email: input.email,
    email_verified: input.emailVerified,
    name: 'Federated User',
    iat: now,
    exp: now + 300,
  });
  const message = `${header}.${payload}`;
  return `${message}.${sign('RSA-SHA256', Buffer.from(message), oidcKeyPair.privateKey).toString('base64url')}`;
}

function responseCookies(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? [headers.get('set-cookie') ?? ''];
  return values
    .filter(Boolean)
    .map((value) => value.split(';')[0])
    .join('; ');
}

function installOidcFetch(input: {
  email: string;
  emailVerified: boolean;
  subject: string;
}): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (request: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
    if (url === 'https://8.8.8.8/token') {
      return Response.json({
        access_token: 'must-not-persist-access',
        refresh_token: 'must-not-persist-refresh',
        id_token: oidcIdToken(input),
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid email profile',
      });
    }
    if (url === 'https://8.8.8.8/jwks') return Response.json({ keys: [oidcPublicJwk] });
    return originalFetch(request, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function wipeDb(): Promise<void> {
  await db.session.deleteMany();
  await db.account.deleteMany();
  await db.verification.deleteMany();
  await db.ssoProvider.deleteMany();
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

async function seedOidcProvider(userId: string, domain = 'example.com'): Promise<void> {
  const config: StoredOidcConfig = {
    issuer: 'https://8.8.8.8',
    discoveryEndpoint: 'https://8.8.8.8/.well-known/openid-configuration',
    authorizationEndpoint: 'https://8.8.8.8/authorize',
    tokenEndpoint: 'https://8.8.8.8/token',
    jwksEndpoint: 'https://8.8.8.8/jwks',
    tokenEndpointAuthentication: 'client_secret_basic',
    clientId: 'voxen-corporate-client',
    clientSecret: 'never-return-this-secret',
    pkce: true,
    scopes: ['openid', 'email', 'profile'],
  };
  await db.ssoProvider.create({
    data: {
      providerId: 'corporate',
      issuer: config.issuer,
      domain,
      domainVerified: true,
      oidcConfig: encryptOidcConfig(config, getMasterKey()),
      userId,
    },
  });
}

const oidcDiscovery = {
  lookupAll: async () => [{ address: '93.184.216.34', family: 4 }],
  discover: (async ({ issuer }: { issuer: string }) => ({
    issuer,
    discoveryEndpoint: `${issuer}/.well-known/openid-configuration`,
    authorizationEndpoint: `${issuer}/authorize-v2`,
    tokenEndpoint: `${issuer}/token-v2`,
    jwksEndpoint: `${issuer}/jwks-v2`,
    tokenEndpointAuthentication: 'client_secret_basic',
  })) as never,
};

async function beginOidc(email: string): Promise<{ cookie: string; state: string }> {
  const response = await app.fetch(
    new Request('http://localhost/api/auth/sign-in/sso', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, callbackURL: '/' }),
    }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { url: string };
  const state = new URL(body.url).searchParams.get('state');
  expect(state).not.toBeNull();
  return { cookie: responseCookies(response), state: state! };
}

async function completeOidc(flow: { cookie: string; state: string }): Promise<Response> {
  return app.fetch(
    new Request(
      `http://localhost/api/auth/sso/callback/corporate?state=${encodeURIComponent(flow.state)}&code=integration-code`,
      { headers: { cookie: flow.cookie } },
    ),
  );
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

  it('admin bloqueia uma conta, invalida suas sessões e pode reativá-la', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    await signUp('user@voxen.local', 'senha-super-segura-456', 'User');
    const adminCookie = extractCookie(await signIn('admin@voxen.local', 'senha-super-segura-123'));
    const user = await db.user.findUniqueOrThrow({ where: { email: 'user@voxen.local' } });

    const approve = await app.fetch(
      new Request(`http://localhost/api/admin/usuarios/${user.id}/approve`, {
        method: 'POST',
        headers: { cookie: adminCookie, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(approve.status).toBe(200);
    expect((await signIn('user@voxen.local', 'senha-super-segura-456')).status).toBe(200);
    expect(await db.session.count({ where: { userId: user.id } })).toBeGreaterThan(0);

    const disable = await app.fetch(
      new Request(`http://localhost/api/admin/usuarios/${user.id}/disable`, {
        method: 'POST',
        headers: { cookie: adminCookie },
      }),
    );
    expect(disable.status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('DISABLED');
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);

    const enable = await app.fetch(
      new Request(`http://localhost/api/admin/usuarios/${user.id}/enable`, {
        method: 'POST',
        headers: { cookie: adminCookie },
      }),
    );
    expect(enable.status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('APPROVED');
  });

  it('protege o último admin e exige o e-mail literal para excluir uma conta', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    await signUp('remove@voxen.local', 'senha-super-segura-456', 'Remove');
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });
    const target = await db.user.findUniqueOrThrow({ where: { email: 'remove@voxen.local' } });
    const adminCookie = extractCookie(await signIn('admin@voxen.local', 'senha-super-segura-123'));

    const lastAdmin = await app.fetch(
      new Request(`http://localhost/api/admin/usuarios/${admin.id}/role`, {
        method: 'PATCH',
        headers: { cookie: adminCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'USER' }),
      }),
    );
    expect(lastAdmin.status).toBe(409);

    const wrongConfirmation = await app.fetch(
      new Request(`http://localhost/api/admin/usuarios/${target.id}`, {
        method: 'DELETE',
        headers: { cookie: adminCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ confirmEmail: ' remove@voxen.local ' }),
      }),
    );
    expect(wrongConfirmation.status).toBe(400);
    expect(await db.user.findUnique({ where: { id: target.id } })).not.toBeNull();

    await db.setting.create({
      data: { scope: 'USER', userId: target.id, key: 'private_setting', valueEnc: 'opaque' },
    });
    await db.verification.create({
      data: {
        identifier: target.email,
        value: 'pending-verification',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const previousS3DeleteDisabled = process.env.S3_DELETE_DISABLED;
    process.env.S3_DELETE_DISABLED = 'true';
    try {
      const deleted = await app.fetch(
        new Request(`http://localhost/api/admin/usuarios/${target.id}`, {
          method: 'DELETE',
          headers: { cookie: adminCookie, 'content-type': 'application/json' },
          body: JSON.stringify({ confirmEmail: target.email }),
        }),
      );
      expect(deleted.status).toBe(200);
    } finally {
      if (previousS3DeleteDisabled === undefined) delete process.env.S3_DELETE_DISABLED;
      else process.env.S3_DELETE_DISABLED = previousS3DeleteDisabled;
    }
    expect(await db.user.findUnique({ where: { id: target.id } })).toBeNull();
    expect(await db.setting.count({ where: { userId: target.id } })).toBe(0);
    expect(await db.verification.count({ where: { identifier: target.email } })).toBe(0);
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
    const initialList = await app.fetch(
      new Request('http://localhost/api/mcp/tokens', { headers: { cookie: userCookie } }),
    );
    expect(await initialList.json()).toMatchObject({ tokens: [], allowCreate: false });
    const adminPersonalList = await app.fetch(
      new Request('http://localhost/api/mcp/tokens', { headers: { cookie: adminCookie } }),
    );
    expect(await adminPersonalList.json()).toMatchObject({ allowCreate: true });
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
    const crossUserRevoke = await app.fetch(
      new Request(`http://localhost/api/mcp/tokens/${token.metadata.id}`, {
        method: 'DELETE',
        headers: { cookie: adminCookie },
      }),
    );
    expect(crossUserRevoke.status).toBe(404);
    const list = await app.fetch(
      new Request('http://localhost/api/mcp/tokens', { headers: { cookie: userCookie } }),
    );
    const listBody = (await list.json()) as {
      tokens: Record<string, unknown>[];
      allowCreate: boolean;
    };
    expect(listBody.allowCreate).toBe(true);
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

  it('mantém provedores OIDC cifrados e redigidos na API administrativa', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });
    const cookie = extractCookie(await signIn('admin@voxen.local', 'senha-super-segura-123'));
    const config: StoredOidcConfig = {
      issuer: 'https://8.8.8.8',
      discoveryEndpoint: 'https://8.8.8.8/.well-known/openid-configuration',
      authorizationEndpoint: 'https://8.8.8.8/authorize',
      tokenEndpoint: 'https://8.8.8.8/token',
      jwksEndpoint: 'https://8.8.8.8/jwks',
      userInfoEndpoint: 'https://8.8.8.8/userinfo',
      tokenEndpointAuthentication: 'client_secret_basic',
      clientId: 'voxen-corporate-client',
      clientSecret: 'never-return-this-secret',
      pkce: true,
      scopes: ['openid', 'email', 'profile'],
    };
    const encrypted = encryptOidcConfig(config, getMasterKey());
    await db.ssoProvider.create({
      data: {
        providerId: 'corporate',
        issuer: config.issuer,
        domain: 'example.com',
        domainVerified: true,
        oidcConfig: encrypted,
        userId: admin.id,
      },
    });

    const response = await app.fetch(
      new Request('http://localhost/api/admin/authentication/providers', {
        headers: { cookie },
      }),
    );
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).toContain('corporate');
    expect(serialized).toContain('ient');
    expect(serialized).toContain('/api/auth/sso/callback/corporate');
    expect(serialized).not.toContain(config.clientId);
    expect(serialized).not.toContain(config.clientSecret);
    expect(
      (await db.ssoProvider.findUniqueOrThrow({ where: { providerId: 'corporate' } })).oidcConfig,
    ).toBe(encrypted);

    const ssoStart = await app.fetch(
      new Request('http://localhost/api/auth/sign-in/sso', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'person@example.com', callbackURL: '/' }),
      }),
    );
    expect(ssoStart.status).toBe(200);
    const ssoBody = (await ssoStart.json()) as { url?: string };
    expect(ssoBody.url).toContain('https://8.8.8.8/authorize');
    expect(ssoBody.url).toContain('client_id=voxen-corporate-client');
  });

  it('inicia SSO para todos os domínios declarados e seus subdomínios', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });
    await seedOidcProvider(admin.id, 'example.com,subsidiary.com');

    for (const email of ['person@subsidiary.com', 'person@team.example.com']) {
      const response = await app.fetch(
        new Request('http://localhost/api/auth/sign-in/sso', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, callbackURL: '/' }),
        }),
      );
      expect(response.status).toBe(200);
      expect(((await response.json()) as { url: string }).url).toContain(
        'https://8.8.8.8/authorize',
      );
    }
  });

  it('reuses an unexpired OIDC DNS challenge instead of rotating published records', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });
    await seedOidcProvider(admin.id);

    const first = await requestOidcDomainVerification('corporate');
    const second = await requestOidcDomainVerification('corporate');

    expect(second).toEqual(first);
    expect(
      await db.verification.count({ where: { identifier: 'voxen-sso-domain:corporate' } }),
    ).toBe(1);
  });

  it('lista e permite excluir um provedor cuja configuração não pode ser decifrada', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });
    const cookie = extractCookie(await signIn('admin@voxen.local', 'senha-super-segura-123'));
    await db.ssoProvider.create({
      data: {
        providerId: 'corrupt-provider',
        issuer: 'https://8.8.8.8',
        domain: 'example.com',
        domainVerified: true,
        oidcConfig: 'corrupt-ciphertext',
        userId: admin.id,
      },
    });

    const listed = await app.fetch(
      new Request('http://localhost/api/admin/authentication/providers', {
        headers: { cookie },
      }),
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      providers: { providerId: string; configurationError: boolean; domainVerified: boolean }[];
    };
    expect(body.providers).toContainEqual(
      expect.objectContaining({
        providerId: 'corrupt-provider',
        configurationError: true,
        domainVerified: false,
      }),
    );

    const rejectedEdit = await app.fetch(
      new Request('http://localhost/api/admin/authentication/providers/corrupt-provider', {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ clientSecret: 'replacement-secret' }),
      }),
    );
    expect(rejectedEdit.status).toBe(409);
    expect(await rejectedEdit.json()).toEqual({
      error: 'Configuração OIDC ilegível. Exclua o provedor e cadastre-o novamente.',
    });

    const removed = await app.fetch(
      new Request('http://localhost/api/admin/authentication/providers/corrupt-provider', {
        method: 'DELETE',
        headers: { cookie },
      }),
    );
    expect(removed.status).toBe(200);
    expect(
      await db.ssoProvider.findFirst({
        where: { providerId: { startsWith: 'disabled:' }, disabledAt: { not: null } },
      }),
    ).not.toBeNull();
  });

  it('não inicia login por provedor ainda não verificado', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });
    const config: StoredOidcConfig = {
      issuer: 'https://8.8.8.8',
      discoveryEndpoint: 'https://8.8.8.8/.well-known/openid-configuration',
      authorizationEndpoint: 'https://8.8.8.8/authorize',
      tokenEndpoint: 'https://8.8.8.8/token',
      jwksEndpoint: 'https://8.8.8.8/jwks',
      tokenEndpointAuthentication: 'client_secret_basic',
      clientId: 'unverified-client',
      clientSecret: 'unverified-secret',
      pkce: true,
      scopes: ['openid', 'email', 'profile'],
    };
    await db.ssoProvider.create({
      data: {
        providerId: 'unverified-provider',
        issuer: config.issuer,
        domain: 'example.com',
        domainVerified: false,
        oidcConfig: encryptOidcConfig(config, getMasterKey()),
        userId: admin.id,
      },
    });

    const response = await app.fetch(
      new Request('http://localhost/api/auth/sign-in/sso', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'person@example.com', callbackURL: '/' }),
      }),
    );
    expect(response.status).not.toBe(200);
    expect(await response.text()).not.toContain('https://8.8.8.8/authorize');
  });

  it('rejeita pkce=false também no contrato administrativo', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const cookie = extractCookie(await signIn('admin@voxen.local', 'senha-super-segura-123'));
    const response = await app.fetch(
      new Request('http://localhost/api/admin/authentication/providers', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          providerId: 'weak-provider',
          issuer: 'https://8.8.8.8',
          domains: ['example.com'],
          clientId: 'weak-client',
          clientSecret: 'weak-secret',
          pkce: false,
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('PKCE');
    expect(await db.ssoProvider.count()).toBe(0);
  });

  it('serializa cadastros concorrentes e impede domínios OIDC sobrepostos', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });
    const discovery = {
      lookupAll: async () => [{ address: '93.184.216.34', family: 4 }],
      discover: (async ({ issuer }: { issuer: string }) => ({
        issuer,
        discoveryEndpoint: `${issuer}/.well-known/openid-configuration`,
        authorizationEndpoint: `${issuer}/authorize`,
        tokenEndpoint: `${issuer}/token`,
        jwksEndpoint: `${issuer}/jwks`,
        tokenEndpointAuthentication: 'client_secret_basic',
      })) as never,
    };
    const results = await Promise.allSettled([
      createOidcProvider(
        {
          providerId: 'corporate-a',
          issuer: 'https://id-a.example.com',
          domains: ['example.com'],
          clientId: 'client-a',
          clientSecret: 'client-secret-a',
        },
        admin.id,
        discovery,
      ),
      createOidcProvider(
        {
          providerId: 'corporate-b',
          issuer: 'https://id-b.example.com',
          domains: ['team.example.com'],
          clientId: 'client-b',
          clientSecret: 'client-secret-b',
        },
        admin.id,
        discovery,
      ),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await db.ssoProvider.count()).toBe(1);
  });

  it('permite rotação de segredo e metadata descoberta sem trocar a identidade', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    await signUp('member@example.com', 'senha-super-segura-456', 'Member');
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });
    const member = await db.user.findUniqueOrThrow({ where: { email: 'member@example.com' } });
    await seedOidcProvider(admin.id);
    await db.account.create({
      data: {
        userId: member.id,
        providerId: 'corporate',
        accountId: 'immutable-subject',
      },
    });

    await updateOidcProvider('corporate', { clientSecret: 'rotated-client-secret' }, oidcDiscovery);

    const provider = await db.ssoProvider.findUniqueOrThrow({ where: { providerId: 'corporate' } });
    const config = decryptOidcConfig(provider.oidcConfig!, getMasterKey());
    expect(config.clientSecret).toBe('rotated-client-secret');
    expect(config.tokenEndpoint).toBe('https://8.8.8.8/token-v2');
    expect(
      await db.account.findUnique({
        where: {
          providerId_accountId: { providerId: 'corporate', accountId: 'immutable-subject' },
        },
      }),
    ).not.toBeNull();
  });

  it('libera o identificador excluído sem herdar vínculos federados antigos', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    await signUp('member@example.com', 'senha-super-segura-456', 'Member');
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });
    const member = await db.user.findUniqueOrThrow({ where: { email: 'member@example.com' } });
    await seedOidcProvider(admin.id);
    await db.account.create({
      data: {
        userId: member.id,
        providerId: 'corporate',
        accountId: 'old-provider-subject',
      },
    });

    await disableOidcProvider('corporate');
    const tombstoned = await db.ssoProvider.findFirstOrThrow({
      where: { disabledAt: { not: null } },
    });
    expect(tombstoned.providerId).toBe(`disabled:${tombstoned.id}`);
    expect(tombstoned.oidcConfig).toBeNull();
    const oldAccount = await db.account.findFirstOrThrow({
      where: { accountId: 'old-provider-subject' },
    });
    expect(oldAccount.providerId).toBe(`disabled:${tombstoned.id}`);
    expect(oldAccount.userId).toBe(member.id);

    await createOidcProvider(
      {
        providerId: 'corporate',
        issuer: 'https://8.8.8.8',
        domains: ['example.com'],
        clientId: 'replacement-client',
        clientSecret: 'replacement-secret',
      },
      admin.id,
      oidcDiscovery,
    );
    const replacement = await db.ssoProvider.findUniqueOrThrow({
      where: { providerId: 'corporate' },
    });
    expect(replacement.id).not.toBe(tombstoned.id);
    expect(await db.user.findUnique({ where: { id: member.id } })).not.toBeNull();
  });

  it('conclui o callback OIDC, vincula a conta existente e descarta todos os tokens', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    await signUp('member@example.com', 'senha-super-segura-456', 'Member');
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });
    const member = await db.user.update({
      where: { email: 'member@example.com' },
      data: { status: 'APPROVED', approvedAt: new Date(), approvedBy: admin.id },
    });
    await seedOidcProvider(admin.id);
    const flow = await beginOidc(member.email);
    const restoreFetch = installOidcFetch({
      email: member.email,
      emailVerified: true,
      subject: 'existing-member-subject',
    });
    let callback: Response;
    try {
      callback = await completeOidc(flow);
    } finally {
      restoreFetch();
    }

    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/');
    expect(responseCookies(callback)).toContain('better-auth.session_token');
    expect(await db.user.count()).toBe(2);
    const account = await db.account.findFirstOrThrow({
      where: { providerId: 'corporate', accountId: 'existing-member-subject' },
    });
    expect(account.userId).toBe(member.id);
    expect(account.accessToken).toBeNull();
    expect(account.refreshToken).toBeNull();
    expect(account.idToken).toBeNull();
  });

  it('não vincula conta existente quando o IdP não verificou o e-mail', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    await signUp('member@example.com', 'senha-super-segura-456', 'Member');
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });
    const member = await db.user.update({
      where: { email: 'member@example.com' },
      data: { status: 'APPROVED', approvedAt: new Date(), approvedBy: admin.id },
    });
    await seedOidcProvider(admin.id);
    const flow = await beginOidc(member.email);
    const restoreFetch = installOidcFetch({
      email: member.email,
      emailVerified: false,
      subject: 'unverified-existing-subject',
    });
    try {
      const callback = await completeOidc(flow);
      expect(callback.status).toBe(302);
      expect(callback.headers.get('location')).toContain('error');
    } finally {
      restoreFetch();
    }

    expect(
      await db.account.findFirst({
        where: { providerId: 'corporate', accountId: 'unverified-existing-subject' },
      }),
    ).toBeNull();
    expect(await db.session.count({ where: { userId: member.id } })).toBe(0);
  });

  it('recusa redirects inesperados na troca de token e na leitura do JWKS', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });
    await seedOidcProvider(admin.id);
    const flow = await beginOidc('redirect-check@example.com');
    const originalFetch = globalThis.fetch;
    let tokenRedirectMode: RequestRedirect | undefined;
    let jwksRedirectMode: RequestRedirect | undefined;
    let followedPrivateLocation = false;
    globalThis.fetch = (async (request: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
      if (url === 'https://8.8.8.8/token') {
        tokenRedirectMode = init?.redirect;
        return Response.json({
          access_token: 'ephemeral-access',
          id_token: oidcIdToken({
            email: 'redirect-check@example.com',
            emailVerified: true,
            subject: 'redirect-check-subject',
          }),
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }
      if (url === 'https://8.8.8.8/jwks') {
        jwksRedirectMode = init?.redirect;
        return new Response(null, {
          status: 302,
          headers: { location: 'https://127.0.0.1/private-jwks' },
        });
      }
      if (url === 'https://127.0.0.1/private-jwks') followedPrivateLocation = true;
      return originalFetch(request, init);
    }) as typeof fetch;
    try {
      const callback = await completeOidc(flow);
      expect(callback.status).toBe(302);
      expect(callback.headers.get('location')).toContain('token_not_verified');
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(tokenRedirectMode).toBe('manual');
    expect(jwksRedirectMode).toBe('manual');
    expect(followedPrivateLocation).toBe(false);
    expect(await db.user.findUnique({ where: { email: 'redirect-check@example.com' } })).toBeNull();
  });

  it('provisiona usuário OIDC novo como PENDING sem liberar sessão', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });
    await seedOidcProvider(admin.id);
    const flow = await beginOidc('new-member@example.com');
    const restoreFetch = installOidcFetch({
      email: 'new-member@example.com',
      emailVerified: true,
      subject: 'new-member-subject',
    });
    let callback: Response;
    try {
      callback = await completeOidc(flow);
    } finally {
      restoreFetch();
    }

    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toContain('ACCOUNT_PENDING');
    const user = await db.user.findUniqueOrThrow({ where: { email: 'new-member@example.com' } });
    expect(user.status).toBe('PENDING');
    expect(user.role).toBe('USER');
    const account = await db.account.findFirstOrThrow({
      where: { providerId: 'corporate', accountId: 'new-member-subject' },
    });
    expect(account.userId).toBe(user.id);
    expect(account.accessToken).toBeNull();
    expect(account.refreshToken).toBeNull();
    expect(account.idToken).toBeNull();
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('propaga códigos estáveis e não cria sessão para contas REJECTED ou DISABLED', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });
    await seedOidcProvider(admin.id);

    for (const [status, email, subject, expectedCode] of [
      ['REJECTED', 'rejected@example.com', 'rejected-subject', 'ACCOUNT_REJECTED'],
      ['DISABLED', 'disabled@example.com', 'disabled-subject', 'ACCOUNT_DISABLED'],
    ] as const) {
      await signUp(email, 'senha-super-segura-456', status);
      const user = await db.user.update({ where: { email }, data: { status } });
      const flow = await beginOidc(email);
      const restoreFetch = installOidcFetch({ email, emailVerified: true, subject });
      try {
        const callback = await completeOidc(flow);
        expect(callback.status).toBe(302);
        expect(callback.headers.get('location')).toContain(expectedCode);
      } finally {
        restoreFetch();
      }
      expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    }
  });

  it('recusa provisionamento OIDC fechado, não verificado ou fora do domínio', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });
    await seedOidcProvider(admin.id);
    await setSetting('onboarding_done', 'true');
    await setSetting('allow_signups', 'false');

    const closedFlow = await beginOidc('closed@example.com');
    let restoreFetch = installOidcFetch({
      email: 'closed@example.com',
      emailVerified: true,
      subject: 'closed-subject',
    });
    try {
      const callback = await completeOidc(closedFlow);
      expect(callback.status).toBe(302);
      expect(callback.headers.get('location')).toContain('/api/auth/error?error=');
    } finally {
      restoreFetch();
    }
    expect(await db.user.findUnique({ where: { email: 'closed@example.com' } })).toBeNull();

    await setSetting('allow_signups', 'true');
    const unverifiedFlow = await beginOidc('unverified@example.com');
    restoreFetch = installOidcFetch({
      email: 'unverified@example.com',
      emailVerified: false,
      subject: 'unverified-subject',
    });
    try {
      const callback = await completeOidc(unverifiedFlow);
      expect(callback.status).toBe(302);
      expect(callback.headers.get('location')).toContain('error');
    } finally {
      restoreFetch();
    }
    expect(await db.user.findUnique({ where: { email: 'unverified@example.com' } })).toBeNull();

    const wrongDomainFlow = await beginOidc('expected@example.com');
    restoreFetch = installOidcFetch({
      email: 'attacker@outside.invalid',
      emailVerified: true,
      subject: 'wrong-domain-subject',
    });
    try {
      const callback = await completeOidc(wrongDomainFlow);
      expect(callback.status).toBe(302);
      expect(callback.headers.get('location')).toContain('error');
    } finally {
      restoreFetch();
    }
    expect(await db.user.findUnique({ where: { email: 'attacker@outside.invalid' } })).toBeNull();
    expect(await db.account.count({ where: { providerId: 'corporate' } })).toBe(0);
  });

  it('nega a gestão OIDC para usuário comum', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    await signUp('user@voxen.local', 'senha-super-segura-456', 'User');
    const adminCookie = extractCookie(await signIn('admin@voxen.local', 'senha-super-segura-123'));
    const user = await db.user.findUniqueOrThrow({ where: { email: 'user@voxen.local' } });
    await app.fetch(
      new Request(`http://localhost/api/admin/usuarios/${user.id}/approve`, {
        method: 'POST',
        headers: { cookie: adminCookie, 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    const userCookie = extractCookie(await signIn('user@voxen.local', 'senha-super-segura-456'));
    const response = await app.fetch(
      new Request('http://localhost/api/admin/authentication/providers', {
        headers: { cookie: userCookie },
      }),
    );
    expect(response.status).toBe(403);
  });

  it('falha fechado antes do callback quando um endpoint OIDC deixa de ser público', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });
    const privateConfig: StoredOidcConfig = {
      issuer: 'https://id.example.com',
      discoveryEndpoint: 'https://id.example.com/.well-known/openid-configuration',
      authorizationEndpoint: 'https://id.example.com/authorize',
      tokenEndpoint: 'https://127.0.0.1/token',
      jwksEndpoint: 'https://id.example.com/jwks',
      tokenEndpointAuthentication: 'client_secret_basic',
      clientId: 'private-endpoint-client',
      clientSecret: 'private-endpoint-secret',
      pkce: true,
      scopes: ['openid', 'email', 'profile'],
    };
    await db.ssoProvider.create({
      data: {
        providerId: 'private-endpoint',
        issuer: privateConfig.issuer,
        domain: 'example.com',
        domainVerified: true,
        oidcConfig: encryptOidcConfig(privateConfig, getMasterKey()),
        userId: admin.id,
      },
    });

    const callback = await app.fetch(
      new Request(
        'http://localhost/api/auth/sso/callback/private-endpoint?state=opaque&code=opaque',
      ),
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/entrar?error=SSO_ENDPOINT_UNAVAILABLE');

    const sharedCallback = await app.fetch(
      new Request('http://localhost/api/auth/sso/callback?state=opaque&code=opaque'),
    );
    expect(sharedCallback.status).toBe(404);
  });

  it('limita callbacks OIDC não autenticados por IP antes do trabalho do provedor', async () => {
    const ip = `203.0.113.${(Math.floor(Date.now() / 1000) % 200) + 1}`;
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const response = await app.fetch(
        new Request('http://localhost/api/auth/sso/callback/missing?state=x&code=x', {
          headers: { 'cf-connecting-ip': ip },
        }),
      );
      expect(response.status).toBe(302);
    }
    const limited = await app.fetch(
      new Request('http://localhost/api/auth/sso/callback/missing?state=x&code=x', {
        headers: { 'cf-connecting-ip': ip },
      }),
    );
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('rate-limits unauthenticated OIDC sign-in initiation by IP', async () => {
    const ip = `198.51.100.${(Math.floor(Date.now() / 1000) % 200) + 1}`;
    const request = () =>
      app.fetch(
        new Request('http://localhost/api/auth/sign-in/sso', {
          method: 'POST',
          headers: { 'cf-connecting-ip': ip, 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'missing@example.com', callbackURL: '/' }),
        }),
      );

    for (let attempt = 1; attempt <= 60; attempt += 1) {
      expect((await request()).status).not.toBe(429);
    }
    const limited = await request();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('aplica o bloqueio global de cadastros também na API interna do Better Auth', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    await setSetting('onboarding_done', 'true');
    await setSetting('allow_signups', 'false');

    await expect(
      auth.api.signUpEmail({
        body: {
          email: 'blocked@voxen.local',
          password: 'senha-super-segura-789',
          name: 'Blocked',
        },
      }),
    ).rejects.toMatchObject({ status: 'FORBIDDEN' });
    expect(await db.user.findUnique({ where: { email: 'blocked@voxen.local' } })).toBeNull();
  });

  it('persists interface mode only for the authenticated account and rejects unknown modes', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    await signUp('user@voxen.local', 'senha-super-segura-456', 'User');
    const adminCookie = extractCookie(await signIn('admin@voxen.local', 'senha-super-segura-123'));
    const user = await db.user.findUniqueOrThrow({ where: { email: 'user@voxen.local' } });
    await app.fetch(
      new Request(`http://localhost/api/admin/usuarios/${user.id}/approve`, {
        method: 'POST',
        headers: { cookie: adminCookie, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const userCookie = extractCookie(await signIn('user@voxen.local', 'senha-super-segura-456'));

    const update = await app.fetch(
      new Request('http://localhost/api/account', {
        method: 'PATCH',
        headers: { cookie: adminCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ interfaceMode: 'focus' }),
      }),
    );
    expect(update.status).toBe(200);
    expect((await update.json()) as unknown).toMatchObject({
      user: { interfaceMode: 'focus' },
    });

    const adminMe = await app.fetch(
      new Request('http://localhost/api/me', { headers: { cookie: adminCookie } }),
    );
    const userMe = await app.fetch(
      new Request('http://localhost/api/me', { headers: { cookie: userCookie } }),
    );
    expect((await adminMe.json()) as unknown).toMatchObject({
      user: { email: 'admin@voxen.local', interfaceMode: 'focus' },
    });
    expect((await userMe.json()) as unknown).toMatchObject({
      user: { email: 'user@voxen.local', interfaceMode: 'classic' },
    });

    const invalid = await app.fetch(
      new Request('http://localhost/api/account', {
        method: 'PATCH',
        headers: { cookie: userCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ interfaceMode: 'immersive' }),
      }),
    );
    expect(invalid.status).toBe(400);
    expect(
      (await db.user.findUniqueOrThrow({ where: { email: 'user@voxen.local' } })).interfaceMode,
    ).toBe('classic');

    await db.user.update({
      where: { email: 'user@voxen.local' },
      data: { interfaceMode: 'unsupported-value' },
    });
    const defensiveMe = await app.fetch(
      new Request('http://localhost/api/me', { headers: { cookie: userCookie } }),
    );
    const defensiveAccount = await app.fetch(
      new Request('http://localhost/api/account', { headers: { cookie: userCookie } }),
    );
    expect((await defensiveMe.json()) as unknown).toMatchObject({
      user: { interfaceMode: 'classic' },
    });
    expect((await defensiveAccount.json()) as unknown).toMatchObject({
      user: { interfaceMode: 'classic' },
    });
  });
});
