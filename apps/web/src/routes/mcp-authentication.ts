import type { Context } from 'hono';
import { db } from '../lib/db';
import { deserializeMcpScopes, hashMcpToken, type McpScope } from '../lib/mcp-tokens';
import { authenticateMcpOAuthToken } from '../lib/mcp-oauth';

export type McpIdentity = {
  userId: string;
  scopes: McpScope[];
  credentialClass: 'personal' | 'oauth';
  clientId?: string;
};

// A narrow persistence boundary makes availability and telemetry failures testable.
export const mcpAuthenticationStore = {
  findToken(tokenHash: string) {
    return db.mcpToken.findUnique({
      where: { tokenHash: tokenHash },
      select: {
        id: true,
        userId: true,
        scopes: true,
        revokedAt: true,
        expiresAt: true,
        lastUsedAt: true,
        user: { select: { status: true } },
      },
    });
  },
  recordUse(id: string, now: Date, staleBefore: Date) {
    return db.mcpToken.updateMany({
      where: { id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: staleBefore } }] },
      data: { lastUsedAt: now },
    });
  },
};

export async function authenticateMcp(c: Context): Promise<McpIdentity | null> {
  const authorization = c.req.header('Authorization') ?? '';
  const match = /^Bearer\s+([^\s]+)\s*$/i.exec(authorization);
  const token = match?.[1] ?? '';
  if (!token) return null;
  const now = new Date();
  const row = await mcpAuthenticationStore.findToken(hashMcpToken(token));
  if (
    row &&
    !row.revokedAt &&
    (!row.expiresAt || row.expiresAt > now) &&
    row.user.status === 'APPROVED'
  ) {
    const scopes = deserializeMcpScopes(row.scopes);
    if (scopes.length > 0) {
      // Authorization is read fresh on every request; only telemetry is throttled.
      const staleBefore = new Date(now.getTime() - 5 * 60_000);
      if (!row.lastUsedAt || row.lastUsedAt <= staleBefore) {
        await mcpAuthenticationStore.recordUse(row.id, now, staleBefore).catch(() => undefined);
      }
      return { userId: row.userId, scopes, credentialClass: 'personal' };
    }
  }

  if (token.split('.').length !== 3) return null;
  const oauth = await authenticateMcpOAuthToken(token);
  return oauth
    ? {
        userId: oauth.userId,
        scopes: oauth.scopes,
        credentialClass: 'oauth',
        clientId: oauth.clientId,
      }
    : null;
}
