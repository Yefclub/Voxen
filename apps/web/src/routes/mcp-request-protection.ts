import { createHash } from 'node:crypto';
import type { Context } from 'hono';
import { connectionPeerIp } from '../lib/client-ip';
import { rateLimitRequired } from '../lib/rate-limit';

/** Local CPU protection for the single web process; authorization is never cached. */
export class McpConcurrencyLimiter {
  private total = 0;
  private owners = new Map<string, number>();
  constructor(
    private readonly globalLimit = 16,
    private readonly ownerLimit = 4,
  ) {}
  acquire(userId: string): (() => void) | null {
    const current = this.owners.get(userId) ?? 0;
    if (this.total >= this.globalLimit || current >= this.ownerLimit) return null;
    this.total++;
    this.owners.set(userId, current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.total--;
      const remaining = (this.owners.get(userId) ?? 1) - 1;
      if (remaining > 0) this.owners.set(userId, remaining);
      else this.owners.delete(userId);
    };
  }
}
export const mcpToolConcurrency = new McpConcurrencyLimiter();
export const mcpProtectionStore = { consume: rateLimitRequired };

export async function checkMcpRequestRate(c: Context, userId?: string): Promise<Response | null> {
  try {
    const checks = userId
      ? [mcpProtectionStore.consume('voxen:rl:mcp:owner:' + userId, 600, 60)]
      : [
          mcpProtectionStore.consume('voxen:rl:mcp:global', 6000, 60),
          mcpProtectionStore.consume(
            'voxen:rl:mcp:peer:' + createHash('sha256').update(connectionPeerIp(c)).digest('hex'),
            1200,
            60,
          ),
        ];
    const results = await Promise.all(checks);
    const denied = results.filter((r) => !r.allowed);
    if (denied.length) {
      c.header('Retry-After', String(Math.max(...denied.map((r) => r.resetIn))));
      return c.json(
        {
          code: 'MCP_RATE_LIMITED',
          error: 'MCP request frequency exceeded. Retry after the indicated delay.',
        },
        429,
      );
    }
    return null;
  } catch {
    c.header('Retry-After', '5');
    return c.json(
      {
        code: 'MCP_PROTECTION_UNAVAILABLE',
        error: 'MCP request protection is temporarily unavailable.',
      },
      503,
    );
  }
}
