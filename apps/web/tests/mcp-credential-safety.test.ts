import { expect, test } from 'bun:test';
import { toMcpTokenMetadata } from '../src/lib/mcp-tokens';

test('public MCP token metadata uses explicit fields rather than spreading internal records', () => {
  const record = {
    id: 'token-id',
    userId: 'owner-id',
    label: 'Client',
    scopes: 'READ,WRITE',
    createdAt: new Date('2026-01-01'),
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    tokenHash: 'INTERNAL_HASH_CANARY',
    token: 'BEARER_CANARY',
    user: { password: 'PRIVATE_CANARY' },
  };
  const result = toMcpTokenMetadata(record);
  expect(Object.keys(result).sort()).toEqual(
    ['id', 'userId', 'label', 'scopes', 'createdAt', 'expiresAt', 'lastUsedAt', 'revokedAt'].sort(),
  );
  expect(JSON.stringify(result)).not.toContain('CANARY');
  expect(result.scopes).toEqual(['READ', 'WRITE']);
});
