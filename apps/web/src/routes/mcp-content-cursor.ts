import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getMasterKey } from '../lib/master-key';
export type McpResultContext = {
  userId: string;
  tool: string;
  args: Record<string, unknown>;
  requestId: string;
  cursor?: string;
};
export type McpBudgetErrorCode =
  | 'MCP_INVALID_CONTENT_CURSOR'
  | 'MCP_CONTENT_CHANGED'
  | 'MCP_CONTENT_CURSOR_EXPIRED'
  | 'MCP_RESULT_TOO_LARGE';
export class McpResultBudgetError extends Error {
  constructor(readonly code: McpBudgetErrorCode) {
    super(code);
    this.name = 'McpResultBudgetError';
  }
}
export function resultDigest(serialized: string): string {
  return createHash('sha256').update(serialized).digest('hex');
}
function signature(value: string, context: McpResultContext): Buffer {
  return createHmac('sha256', getMasterKey())
    .update('voxen-mcp-content-v1\0')
    .update(JSON.stringify({ userId: context.userId, tool: context.tool, args: context.args }))
    .update('\0')
    .update(value)
    .digest();
}
export function contentCursor(
  offset: number,
  digest: string,
  context: McpResultContext,
  now: number,
): string {
  const value = Buffer.from(
    JSON.stringify({ v: 1, offset, digest, expiresAt: now + 5 * 60_000 }),
  ).toString('base64url');
  return value + '.' + signature(value, context).toString('base64url');
}
export function contentOffset(
  context: McpResultContext,
  digest: string,
  totalChars: number,
  now: number,
): number {
  const cursor = context.cursor;
  if (cursor === undefined) return 0;
  const invalid = () => {
    throw new McpResultBudgetError('MCP_INVALID_CONTENT_CURSOR');
  };
  if (cursor.length > 2048 || !/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]{43}$/.test(cursor)) return invalid();
  const [value, mac] = cursor.split('.') as [string, string];
  const signed = Buffer.from(mac, 'base64url');
  if (signed.length !== 32 || !timingSafeEqual(signed, signature(value, context))) return invalid();
  let data: { v?: unknown; offset?: unknown; digest?: unknown; expiresAt?: unknown };
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) return invalid();
    data = JSON.parse(decoded.toString('utf8'));
  } catch {
    return invalid();
  }
  if (
    data.v !== 1 ||
    !Number.isSafeInteger(data.offset) ||
    typeof data.offset !== 'number' ||
    data.offset < 1 ||
    typeof data.expiresAt !== 'number' ||
    !Number.isSafeInteger(data.expiresAt) ||
    typeof data.digest !== 'string'
  )
    return invalid();
  if (data.expiresAt <= now) throw new McpResultBudgetError('MCP_CONTENT_CURSOR_EXPIRED');
  if (data.digest !== digest) throw new McpResultBudgetError('MCP_CONTENT_CHANGED');
  if (data.offset >= totalChars) return invalid();
  return data.offset;
}
