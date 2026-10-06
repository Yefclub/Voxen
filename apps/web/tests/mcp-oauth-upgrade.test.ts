import { describe, expect, test } from 'bun:test';
import { db } from '../src/lib/db';
import { ensureMcpOauthResourceUpgrade } from '../src/lib/mcp-oauth-upgrade';

describe.skipIf(!process.env.DATABASE_URL)('additive OAuth resource backfill', () => {
  test('preserves legacy identities, token/secret/key bytes and timestamps and binds only unbound MCP grants', async () => {
    const secondResource = `https://second-${crypto.randomUUID()}.example.test/mcp`;
    const resource = `https://legacy-${crypto.randomUUID()}.example.test/mcp`;
    const user = await db.user.create({
      data: {
        name: 'Legacy schema QA',
        email: `legacy-schema-${crypto.randomUUID()}@example.test`,
        status: 'APPROVED',
      },
    });
    const clientId = crypto.randomUUID();
    let keyId = '';
    try {
      const account = await db.account.create({
        data: {
          userId: user.id,
          accountId: user.id,
          providerId: 'credential',
          password: 'original-password-hash',
        },
      });
      const client = await db.oauthClient.create({
        data: {
          clientId,
          userId: user.id,
          type: 'native',
          public: false,
          clientSecret: 'original-client-secret-hash',
          tokenEndpointAuthMethod: 'client_secret_post',
          scopes: ['mcp:read', 'offline_access'],
          redirectUris: ['http://127.0.0.1:4000/callback'],
        },
      });
      const consent = await db.oauthConsent.create({
        data: { clientId, userId: user.id, scopes: ['mcp:read', 'offline_access'] },
      });
      const refresh = await db.oauthRefreshToken.create({
        data: {
          clientId,
          userId: user.id,
          token: 'original-refresh-token-hash-' + crypto.randomUUID(),
          scopes: ['mcp:read', 'offline_access'],
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      const access = await db.oauthAccessToken.create({
        data: {
          clientId,
          userId: user.id,
          token: 'original-access-token-hash-' + crypto.randomUUID(),
          scopes: ['mcp:read'],
          expiresAt: new Date(Date.now() + 300000),
        },
      });
      const foreign = await db.oauthRefreshToken.create({
        data: {
          clientId,
          userId: user.id,
          token: 'other-resource-hash-' + crypto.randomUUID(),
          scopes: ['mcp:read'],
          resources: ['https://other.example/mcp'],
        },
      });
      const key = await db.jwks.create({
        data: {
          publicKey: '{"kty":"OKP","crv":"Ed25519","x":"legacy-key-fixture"}',
          privateKey: 'original-encrypted-private-key',
        },
      });
      keyId = key.id;
      await ensureMcpOauthResourceUpgrade(resource);
      await ensureMcpOauthResourceUpgrade(resource);
      expect(await db.account.findUnique({ where: { id: account.id } })).toEqual(account);
      const current = await db.oauthClient.findUniqueOrThrow({ where: { clientId } });
      expect(current.clientSecret).toBe(client.clientSecret);
      expect(current.applicationType).toBe('native');
      expect(current.disabled).toBe(client.disabled);
      const renewed = await db.oauthRefreshToken.findUniqueOrThrow({ where: { id: refresh.id } });
      expect(renewed.token).toBe(refresh.token);
      expect(renewed.createdAt).toEqual(refresh.createdAt);
      expect(renewed.expiresAt).toEqual(refresh.expiresAt);
      expect(renewed.resources).toEqual([resource]);
      expect(
        (await db.oauthAccessToken.findUniqueOrThrow({ where: { id: access.id } })).token,
      ).toBe(access.token);
      const accepted = await db.oauthConsent.findUniqueOrThrow({ where: { id: consent.id } });
      expect(accepted.scopes).toEqual(consent.scopes);
      expect(accepted.updatedAt).toEqual(consent.updatedAt);
      expect(accepted.resources).toEqual([resource]);
      expect(
        (await db.oauthRefreshToken.findUniqueOrThrow({ where: { id: foreign.id } })).resources,
      ).toEqual(foreign.resources);
      expect(await db.jwks.findUnique({ where: { id: key.id } })).toEqual(key);
      expect(
        await db.oauthClientResource.count({ where: { clientId, resourceId: resource } }),
      ).toBe(1);
      await ensureMcpOauthResourceUpgrade(secondResource);
      expect(await db.oauthClientResource.count({ where: { clientId } })).toBe(2);
      expect(
        (await db.oauthConsent.findUniqueOrThrow({ where: { id: consent.id } })).resources,
      ).toEqual([resource]);
    } finally {
      await db.oauthClient.deleteMany({ where: { clientId } });
      await db.user.deleteMany({ where: { id: user.id } });
      if (keyId) await db.jwks.deleteMany({ where: { id: keyId } });
      await db.oauthResource.deleteMany({
        where: { identifier: { in: [resource, secondResource] } },
      });
      await db.verification.deleteMany({
        where: {
          identifier: 'voxen:mcp-oauth-resource-upgrade',
          value: { in: [resource, secondResource] },
        },
      });
    }
  });
});
