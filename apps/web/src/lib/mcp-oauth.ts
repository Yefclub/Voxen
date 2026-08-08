import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from 'jose';
import { auth, resolveMcpOAuthResource } from './auth';
import { db } from './db';
import { getSetting } from './settings';
import type { McpScope } from './mcp-tokens';

export const MCP_OAUTH_SCOPES = ['mcp:read', 'mcp:write'] as const;
export const MCP_OAUTH_CREDENTIAL_CLAIM = 'https://voxen.dev/claims/credential_class';

export type McpOAuthAuditEventName =
  | 'client_registration'
  | 'authorization'
  | 'consent'
  | 'token_issuance'
  | 'token_refresh'
  | 'token_revocation'
  | 'token_introspection'
  | 'grant_revocation'
  | 'client_policy'
  | 'oauth_policy'
  | 'resource_rejection';

export type McpOAuthIdentity = {
  userId: string;
  clientId: string;
  scopes: McpScope[];
  oauthScopes: string[];
};

export function isValidMcpOAuthRedirect(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 2048 || value.includes('*')) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === 'https:') return true;
    return (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

export async function isMcpOAuthEnabled(): Promise<boolean> {
  return (await getSetting('mcp_oauth_enabled').catch(() => null)) === 'true';
}

export function mcpOAuthIssuer(): string {
  return `${new URL(resolveMcpOAuthResource()).origin}/api/auth`;
}

export function mcpProtectedResourceMetadataUrl(): string {
  return `${new URL(resolveMcpOAuthResource()).origin}/.well-known/oauth-protected-resource/mcp`;
}

export function mcpProtectedResourceMetadata(): Record<string, unknown> {
  return {
    resource: resolveMcpOAuthResource(),
    authorization_servers: [mcpOAuthIssuer()],
    scopes_supported: [...MCP_OAUTH_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Voxen MCP',
  };
}

export function mcpBearerChallenge(input?: {
  error?: 'invalid_token' | 'insufficient_scope';
  scope?: string;
}): string {
  const values = [`resource_metadata="${mcpProtectedResourceMetadataUrl()}"`];
  if (input?.error) values.unshift(`error="${input.error}"`);
  if (input?.scope) values.push(`scope="${input.scope}"`);
  return `Bearer ${values.join(', ')}`;
}

function parseOAuthScopes(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return [
    ...new Set(value.split(/\s+/).filter((scope) => MCP_OAUTH_SCOPES.includes(scope as never))),
  ];
}

type VerifiedMcpOAuthJwt = {
  payload: JWTPayload;
  userId: string;
  clientId: string;
  tokenId: string;
  expiresAt: Date;
};

async function verifyMcpOAuthJwt(token: string): Promise<VerifiedMcpOAuthJwt | null> {
  // Keep the JWKS lookup outside the validation catch. An infrastructure
  // failure must propagate to RFC 7009 so revocation can fail closed instead
  // of returning success while a valid token remains usable.
  const jwks = (await auth.api.getJwks()) as JSONWebKeySet;
  try {
    // The resource server runs beside the authorization server. Reading the
    // local JWKS avoids a self-request that could fail behind reverse proxies.
    const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
      audience: resolveMcpOAuthResource(),
      issuer: mcpOAuthIssuer(),
    });
    const userId = typeof payload.sub === 'string' ? payload.sub : null;
    const clientId = typeof payload.azp === 'string' ? payload.azp : null;
    const tokenId = typeof payload.jti === 'string' ? payload.jti : null;
    if (
      !userId ||
      !clientId ||
      !tokenId ||
      typeof payload.exp !== 'number' ||
      payload[MCP_OAUTH_CREDENTIAL_CLAIM] !== 'mcp_oauth'
    ) {
      return null;
    }
    return { payload, userId, clientId, tokenId, expiresAt: new Date(payload.exp * 1000) };
  } catch {
    return null;
  }
}

