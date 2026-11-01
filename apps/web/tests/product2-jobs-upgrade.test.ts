import { afterAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../src/lib/db';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

// Upgrade test (spec 215, issue #894): outstanding Product 2 jobs must be
// terminally closed by the forward migration — never left QUEUED/RUNNING with
// no executor. Retained DELETE_KNOWLEDGE work and finished jobs are untouched.
describeIfDb('product 2 jobs upgrade', () => {
  it('cancels pending product 2 jobs and keeps retained work', async () => {
    const user = await db.user.create({
      data: { email: `p2jobs-${Date.now()}@voxen.local`, name: 'P2 Jobs', status: 'APPROVED' },
    });
    try {
      const queued = await db.job.create({
        data: {
          userId: user.id,
          type: 'SCRAPE_WEB',
          status: 'QUEUED',
          sourceUrl: 'https://example.com/a',
        },
      });
      const running = await db.job.create({
        data: {
          userId: user.id,
          type: 'DOWNLOAD_MEDIA',
          status: 'RUNNING',
          sourceUrl: 'https://example.com/b',
          workerId: 'dead-worker',
          attempt: 1,
          heartbeatAt: new Date(0),
          leaseExpiresAt: new Date(0),
        },
      });
      const retained = await db.job.create({
        data: {
          userId: user.id,
          type: 'DELETE_KNOWLEDGE',
          status: 'QUEUED',
          sourceUrl: 'voxen://delete/transcript/t1',
          deletionTargetType: 'TRANSCRIPT',
          deletionTargetId: 't1',
          deletionTargetTitle: 'T1',
        },
      });
      const done = await db.job.create({
        data: {
          userId: user.id,
          type: 'SCRAPE_WEB',
          status: 'DONE',
          sourceUrl: 'https://example.com/c',
        },
      });

      const sql = readFileSync(
        join(
          import.meta.dir,
          '../../../prisma/migrations/20261101133549_cancel_outstanding_product2_jobs/migration.sql',
        ),
        'utf8',
      );
      expect(sql).toContain('DELETE_KNOWLEDGE');
      await db.$executeRawUnsafe(sql);

      const [q, r] = await Promise.all([
        db.job.findUniqueOrThrow({ where: { id: queued.id } }),
        db.job.findUniqueOrThrow({ where: { id: running.id } }),
      ]);
      expect(q.status).toBe('CANCELLED');
      expect(r.status).toBe('CANCELLED');
      expect(q.workerId).toBeNull();
      expect(q.leaseExpiresAt).toBeNull();
      expect(q.finishedAt).not.toBeNull();
      expect(q.errorMsg ?? '').toContain('Produto 2');

      // Re-running is a no-op (idempotent migration).
      await db.$executeRawUnsafe(sql);
      const again = await db.job.findUniqueOrThrow({ where: { id: queued.id } });
      expect(again.status).toBe('CANCELLED');

      expect((await db.job.findUniqueOrThrow({ where: { id: retained.id } })).status).toBe(
        'QUEUED',
      );
      expect((await db.job.findUniqueOrThrow({ where: { id: done.id } })).status).toBe('DONE');
    } finally {
      await db.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });

  afterAll(async () => {
    await db.$disconnect();
  });
});
