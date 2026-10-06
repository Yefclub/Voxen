import { db } from './db';
import { enrichmentChecksum } from './enrichment-contract';
import { runWithBrainIndexLease } from './brain-index-lease';
import { reindexTranscriptEnrichmentBrain } from './brain-enrichments';
import { invalidateGraphCache } from './graph-cache';
import { structuredLog } from './structured-log';

export const enrichmentProjectionWork = {
  materialize: reindexTranscriptEnrichmentBrain,
  invalidate: invalidateGraphCache,
  withLease: runWithBrainIndexLease,
};

/** A failed projection never rolls back an already committed canonical command. */
export async function repairEnrichmentProjection(userId: string, id: string): Promise<boolean> {
  let observedRevision: number | undefined;
  let completed = false;
  try {
    await enrichmentProjectionWork.withLease(userId, async (guard) => {
      const before = await db.transcriptEnrichment.findFirst({
        where: {
          id,
          userId,
          brainProjectionPending: true,
          OR: [
            { brainProjectionNextAttemptAt: null },
            { brainProjectionNextAttemptAt: { lte: new Date() } },
          ],
        },
        include: {
          transcript: { select: { sourceVersion: true, sourceChecksum: true, status: true } },
        },
      });
      if (!before) return;
      observedRevision = before.revision;
      const checksum = enrichmentChecksum(before, before.transcript);
      await enrichmentProjectionWork.materialize(userId, id, guard);
      await guard();
      await enrichmentProjectionWork.invalidate(userId);
      await guard();
      completed = await db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL statement_timeout = '3s'`;
          await tx.$queryRaw`SELECT id FROM "Transcript" WHERE id = ${before.transcriptId} AND "userId" = ${userId} FOR SHARE`;
          await tx.$queryRaw`SELECT id FROM "TranscriptEnrichment" WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`;
          const current = await tx.transcriptEnrichment.findFirst({
            where: { id, userId },
            include: {
              transcript: { select: { sourceVersion: true, sourceChecksum: true, status: true } },
            },
          });
          if (!current) return true;
          if (
            current.revision !== observedRevision ||
            enrichmentChecksum(current, current.transcript) !== checksum
          )
            return false;
          await guard();
          // Raw bookkeeping deliberately leaves canonical updatedAt and revision unchanged.
          await tx.$executeRaw`UPDATE "TranscriptEnrichment" SET "brainProjectedRevision" = "revision", "brainProjectionPending" = false, "brainProjectionAttempt" = 0, "brainProjectionNextAttemptAt" = NULL, "brainProjectionErrorCode" = NULL, "brainProjectedAt" = NOW() WHERE id = ${id} AND "userId" = ${userId} AND "revision" = ${observedRevision}`;
          return true;
        },
        { maxWait: 2000, timeout: 5000 },
      );
    });
    return completed;
  } catch {
    if (observedRevision !== undefined) {
      await db.$executeRaw`UPDATE "TranscriptEnrichment" SET "brainProjectionPending" = true, "brainProjectionAttempt" = "brainProjectionAttempt" + 1, "brainProjectionErrorCode" = 'GRAPH_PROJECTION_RETRY', "brainProjectionNextAttemptAt" = NOW() + make_interval(secs => LEAST(300, 15 * power(2, LEAST("brainProjectionAttempt", 5)))::int) WHERE id = ${id} AND "userId" = ${userId} AND "revision" = ${observedRevision}`.catch(
        () => undefined,
      );
    }
    structuredLog('warning', 'enrichment-projection-retry', {
      actor_id: userId,
      source_id: id,
      error_code: 'GRAPH_PROJECTION_RETRY',
    });
    return false;
  }
}

let running = false;
export async function repairPendingEnrichmentProjections(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const rows = await db.transcriptEnrichment.findMany({
      where: {
        brainProjectionPending: true,
        OR: [
          { brainProjectionNextAttemptAt: null },
          { brainProjectionNextAttemptAt: { lte: new Date() } },
        ],
      },
      select: { id: true, userId: true },
      orderBy: { updatedAt: 'asc' },
      take: 8,
    });
    for (const row of rows) await repairEnrichmentProjection(row.userId, row.id);
  } finally {
    running = false;
  }
}
export function startEnrichmentProjectionMaintenance(): void {
  const run = () =>
    void repairPendingEnrichmentProjections().catch(() =>
      structuredLog('warning', 'enrichment-projection-maintenance-unavailable', {
        error_code: 'GRAPH_PROJECTION_UNAVAILABLE',
      }),
    );
  run();
  const timer = setInterval(run, 15_000);
  timer.unref();
}
