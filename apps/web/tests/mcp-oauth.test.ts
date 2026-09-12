import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createHash, randomBytes } from 'node:crypto';
import app from '../src/index';
import { db } from '../src/lib/db';
import { resolveMcpOAuthResource } from '../src/lib/auth';
import { getRedisPublisher } from '../src/lib/redis';
import { setSettings } from '../src/lib/settings';
import { oauthResponseHasErrorRedirect } from '../src/routes/public-authentication';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;
const PASSWORD = 'senha-super-segura-123';
const TEST_SOURCE = `mcp-oauth-suite-${crypto.randomUUID()}`;

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', TEST_SOURCE);
  return app.fetch(new Request(`http://localhost${path}`, { ...init, headers }));
}

function json(method: string, body: unknown, cookie?: string): RequestInit {
  return {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  };
}

function base64UrlSha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

describeIfDb('MCP OAuth 2.1 authorization server', () => {
  let userId = '';
  let cookie = '';
  let clientId = '';
  let confidentialClientId = '';
  let confidentialClientSecret = '';
  let foreignUserId = '';
  let foreignTranscriptId = '';
  let accessToken = '';
  let refreshToken = '';
  const redirectUri = 'http://127.0.0.1:49152/callback';

  async function introspectConfidentialToken(token: string): Promise<{ active: boolean }> {
    const response = await request('/api/auth/oauth2/introspect', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: confidentialClientId,
        client_secret: confidentialClientSecret,
        token,
      }),
    });
    const responseBody = await response.clone().text();
    expect(response.status, responseBody).toBe(200);
    return (await response.json()) as { active: boolean };
  }

  async function issueConfidentialTokens(): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const verifier = randomBytes(48).toString('base64url');
    const query = new URLSearchParams({
      client_id: confidentialClientId,
      redirect_uri: 'https://client.example/callback',
      response_type: 'code',
      scope: 'mcp:read offline_access',
      resource: resolveMcpOAuthResource(),
      prompt: 'consent',
      code_challenge: base64UrlSha256(verifier),
      code_challenge_method: 'S256',
    });
    const authorize = await request(`/api/auth/oauth2/authorize?${query}`, {
      headers: { cookie },
      redirect: 'manual',
    });
    expect(authorize.status).toBeGreaterThanOrEqual(300);
    expect(authorize.status).toBeLessThan(400);
    const signedQuery = new URL(
      authorize.headers.get('location') ?? '',
      'http://localhost',
    ).search.slice(1);
    const consent = await request(
      '/api/auth/oauth2/consent',
      json('POST', { accept: true, oauth_query: signedQuery }, cookie),
    );
    expect(consent.status).toBe(200);
    const consentBody = (await consent.json()) as { url?: string; redirect_uri?: string };
    const code = new URL(consentBody.url ?? consentBody.redirect_uri ?? '').searchParams.get(
      'code',
    );
    expect(code?.length ?? 0).toBeGreaterThan(10);
    const token = await request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: confidentialClientId,
        client_secret: confidentialClientSecret,
        code: code ?? '',
        redirect_uri: 'https://client.example/callback',
        code_verifier: verifier,
        resource: resolveMcpOAuthResource(),
      }),
    });
    expect(token.status).toBe(200);
    const body = (await token.json()) as { access_token: string; refresh_token: string };
    return { accessToken: body.access_token, refreshToken: body.refresh_token };
  }

  beforeAll(async () => {
    await getRedisPublisher().del(
      'voxen:rl:mcp-oauth:register:peer:unknown',
      'voxen:rl:mcp-oauth:register:global',
    );
    await setSettings({ mcp_oauth_enabled: 'true' });
    const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const email = `mcp-oauth-${suffix}@voxen.local`;
    const signup = await request(
      '/api/auth/sign-up/email',
      json('POST', { email, password: PASSWORD, name: 'MCP OAuth Test' }),
    );
    expect(signup.status).toBe(200);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    userId = user.id;
    await db.user.update({ where: { id: userId }, data: { status: 'APPROVED' } });
    const foreignUser = await db.user.create({
      data: {
        email: `mcp-oauth-foreign-${suffix}@voxen.local`,
        name: 'Foreign MCP workspace',
        status: 'APPROVED',
      },
    });
    foreignUserId = foreignUser.id;
    const foreignTranscript = await db.transcript.create({
      data: {
        userId: foreignUserId,
        source: 'WEB',
        url: `https://example.com/mcp-oauth-foreign-${suffix}`,
        title: 'FOREIGN_OAUTH_SECRET',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${foreignUserId}/transcripts/foreign.md`,
        plainText: 'FOREIGN_OAUTH_SECRET',
        frontmatter: {},
      },
    });
    foreignTranscriptId = foreignTranscript.id;
    const signin = await request(
      '/api/auth/sign-in/email',
      json('POST', { email, password: PASSWORD }),
    );
    expect(signin.status).toBe(200);
    cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  });

  afterAll(async () => {
    await setSettings({ mcp_oauth_enabled: 'false' });
    await getRedisPublisher().del(
      'voxen:rl:mcp-oauth:register:peer:unknown',
      'voxen:rl:mcp-oauth:register:global',
    );
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    if (foreignUserId) {
      await db.user.delete({ where: { id: foreignUserId } }).catch(() => undefined);
    }
    await db.oauthClient
      .deleteMany({ where: { clientId: { in: [clientId, confidentialClientId].filter(Boolean) } } })
      .catch(() => undefined);
  });

  it('publishes protected-resource and authorization-server metadata', async () => {
    const resource = await request('/.well-known/oauth-protected-resource/mcp');
    expect(resource.status).toBe(200);
    const resourceBody = (await resource.json()) as Record<string, unknown>;
    expect(resourceBody.resource).toBe(resolveMcpOAuthResource());
    expect(resourceBody.scopes_supported).toEqual(['mcp:read', 'mcp:write']);

    const authority = await request('/.well-known/oauth-authorization-server/api/auth');
    expect(authority.status).toBe(200);
    const authorityBody = (await authority.json()) as Record<string, unknown>;
    expect(authorityBody.code_challenge_methods_supported).toContain('S256');
    expect(authorityBody.grant_types_supported).toContain('refresh_token');
  });

  it('registers a public PKCE client without returning a reusable secret', async () => {
    const unsafe = await request(
      '/api/auth/oauth2/register',
      json('POST', {
        client_name: 'Unsafe client',
        redirect_uris: ['https://*.example.com/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
      }),
    );
    expect(unsafe.status).toBe(400);

    const response = await request(
      '/api/auth/oauth2/register',
      json('POST', {
        client_name: 'Voxen MCP integration test',
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'mcp:read offline_access',
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      client_id: string;
      client_secret?: string;
      require_pkce?: boolean;
    };
    clientId = body.client_id;
    expect(clientId.length).toBeGreaterThan(10);
    expect(body.client_secret).toBeUndefined();
    expect(body.require_pkce).not.toBe(false);
  });

  it('records redirected OAuth protocol errors as failed authorization', async () => {
    const startedAt = new Date();
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'unsupported:scope',
      resource: resolveMcpOAuthResource(),
      code_challenge: base64UrlSha256(randomBytes(48).toString('base64url')),
      code_challenge_method: 'S256',
    });
    const response = await request(`/api/auth/oauth2/authorize?${query}`, {
      headers: { cookie },
      redirect: 'manual',
    });
    expect(oauthResponseHasErrorRedirect(response)).toBe(true);
    const audit = await db.mcpOauthAuditEvent.findFirst({
      where: { event: 'authorization', clientId, createdAt: { gte: startedAt } },
      orderBy: { createdAt: 'desc' },
      select: { outcome: true },
    });
    expect(audit?.outcome).toBe('failed');
  });

  it('requires exact redirect URI and S256 PKCE', async () => {
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${redirectUri}/wrong`,
      response_type: 'code',
      scope: 'mcp:read',
      resource: resolveMcpOAuthResource(),
      code_challenge: 'plain-value',
      code_challenge_method: 'plain',
    });
    const response = await request(`/api/auth/oauth2/authorize?${query}`, {
      headers: { cookie },
      redirect: 'manual',
    });
    expect(response.status).toBeGreaterThanOrEqual(400);

    const missingPkce = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'mcp:read',
      resource: resolveMcpOAuthResource(),
    });
    const withoutPkce = await request(`/api/auth/oauth2/authorize?${missingPkce}`, {
      headers: { cookie },
      redirect: 'manual',
    });
    expect(withoutPkce.headers.get('location') ?? '').not.toContain('/oauth/consent');

    const wrongResource = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'mcp:read',
      resource: 'https://other.example/mcp',
      code_challenge: base64UrlSha256(randomBytes(48).toString('base64url')),
      code_challenge_method: 'S256',
    });
    const rejectedResource = await request(`/api/auth/oauth2/authorize?${wrongResource}`, {
      headers: { cookie },
      redirect: 'manual',
    });
    expect(rejectedResource.headers.get('location') ?? '').not.toContain('/oauth/consent');
  });

  it('denies consent without creating a grant', async () => {
    const verifier = randomBytes(48).toString('base64url');
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'mcp:read',
      resource: resolveMcpOAuthResource(),
      state: 'deny-state',
      prompt: 'consent',
      code_challenge: base64UrlSha256(verifier),
      code_challenge_method: 'S256',
    });
    const authorize = await request(`/api/auth/oauth2/authorize?${query}`, {
      headers: { cookie },
      redirect: 'manual',
    });
    const signedQuery = new URL(
      authorize.headers.get('location') ?? '',
      'http://localhost',
    ).search.slice(1);
    const escalation = await request(
      '/api/auth/oauth2/consent',
      json('POST', { accept: true, scope: 'mcp:read mcp:write', oauth_query: signedQuery }, cookie),
    );
    expect(escalation.status).toBeGreaterThanOrEqual(400);
    const denied = await request(
      '/api/auth/oauth2/consent',
      json('POST', { accept: false, oauth_query: signedQuery }, cookie),
    );
    expect(denied.status).toBe(200);
    const body = (await denied.json()) as { url?: string; redirect_uri?: string };
    const callback = new URL(body.url ?? body.redirect_uri ?? '');
    expect(callback.searchParams.get('error')).toBe('access_denied');
    expect(callback.searchParams.get('state')).toBe('deny-state');
    expect(await db.oauthConsent.count({ where: { clientId, userId } })).toBe(0);
  });

  it('rejects an expired authorization code', async () => {
    const verifier = randomBytes(48).toString('base64url');
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'mcp:read',
      resource: resolveMcpOAuthResource(),
      prompt: 'consent',
      code_challenge: base64UrlSha256(verifier),
      code_challenge_method: 'S256',
    });
    const authorize = await request(`/api/auth/oauth2/authorize?${query}`, {
      headers: { cookie },
      redirect: 'manual',
    });
    const signedQuery = new URL(
      authorize.headers.get('location') ?? '',
      'http://localhost',
    ).search.slice(1);
    const existingCodes = await db.verification.findMany({ select: { id: true } });
    const consent = await request(
      '/api/auth/oauth2/consent',
      json('POST', { accept: true, oauth_query: signedQuery }, cookie),
    );
    expect(consent.status).toBe(200);
    const consentBody = (await consent.json()) as { url?: string; redirect_uri?: string };
    const code = new URL(consentBody.url ?? consentBody.redirect_uri ?? '').searchParams.get(
      'code',
    );
    expect(code?.length ?? 0).toBeGreaterThan(10);
    const authorizationCode = await db.verification.findFirst({
      where: { id: { notIn: existingCodes.map((item) => item.id) } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    expect(authorizationCode).not.toBeNull();
    await db.verification.update({
      where: { id: authorizationCode!.id },
      data: { expiresAt: new Date(0) },
    });

    const token = await request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code: code ?? '',
        redirect_uri: redirectUri,
        code_verifier: verifier,
        resource: resolveMcpOAuthResource(),
      }),
    });
    expect(token.status).toBeGreaterThanOrEqual(400);
  });

  it('completes authorization-code PKCE, refresh, and MCP access', async () => {
    const verifier = randomBytes(48).toString('base64url');
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'mcp:read offline_access',
      resource: resolveMcpOAuthResource(),
      state: 'opaque-state',
      prompt: 'consent',
      code_challenge: base64UrlSha256(verifier),
      code_challenge_method: 'S256',
    });
    const authorize = await request(`/api/auth/oauth2/authorize?${query}`, {
      headers: { cookie },
      redirect: 'manual',
    });
    expect(authorize.status).toBeGreaterThanOrEqual(300);
    expect(authorize.status).toBeLessThan(400);
    const consentLocation = authorize.headers.get('location') ?? '';
    const signedQuery = new URL(consentLocation, 'http://localhost').search.slice(1);
    expect(consentLocation).toContain('/oauth/consent');
    expect(signedQuery).toContain('sig=');

    const context = await request(`/api/mcp/oauth/consent-context?${signedQuery}`, {
      headers: { cookie },
    });
    expect(context.status).toBe(200);
    const contextBody = (await context.json()) as { clientId: string; resource: string };
    expect(contextBody.clientId).toBe(clientId);
    expect(contextBody.resource).toBe(resolveMcpOAuthResource());

    const consent = await request(
      '/api/auth/oauth2/consent',
      json('POST', { accept: true, oauth_query: signedQuery }, cookie),
    );
    expect(consent.status).toBe(200);
    const consentBody = (await consent.json()) as { url?: string; redirect_uri?: string };
    const callback = new URL(consentBody.url ?? consentBody.redirect_uri ?? '');
    expect(callback.searchParams.get('state')).toBe('opaque-state');
    let code = callback.searchParams.get('code') ?? '';
    expect(code.length).toBeGreaterThan(10);

    const mismatch = await request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: `${verifier}wrong`,
        resource: resolveMcpOAuthResource(),
      }),
    });
    expect(mismatch.status).toBeGreaterThanOrEqual(400);

    // A failed verifier consumes the one-time code. Start a fresh signed
    // authorization rather than retrying a credential that must be dead.
    const authorizeAgain = await request(`/api/auth/oauth2/authorize?${query}`, {
      headers: { cookie },
      redirect: 'manual',
    });
    const nextSignedQuery = new URL(
      authorizeAgain.headers.get('location') ?? '',
      'http://localhost',
    ).search.slice(1);
    const consentAgain = await request(
      '/api/auth/oauth2/consent',
      json('POST', { accept: true, oauth_query: nextSignedQuery }, cookie),
    );
    const consentAgainBody = (await consentAgain.json()) as { url?: string; redirect_uri?: string };
    code =
      new URL(consentAgainBody.url ?? consentAgainBody.redirect_uri ?? '').searchParams.get(
        'code',
      ) ?? '';
    expect(code.length).toBeGreaterThan(10);

    const token = await request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        resource: resolveMcpOAuthResource(),
      }),
    });
    expect(token.status).toBe(200);
    const tokenBody = (await token.json()) as {
      access_token: string;
      refresh_token: string;
      scope: string;
      token_type: string;
    };
    accessToken = tokenBody.access_token;
    refreshToken = tokenBody.refresh_token;
    expect(tokenBody.token_type.toLowerCase()).toBe('bearer');
    expect(tokenBody.scope).toContain('mcp:read');

    const mcp = await request('/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(mcp.status).toBe(200);
    const mcpBody = (await mcp.json()) as { result?: { tools?: { name: string }[] } };
    expect(mcpBody.result?.tools?.some((tool) => tool.name === 'voxen_create_note')).toBe(false);

    const foreignRead = await request('/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'voxen_read_transcript',
          arguments: { transcript_id: foreignTranscriptId },
        },
      }),
    });
    expect(foreignRead.status).toBe(200);
    const foreignBody = (await foreignRead.json()) as { result?: { isError?: boolean } };
    expect(foreignBody.result?.isError).toBe(true);
    expect(JSON.stringify(foreignBody)).not.toContain('FOREIGN_OAUTH_SECRET');

    await db.oauthClient.update({ where: { clientId }, data: { disabled: true } });
    const disabledClient = await request('/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'tools/list' }),
    });
    expect(disabledClient.status).toBe(401);
    await db.oauthClient.update({ where: { clientId }, data: { disabled: false } });

    await db.user.update({ where: { id: userId }, data: { status: 'DISABLED' } });
    const disabledUser = await request('/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 12, method: 'tools/list' }),
    });
    expect(disabledUser.status).toBe(401);
    await db.user.update({ where: { id: userId }, data: { status: 'APPROVED' } });

    const write = await request('/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'voxen_create_note', arguments: { title: 'No', content: 'No' } },
      }),
    });
    expect(write.status).toBe(403);
    expect(write.headers.get('www-authenticate')).toContain('insufficient_scope');

    const refresh = await request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: refreshToken,
        resource: resolveMcpOAuthResource(),
      }),
    });
    expect(refresh.status).toBe(200);
    const refreshed = (await refresh.json()) as { access_token: string; refresh_token: string };
    const previousRefreshToken = refreshToken;
    expect(refreshed.access_token.length).toBeGreaterThan(100);
    expect(refreshed.refresh_token).not.toBe(refreshToken);
    accessToken = refreshed.access_token;
    refreshToken = refreshed.refresh_token;

    const refreshedMcp = await request('/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 13, method: 'tools/list' }),
    });
    expect(refreshedMcp.status).toBe(200);

    const revokeAccess = await request('/api/auth/oauth2/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        token: accessToken,
        // RFC 7009 defines this value as a hint, not as authoritative token
        // typing. A mismatched hint must not leave a valid JWT active.
        token_type_hint: 'refresh_token',
      }),
    });
    expect(revokeAccess.status).toBe(200);
    const revokedMcp = await request('/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 14, method: 'tools/list' }),
    });
    expect(revokedMcp.status).toBe(401);

    const secondRefresh = await request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: refreshToken,
        resource: resolveMcpOAuthResource(),
      }),
    });
    expect(secondRefresh.status).toBe(200);
    const secondRefreshed = (await secondRefresh.json()) as {
      access_token: string;
      refresh_token: string;
    };
    accessToken = secondRefreshed.access_token;
    refreshToken = secondRefreshed.refresh_token;

    const revokeWithUnknownHint = await request('/api/auth/oauth2/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        token: accessToken,
        token_type_hint: 'urn:voxen:unknown-token-type',
      }),
    });
    expect(revokeWithUnknownHint.status).toBe(200);

    const thirdRefresh = await request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: refreshToken,
        resource: resolveMcpOAuthResource(),
      }),
    });
    expect(thirdRefresh.status).toBe(200);
    const thirdRefreshed = (await thirdRefresh.json()) as {
      access_token: string;
      refresh_token: string;
    };
    accessToken = thirdRefreshed.access_token;
    refreshToken = thirdRefreshed.refresh_token;

    const revokeRefresh = await request('/api/auth/oauth2/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        token: refreshToken,
        token_type_hint: 'access_token',
      }),
    });
    expect(revokeRefresh.status).toBe(200);

    const revokedRefreshReplay = await request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: refreshToken,
        resource: resolveMcpOAuthResource(),
      }),
    });
    expect(revokedRefreshReplay.status).toBeGreaterThanOrEqual(400);

    const refreshReplay = await request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: previousRefreshToken,
        resource: resolveMcpOAuthResource(),
      }),
    });
    expect(refreshReplay.status).toBeGreaterThanOrEqual(400);

    const replay = await request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        resource: resolveMcpOAuthResource(),
      }),
    });
    expect(replay.status).toBeGreaterThanOrEqual(400);
  });

  it('revokes a user grant immediately without exposing tokens in audit metadata', async () => {
    const grants = await request('/api/mcp/oauth', { headers: { cookie } });
    expect(grants.status).toBe(200);
    const body = (await grants.json()) as { grants: { id: string }[] };
    expect(body.grants.length).toBe(1);
    const revoke = await request(`/api/mcp/oauth/grants/${body.grants[0]!.id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(revoke.status).toBe(200);

    const mcp = await request('/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }),
    });
    expect(mcp.status).toBe(401);
    expect(mcp.headers.get('www-authenticate')).toContain('resource_metadata=');

    const audit = await db.mcpOauthAuditEvent.findMany({ where: { targetUserId: userId } });
    expect(JSON.stringify(audit)).not.toContain(accessToken);
    expect(JSON.stringify(audit)).not.toContain(refreshToken);
  });

  it('lets an administrator control OAuth globally and disable clients', async () => {
    await db.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
    const disableOAuth = await request(
      '/api/admin/mcp',
      json('PATCH', { oauthEnabled: false }, cookie),
    );
    expect(disableOAuth.status).toBe(200);
    expect(((await disableOAuth.json()) as { oauthEnabled: boolean }).oauthEnabled).toBe(false);

    const enableOAuth = await request(
      '/api/admin/mcp',
      json('PATCH', { oauthEnabled: true }, cookie),
    );
    expect(enableOAuth.status).toBe(200);
    const confidential = await request(
      '/api/admin/mcp/oauth/clients',
      json(
        'POST',
        {
          name: 'Confidential MCP integration test',
          redirectUris: ['https://client.example/callback'],
          confidential: true,
          scopes: ['mcp:read'],
        },
        cookie,
      ),
    );
    expect(confidential.status).toBe(201);
    const confidentialBody = (await confidential.json()) as {
      clientId: string;
      clientSecret: string;
    };
    confidentialClientId = confidentialBody.clientId;
    confidentialClientSecret = confidentialBody.clientSecret;
    expect(confidentialBody.clientSecret.length).toBeGreaterThan(10);
    const stored = await db.oauthClient.findUniqueOrThrow({
      where: { clientId: confidentialClientId },
      select: { clientSecret: true },
    });
    expect(stored.clientSecret).not.toBe(confidentialBody.clientSecret);

    const disableClient = await request(
      `/api/admin/mcp/oauth/clients/${encodeURIComponent(clientId)}`,
      json('PATCH', { disabled: true }, cookie),
    );
    expect(disableClient.status).toBe(200);
    expect(((await disableClient.json()) as { disabled: boolean }).disabled).toBe(true);
    const events = new Set(
      (
        await db.mcpOauthAuditEvent.findMany({
          where: {
            event: {
              in: [
                'client_registration',
                'authorization',
                'consent',
                'token_issuance',
                'token_refresh',
                'token_revocation',
                'grant_revocation',
                'client_policy',
                'oauth_policy',
                'resource_rejection',
              ],
            },
          },
          select: { event: true },
        })
      ).map((event) => event.event),
    );
    for (const event of [
      'client_registration',
      'authorization',
      'consent',
      'token_issuance',
      'token_refresh',
      'token_revocation',
      'grant_revocation',
      'client_policy',
      'oauth_policy',
      'resource_rejection',
    ]) {
      expect(events.has(event)).toBe(true);
    }
    await db.user.update({ where: { id: userId }, data: { role: 'USER' } });
  });

  it('makes introspection reflect live access-token policy and revocation', async () => {
    let credentials = await issueConfidentialTokens();
    let token = credentials.accessToken;
    expect((await introspectConfidentialToken(token)).active).toBe(true);
    expect((await introspectConfidentialToken(credentials.refreshToken)).active).toBe(true);

    await db.user.update({ where: { id: userId }, data: { status: 'DISABLED' } });
    expect((await introspectConfidentialToken(token)).active).toBe(false);
    await db.user.update({ where: { id: userId }, data: { status: 'APPROVED' } });
    expect((await introspectConfidentialToken(token)).active).toBe(true);

    const revoke = await request('/api/auth/oauth2/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: confidentialClientId,
        client_secret: confidentialClientSecret,
        token,
        token_type_hint: 'refresh_token',
      }),
    });
    expect(revoke.status).toBe(200);
    expect((await introspectConfidentialToken(token)).active).toBe(false);
    expect((await introspectConfidentialToken(credentials.refreshToken)).active).toBe(true);

    const revokeBlankHint = await request('/api/auth/oauth2/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: confidentialClientId,
        client_secret: confidentialClientSecret,
        token: credentials.refreshToken,
        token_type_hint: '',
      }),
    });
    expect(revokeBlankHint.status).toBe(200);
    const blankHintReplay = await request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: confidentialClientId,
        client_secret: confidentialClientSecret,
        refresh_token: credentials.refreshToken,
        resource: resolveMcpOAuthResource(),
      }),
    });
    expect(blankHintReplay.status).toBeGreaterThanOrEqual(400);

    credentials = await issueConfidentialTokens();
    token = credentials.accessToken;
    expect((await introspectConfidentialToken(token)).active).toBe(true);
    const grants = await request('/api/mcp/oauth', { headers: { cookie } });
    const grant = (
      (await grants.json()) as { grants: { id: string; clientId: string }[] }
    ).grants.find((item) => item.clientId === confidentialClientId);
    expect(grant).toBeDefined();
    const revokeGrant = await request(`/api/mcp/oauth/grants/${grant!.id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(revokeGrant.status).toBe(200);
    expect((await introspectConfidentialToken(token)).active).toBe(false);

    const audit = await db.mcpOauthAuditEvent.findFirst({
      where: { event: 'token_introspection', clientId: confidentialClientId },
      orderBy: { createdAt: 'desc' },
      select: { outcome: true },
    });
    expect(audit?.outcome).toBe('denied');
  });

  it('fails closed when OAuth is disabled', async () => {
    await setSettings({ mcp_oauth_enabled: 'false' });
    const response = await request(
      '/api/auth/oauth2/register',
      json('POST', {
        client_name: 'Disabled client',
        redirect_uris: ['http://127.0.0.1/callback'],
      }),
    );
    expect(response.status).toBe(503);
    await setSettings({ mcp_oauth_enabled: 'true' });
  });

  it('rate-limits unauthenticated dynamic registration by source', async () => {
    await getRedisPublisher().del(
      'voxen:rl:mcp-oauth:register:peer:unknown',
      'voxen:rl:mcp-oauth:register:global',
    );
    let response: Response | null = null;
    for (let attempt = 0; attempt < 21; attempt += 1) {
      response = await request('/api/auth/oauth2/register', {
        ...json('POST', {
          client_name: 'Rejected registration',
          redirect_uris: ['https://*.example.com/callback'],
        }),
        headers: {
          'content-type': 'application/json',
          'cf-connecting-ip': `spoofed-${attempt}`,
        },
      });
    }
    expect(response?.status).toBe(429);
    expect(response?.headers.get('retry-after')).toMatch(/^\d+$/u);
  });
});
