import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ClientRequest, IncomingMessage } from 'node:http';
import app from '../src/index';
import { auth, resolveMcpOAuthResource } from '../src/lib/auth';
import { db } from '../src/lib/db';
import { metadataNetwork } from '../src/lib/mcp-metadata-transport';
import { setSettings } from '../src/lib/settings';

const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});
describe.skipIf(!process.env.DATABASE_URL)('metadata document OAuth clients', () => {
  let userId = '',
    clientId = '';
  afterAll(async () => {
    await setSettings({ mcp_oauth_enabled: 'false' });
    if (clientId) await db.oauthClient.deleteMany({ where: { clientId } });
    if (userId) await db.user.deleteMany({ where: { id: userId } });
  });
  test('discovers an HTTPS client, binds the MCP resource, and verifies dynamic loopback PKCE and live policy', async () => {
    await setSettings({ mcp_oauth_enabled: 'true' });
    const password = 'Public-QA-Password-2026',
      email = `cimd-${crypto.randomUUID()}@example.test`;
    userId = (await auth.api.signUpEmail({ body: { email, password, name: 'Metadata OAuth QA' } }))
      .user.id;
    await db.user.update({ where: { id: userId }, data: { status: 'APPROVED' } });
    const signin = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    const cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0]!;
    clientId = `https://mcp-client.example.com/${crypto.randomUUID()}/client.json`;
    const metadata = {
      client_id: clientId,
      client_name: 'Metadata client QA',
      redirect_uris: ['http://127.0.0.1:3000/auth/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    };
    const lookup = spyOn(metadataNetwork, 'lookup').mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
    ]);
    restores.push(() => lookup.mockRestore());
    const network = spyOn(metadataNetwork, 'request').mockImplementation(
      (_url, _options, callback) => {
        const connection = new EventEmitter() as ClientRequest;
        connection.destroy = () => connection;
        connection.end = (() => {
          queueMicrotask(() => {
            const stream = new PassThrough(),
              response = stream as unknown as IncomingMessage;
            response.statusCode = 200;
            response.headers = {
              'content-type': 'application/json',
              'cache-control': 'max-age=60',
            };
            callback(response);
            stream.end(JSON.stringify(metadata));
          });
          return connection;
        }) as ClientRequest['end'];
        return connection;
      },
    );
    restores.push(() => network.mockRestore());
    const fetch = (path: string, init?: RequestInit) =>
      app.fetch(new Request('http://localhost' + path, init));
    const discovery = await fetch('/.well-known/oauth-authorization-server/api/auth');
    const advertised = await discovery.json();
    expect(advertised.client_id_metadata_document_supported).toBe(true);
    expect(advertised.authorization_response_iss_parameter_supported).toBe(true);
    const verifier = randomBytes(48).toString('base64url'),
      redirect = 'http://127.0.0.1:49152/auth/callback';
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      response_type: 'code',
      scope: 'mcp:read offline_access',
      resource: resolveMcpOAuthResource(),
      prompt: 'consent',
      state: 'opaque-cimd-state',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    const authorize = await fetch('/api/auth/oauth2/authorize?' + query, {
      headers: { cookie },
      redirect: 'manual',
    });
    const location = authorize.headers.get('location') ?? '';
    expect(location).toContain('/oauth/consent');
    expect(network).toHaveBeenCalledTimes(1);
    const stored = await db.oauthClient.findUniqueOrThrow({ where: { clientId } });
    expect(stored.clientDiscoveryId).toBeTruthy();
    expect(stored.clientSecret).toBeNull();
    expect(stored.skipConsent).not.toBe(true);
    expect(
      await db.oauthClientResource.findUnique({
        where: { clientId_resourceId: { clientId, resourceId: resolveMcpOAuthResource() } },
      }),
    ).not.toBeNull();
    const contextQuery = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      scope: 'mcp:read offline_access',
    });
    const context = await fetch('/api/mcp/oauth/consent-context?' + contextQuery, {
      headers: { cookie },
    });
    expect(context.status).toBe(200);
    for (const wrong of ['http://localhost:49152/auth/callback', 'http://127.0.0.1:49152/other']) {
      contextQuery.set('redirect_uri', wrong);
      expect(
        (await fetch('/api/mcp/oauth/consent-context?' + contextQuery, { headers: { cookie } }))
          .status,
      ).toBe(400);
    }
    const consent = await fetch('/api/auth/oauth2/consent', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        accept: true,
        oauth_query: new URL(location, 'http://localhost:3000').search.slice(1),
      }),
    });
    expect(consent.status).toBe(200);
    const body = await consent.json(),
      callback = new URL(body.url ?? body.redirect_uri);
    expect(callback.origin).toBe('http://127.0.0.1:49152');
    expect(callback.searchParams.get('state')).toBe('opaque-cimd-state');
    expect(callback.searchParams.get('iss')).toBe('http://localhost:3000/api/auth');
    const token = await fetch('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code: callback.searchParams.get('code')!,
        redirect_uri: redirect,
        code_verifier: verifier,
        resource: resolveMcpOAuthResource(),
      }),
    });
    expect(token.status).toBe(200);
    const credentials = await token.json();
    expect(typeof credentials.refresh_token).toBe('string');
    const mcp = () =>
      fetch('/mcp', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + credentials.access_token,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-11-25',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
    expect((await mcp()).status).toBe(200);
    await db.oauthClientResource.deleteMany({ where: { clientId } });
    expect((await mcp()).status).toBe(401);
    await db.oauthClientResource.create({
      data: { clientId, resourceId: resolveMcpOAuthResource() },
    });
    expect((await mcp()).status).toBe(200);
    await db.session.deleteMany({ where: { userId } });
    expect((await mcp()).status).toBe(401);
  }, 10000);
});
