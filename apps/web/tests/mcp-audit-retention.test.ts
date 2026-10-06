import { expect, test } from 'bun:test';
import { db } from '../src/lib/db';
import { pruneMcpOAuthAuditBatch } from '../src/lib/mcp-audit-retention';

test.skipIf(!process.env.DATABASE_URL)(
  'audit retention preserves newest records and removes expired/excess rows within bounded work',
  async () => {
    const prefix = 'audit-retention-' + crypto.randomUUID();
    await expect(
      db.$transaction(
        async (tx) => {
          await tx.mcpOauthAuditEvent.deleteMany();
          await tx.mcpOauthAuditEvent.createMany({
            data: [
              ...Array.from({ length: 4 }, (_, i) => ({
                id: prefix + 'old' + i,
                event: 'retention-test',
                outcome: 'success',
                createdAt: new Date('2025-01-01'),
              })),
              ...Array.from({ length: 5 }, (_, i) => ({
                id: prefix + 'fresh' + i,
                event: 'retention-test',
                outcome: 'success',
                createdAt: new Date(new Date('2126-01-01').getTime() + i * 1000),
              })),
            ],
          });
          const counts: number[] = [];
          for (let i = 0; i < 10; i++) {
            const count = await pruneMcpOAuthAuditBatch(
              { now: new Date('2026-10-06'), keepLatest: 3, batchSize: 2 },
              tx,
            );
            expect(count).toBeLessThanOrEqual(2);
            counts.push(count);
            if (!count) break;
          }
          expect(counts.reduce((a, b) => a + b, 0)).toBe(6);
          expect(
            (
              await tx.mcpOauthAuditEvent.findMany({
                orderBy: { createdAt: 'asc' },
                select: { id: true },
              })
            ).map((row) => row.id),
          ).toEqual([prefix + 'fresh2', prefix + 'fresh3', prefix + 'fresh4']);
          throw new Error('ROLLBACK_AUDIT_RETENTION_FIXTURE');
        },
        { timeout: 10_000 },
      ),
    ).rejects.toThrow('ROLLBACK_AUDIT_RETENTION_FIXTURE');
  },
);
