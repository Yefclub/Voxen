import { createHash } from 'node:crypto';
import { db } from './db';

/** One-time, additive binding of pre-1.7 MCP grants; no user, secret, token or key is replaced. */
export async function ensureMcpOauthResourceUpgrade(resource: string): Promise<void> {
  const resourceHash = createHash('sha256').update(resource).digest('hex');
  const marker = 'voxen:mcp-oauth-resource:v1:' + resourceHash;
  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('voxen:mcp-oauth-resource-upgrade'))::text`;
      if (await tx.verification.findUnique({ where: { id: marker } })) return;
      await tx.oauthResource.upsert({
        where: { identifier: resource },
        create: {
          identifier: resource,
          name: 'Voxen MCP',
          allowedScopes: ['mcp:read', 'mcp:write', 'offline_access'],
          accessTokenTtl: 300,
          refreshTokenTtl: 2592000,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        update: {},
      });
      await tx.$executeRaw`UPDATE "OauthClient" SET "applicationType"=type WHERE "applicationType" IS NULL AND type IN ('web','native')`;
      for (const table of ['OauthConsent', 'OauthRefreshToken', 'OauthAccessToken'] as const) {
        // Identifiers come only from this closed internal list; values remain parameterized.
        const { Prisma } = await import('../../prisma-generated/client');
        await tx.$executeRaw(
          Prisma.sql`UPDATE ${Prisma.raw('"' + table + '"')} SET resources = ARRAY[${resource}]::text[] WHERE COALESCE(cardinality(resources),0) = 0 AND scopes && ARRAY['mcp:read','mcp:write']::text[]`,
        );
      }
      await tx.$executeRaw`INSERT INTO "OauthClientResource" (id,"clientId","resourceId","createdAt") SELECT ${'mcp-upgrade:' + resourceHash + ':'} || "clientId", "clientId", ${resource}, NOW() FROM "OauthClient" WHERE scopes && ARRAY['mcp:read','mcp:write']::text[] ON CONFLICT ("clientId","resourceId") DO NOTHING`;
      await tx.verification.create({
        data: {
          id: marker,
          identifier: 'voxen:mcp-oauth-resource-upgrade',
          value: resource,
          expiresAt: new Date('9999-12-31T00:00:00Z'),
        },
      });
    },
    { maxWait: 5000, timeout: 15000 },
  );
}
