import { db } from '../db';
import { runWithBrainIndexLease } from '../brain-index-lease';
import { reindexTranscriptEnrichmentBrain } from '../brain-enrichments';
import { invalidateGraphCache } from '../graph-cache';
import { structuredDiagnostic } from '../structured-log';

export async function projectResearch(userId: string, id: string): Promise<void> {
  await runWithBrainIndexLease(userId, async (guard) => {
    const row = await db.transcriptEnrichment.findFirst({
      where: { id, userId },
      select: {
        revision: true,
        brainProjectionPending: true,
        brainProjectedRevision: true,
        brainProjectionAttempt: true,
      },
    });
    if (!row || (!row.brainProjectionPending && row.brainProjectedRevision === row.revision))
      return;
    try {
      await reindexTranscriptEnrichmentBrain(userId, id, guard);
      await guard();
      await db.transcriptEnrichment.updateMany({
        where: { id, userId, revision: row.revision },
        data: {
          brainProjectionPending: false,
          brainProjectedRevision: row.revision,
          brainProjectedAt: new Date(),
          brainProjectionAttempt: 0,
          brainProjectionNextAttemptAt: null,
          brainProjectionErrorCode: null,
        },
      });
      await invalidateGraphCache(userId);
    } catch (error) {
      await db.transcriptEnrichment.updateMany({
        where: { id, userId, revision: row.revision },
        data: {
          brainProjectionPending: true,
          brainProjectionAttempt: { increment: 1 },
          brainProjectionErrorCode: 'PROJECTION_FAILED',
          brainProjectionNextAttemptAt: new Date(
            Date.now() + Math.min(600_000, 15_000 * 2 ** Math.min(row.brainProjectionAttempt, 6)),
          ),
        },
      });
      structuredDiagnostic(
        'warning',
        'research-projection-failed',
        'RESEARCH_PROJECTION_FAILED',
        error,
      );
    }
  });
}

let draining = false;
export async function drainResearchProjections(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    await db.transcriptEnrichment.updateMany({
      where: { staleReason: null, expiresAt: { lt: new Date() } },
      data: {
        staleReason: 'research-expired',
        revision: { increment: 1 },
        brainProjectionPending: true,
        brainProjectionNextAttemptAt: null,
      },
    });
    const rows = await db.transcriptEnrichment.findMany({
      where: {
        brainProjectionPending: true,
        user: { status: 'APPROVED' },
        OR: [
          { brainProjectionNextAttemptAt: null },
          { brainProjectionNextAttemptAt: { lte: new Date() } },
        ],
      },
      select: { id: true, userId: true },
      orderBy: { updatedAt: 'asc' },
      take: 10,
    });
    for (const row of rows) await projectResearch(row.userId, row.id);
  } finally {
    draining = false;
  }
}