export async function authenticateMcpOAuthToken(token: string): Promise<McpOAuthIdentity | null> {
  if (!(await isMcpOAuthEnabled())) return null;
  try {
    const verified = await verifyMcpOAuthJwt(token);
    if (!verified) return null;
    const { payload, userId, clientId } = verified;
    const oauthScopes = parseOAuthScopes(payload.scope);
    if (oauthScopes.length === 0) return null;

    const [user, client, consent, revoked] = await Promise.all([
      db.user.findUnique({ where: { id: userId }, select: { status: true } }),
      db.oauthClient.findUnique({
        where: { clientId },
        select: { disabled: true },
      }),
      db.oauthConsent.findFirst({
        where: { clientId, userId },
        select: { scopes: true },
      }),
      db.mcpOauthRevokedAccessToken.findUnique({
        where: { tokenId: verified.tokenId },
        select: { id: true },
      }),
    ]);
    if (
      user?.status !== 'APPROVED' ||
      !client ||
      client.disabled === true ||
      !consent ||
      revoked ||
      oauthScopes.some((scope) => !consent.scopes.includes(scope))
    ) {
      return null;
    }

    const scopes: McpScope[] = [];
    if (oauthScopes.includes('mcp:read')) scopes.push('READ');
    if (oauthScopes.includes('mcp:write')) scopes.push('WRITE');
    return scopes.length > 0 ? { userId, clientId, scopes, oauthScopes } : null;
  } catch {
    return null;
  }
}

/**
 * Persists only the random signed `jti` of a currently valid JWT after RFC
 * 7009 has accepted the revocation request. The expected client check prevents
 * one client from invalidating another client's access token.
 */
export async function recordMcpOAuthAccessTokenRevocation(
  token: string,
  expectedClientId?: string,
): Promise<boolean> {
  const verified = await verifyMcpOAuthJwt(token);
  if (!verified || (expectedClientId && verified.clientId !== expectedClientId)) return false;
  const now = new Date();
  await db.$transaction([
    db.mcpOauthRevokedAccessToken.deleteMany({ where: { expiresAt: { lte: now } } }),
    db.mcpOauthRevokedAccessToken.upsert({
      where: { tokenId: verified.tokenId },
      create: {
        tokenId: verified.tokenId,
        clientId: verified.clientId,
        userId: verified.userId,
        expiresAt: verified.expiresAt,
      },
      update: {
        clientId: verified.clientId,
        userId: verified.userId,
        expiresAt: verified.expiresAt,
        revokedAt: now,
      },
    }),
  ]);
  return true;
}

type SafeAuditMetadata = {
  grantType?: 'authorization_code' | 'refresh_token';
  requestedScopes?: string[];
  redirectHost?: string;
  reason?: string;
  path?: string;
};

function sanitizeAuditMetadata(
  metadata: SafeAuditMetadata | undefined,
): SafeAuditMetadata | undefined {
  if (!metadata) return undefined;
  const result: SafeAuditMetadata = {};
  if (metadata.grantType === 'authorization_code' || metadata.grantType === 'refresh_token') {
    result.grantType = metadata.grantType;
  }
  if (metadata.requestedScopes) {
    result.requestedScopes = metadata.requestedScopes.filter((scope) =>
      [...MCP_OAUTH_SCOPES, 'offline_access'].includes(scope as never),
    );
  }
  if (metadata.redirectHost) result.redirectHost = metadata.redirectHost.slice(0, 255);
  if (metadata.reason) result.reason = metadata.reason.replace(/[^A-Z0-9_-]/gi, '').slice(0, 80);
  if (metadata.path) result.path = metadata.path.replace(/[^a-z0-9_/-]/gi, '').slice(0, 160);
  return Object.keys(result).length > 0 ? result : undefined;
}

export async function writeMcpOAuthAudit(input: {
  event: McpOAuthAuditEventName;
  outcome: 'success' | 'denied' | 'failed';
  actorUserId?: string | null;
  targetUserId?: string | null;
  clientId?: string | null;
  metadata?: SafeAuditMetadata;
}): Promise<void> {
  await db.mcpOauthAuditEvent
    .create({
      data: {
        event: input.event,
        outcome: input.outcome,
        actorUserId: input.actorUserId ?? null,
        targetUserId: input.targetUserId ?? null,
        clientId: input.clientId?.slice(0, 255) ?? null,
        metadata: sanitizeAuditMetadata(input.metadata),
      },
    })
    .catch(() => undefined);
}

export function isMcpOAuthAuthorityPath(path: string): boolean {
  return path.startsWith('/api/auth/oauth2/');
}
