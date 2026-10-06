import { createHmac, timingSafeEqual } from 'node:crypto';
import { getMasterKey } from '../lib/master-key';

type PagePosition = { createdAt: Date; id: string };
type PageContext = { userId: string; tool: 'notes' | 'transcripts'; transcriptId?: string };
function mac(value: string, context: PageContext): Buffer {
  return createHmac('sha256', getMasterKey())
    .update('voxen-mcp-page-v1\0')
    .update(JSON.stringify(context))
    .update('\0')
    .update(value)
    .digest();
}
export function encodeMcpPageCursor(position: PagePosition, context: PageContext): string {
  const value = Buffer.from(
    JSON.stringify({ v: 1, date: position.createdAt.toISOString(), id: position.id }),
  ).toString('base64url');
  return value + '.' + mac(value, context).toString('base64url');
}
export function decodeMcpPageCursor(
  cursor: string | undefined,
  context: PageContext,
): { valid: true; position: PagePosition | null } | { valid: false } {
  if (cursor === undefined) return { valid: true, position: null };
  if (cursor.length > 2048 || !/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]{43}$/.test(cursor))
    return { valid: false };
  const [value, signature] = cursor.split('.') as [string, string];
  const signed = Buffer.from(signature, 'base64url');
  if (signed.length !== 32 || !timingSafeEqual(signed, mac(value, context)))
    return { valid: false };
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) return { valid: false };
    const data = JSON.parse(decoded.toString('utf8')) as {
      v?: unknown;
      date?: unknown;
      id?: unknown;
    };
    if (
      data.v !== 1 ||
      typeof data.date !== 'string' ||
      typeof data.id !== 'string' ||
      !data.id ||
      data.id.length > 256
    )
      return { valid: false };
    const createdAt = new Date(data.date);
    if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== data.date)
      return { valid: false };
    return { valid: true, position: { createdAt, id: data.id } };
  } catch {
    return { valid: false };
  }
}
export function mcpPageBoundary(position: PagePosition | null) {
  return position
    ? {
        OR: [
          { createdAt: { lt: position.createdAt } },
          { createdAt: position.createdAt, id: { lt: position.id } },
        ],
      }
    : {};
}
