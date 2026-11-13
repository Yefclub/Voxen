import { db } from '../db';
import { structuredDiagnostic } from '../structured-log';
import { enqueueResearch, ResearchError } from './queue';

export type ResearchScheduleCursor = { collectedAt: Date; id: string };

export async function scheduleResearchAfterCapture(
  userId: string,
  transcriptId: string,
  enqueue: typeof enqueueResearch = enqueueResearch,
): Promise<void> {
  try {
    await enqueue(userId, transcriptId, 'AUTO');
  } catch (error) {
    // Capture publication is already committed. The periodic sweep can recover
    // a missed enqueue; archived/deleted sources are intentionally skipped.
    if (error instanceof ResearchError && error.code === 'NOT_FOUND') return;
    structuredDiagnostic('warning', 'research-schedule-failed', 'RESEARCH_SCHEDULE_FAILED', error);
  }
}

export async function scheduleCapturedResearch(
  cursor: ResearchScheduleCursor | null = null,
  limit = 20,
): Promise<{ cursor: ResearchScheduleCursor | null }> {
  const sources = await db.transcript.findMany({
    where: {
      status: 'ACTIVE',
      user: { status: 'APPROVED' },
      sourceMetadata: { path: ['producer'], equals: 'voxen-capture' },
      sourceCollectedAt: { not: null },
      ...(cursor
        ? {
            OR: [
              { sourceCollectedAt: { lt: cursor.collectedAt } },
              { sourceCollectedAt: cursor.collectedAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    select: { id: true, userId: true, sourceCollectedAt: true },
    orderBy: [{ sourceCollectedAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
  for (const source of sources) await scheduleResearchAfterCapture(source.userId, source.id);
  const last = sources.at(-1);
  return {
    cursor:
      sources.length === limit && last?.sourceCollectedAt
        ? { collectedAt: last.sourceCollectedAt, id: last.id }
        : null,
  };
}
