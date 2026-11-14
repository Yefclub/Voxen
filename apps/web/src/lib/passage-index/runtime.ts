import { db } from '../db';
import { structuredDiagnostic } from '../structured-log';
import { backfillPassageSources, executePassageIndex } from './runner';
import type { PassageIdentity } from './source';

let draining = false;
export async function drainPassageIndexes(
  execute = executePassageIndex,
  userId?: string,
): Promise<number> {
  if (draining) return 0;
  draining = true;
  let completed = 0;
  try {
    await backfillPassageSources(userId);
    const now = new Date();
    const rows = await db.passageIndexSource.findMany({
      where: {
        ...(userId ? { userId } : {}),
        user: { status: 'APPROVED' },
        OR: [
          {
            status: { in: ['PENDING', 'RETRY'] },
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          { status: 'RUNNING', leaseExpiresAt: { lte: now } },
        ],
      },
      orderBy: [
        { updatedAt: 'asc' },
        { userId: 'asc' },
        { sourceType: 'asc' },
        { sourceId: 'asc' },
      ],
      take: 16,
    });
    for (let start = 0; start < rows.length; start += 4) {
      const outcomes = await Promise.allSettled(
        rows.slice(start, start + 4).map((row) =>
          execute({
            userId: row.userId,
            type: row.sourceType as PassageIdentity['type'],
            id: row.sourceId,
          }),
        ),
      );
      let failed: PromiseRejectedResult | undefined;
      for (const result of outcomes) {
        if (result.status === 'rejected') failed ??= result;
        else if (result.value) completed++;
      }
      if (failed) throw failed.reason;
    }
    return completed;
  } finally {
    draining = false;
  }
}

export function startPassageIndexRuntime(): void {
  const tick = () => {
    void drainPassageIndexes().catch((error) => {
      structuredDiagnostic('warning', 'passage-index-drain-failed', 'PASSAGE_INDEX_FAILED', error);
    });
  };
  tick();
  setInterval(tick, 5000).unref();
}
