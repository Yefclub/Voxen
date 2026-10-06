import type { Prisma } from '../../prisma-generated/client';
import { db } from './db';
import { structuredDiagnostic, structuredLog } from './structured-log';
type PruneClient = Pick<Prisma.TransactionClient, '$queryRaw'>;
const MAX_BATCH = 1000;
const RETENTION_DAYS = 30;
const KEEP_LATEST = 20_000;

export async function pruneMcpOAuthAuditBatch(
  options: { now?: Date; keepLatest?: number; batchSize?: number } = {},
  client: PruneClient = db,
): Promise<number> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86400_000);
  const keepLatest = Math.max(
    1,
    Math.min(KEEP_LATEST, Math.trunc(options.keepLatest ?? KEEP_LATEST)),
  );
  const batch = Math.max(1, Math.min(MAX_BATCH, Math.trunc(options.batchSize ?? MAX_BATCH)));
  const rows = await client.$queryRaw<Array<{ id: string }>>`
  WITH expired AS (
    SELECT id FROM "McpOauthAuditEvent" WHERE "createdAt" < ${cutoff}
    ORDER BY "createdAt",id LIMIT ${batch}
  ), overflow AS (
    SELECT id FROM "McpOauthAuditEvent" ORDER BY "createdAt" DESC,id DESC
    OFFSET ${keepLatest} LIMIT ${batch}
  ), candidates AS (
    SELECT id,0 AS priority FROM expired UNION ALL SELECT id,1 AS priority FROM overflow
  ), targets AS (
    SELECT id FROM candidates GROUP BY id ORDER BY MIN(priority),id LIMIT ${batch}
  )
  DELETE FROM "McpOauthAuditEvent" WHERE id IN (SELECT id FROM targets) RETURNING id
 `;
  return rows.length;
}

let running = false;
export async function maintainMcpOAuthAudit(): Promise<void> {
  if (running) return;
  running = true;
  let total = 0;
  try {
    for (let i = 0; i < 10; i++) {
      const removed = await db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL statement_timeout = '3s'`;
          return pruneMcpOAuthAuditBatch({}, tx);
        },
        { maxWait: 2000, timeout: 5000 },
      );
      total += removed;
      if (removed < MAX_BATCH) break;
    }
    if (total)
      structuredLog('info', 'mcp-audit-pruned', {
        deleted_count: total,
        retention_days: RETENTION_DAYS,
        keep_latest: KEEP_LATEST,
      });
  } catch (error) {
    structuredDiagnostic(
      'warning',
      'mcp-audit-maintenance-failed',
      'MCP_AUDIT_MAINTENANCE_FAILED',
      error,
    );
  } finally {
    running = false;
  }
}
