import { createHash, randomBytes } from 'node:crypto';
import { db } from './db';

export const DEFAULT_MCP_TOKEN_LIFETIME_DAYS = 90;

export function parseMcpExpiry(value: unknown): Date | null | undefined {
  if (value === undefined)
    return new Date(Date.now() + DEFAULT_MCP_TOKEN_LIFETIME_DAYS * 86400_000);
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date <= new Date() ? undefined : date;
}

export const MCP_SCOPES = ['READ', 'WRITE'] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export type McpTokenMetadata = {
  id: string;
  userId: string;
  label: string;
  scopes: McpScope[];
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export function hashMcpToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function parseMcpScopes(value: unknown): McpScope[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const scopes = [...new Set(value)];
  if (
    !scopes.every((scope) => typeof scope === 'string' && MCP_SCOPES.includes(scope as McpScope))
  ) {
    return null;
  }
  return scopes as McpScope[];
}

export function serializeMcpScopes(scopes: readonly McpScope[]): string {
  return MCP_SCOPES.filter((scope) => scopes.includes(scope)).join(',');
}

export function deserializeMcpScopes(scopes: string): McpScope[] {
  return scopes
    .split(',')
    .filter((scope): scope is McpScope => MCP_SCOPES.includes(scope as McpScope));
}

export function toMcpTokenMetadata(token: {
  id: string;
  userId: string;
  label: string;
  scopes: string;
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}): McpTokenMetadata {
  return {
    id: token.id,
    userId: token.userId,
    label: token.label,
    scopes: deserializeMcpScopes(token.scopes),
    createdAt: token.createdAt,
    expiresAt: token.expiresAt,
    lastUsedAt: token.lastUsedAt,
    revokedAt: token.revokedAt,
  };
}

export async function createMcpToken(input: {
  userId: string;
  label: string;
  scopes: McpScope[];
  expiresAt: Date | null;
}): Promise<{ token: string; metadata: McpTokenMetadata }> {
  const token = `vxn_mcp_${randomBytes(32).toString('base64url')}`;
  const row = await db.mcpToken.create({
    data: {
      userId: input.userId,
      tokenHash: hashMcpToken(token),
      label: input.label,
      scopes: serializeMcpScopes(input.scopes),
      expiresAt: input.expiresAt,
    },
  });
  return { token, metadata: toMcpTokenMetadata(row) };
}
