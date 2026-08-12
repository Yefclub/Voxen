import { Prisma } from '../../prisma-generated/client';
import { db } from './db';
import {
  calculateInterestProjections,
  loadProjectionFeatures,
  type InterestProjectionEvent,
  type InterestProjectionSnapshot,
} from './personal-interest-projections';

export async function calculateActivePersonalInterestProjections(
  userId: string,
  now = new Date(),
): Promise<InterestProjectionSnapshot[]> {
  const longCutoff = new Date(now.getTime() - 365 * 86_400_000);
  const [observed, explicitRows, latestEvent] = await Promise.all([
    db.interestEvent.findMany({
      where: {
        userId,
        origin: 'OBSERVED',
        occurredAt: { gte: longCutoff },
        transcript: { status: 'ACTIVE' },
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: { transcriptId: true, origin: true, kind: true, signal: true, occurredAt: true },
    }),
    db.$queryRaw<InterestProjectionEvent[]>(Prisma.sql`
      SELECT DISTINCT ON (event."transcriptId")
        event."transcriptId", event."origin", event."kind", event."signal", event."occurredAt"
      FROM "InterestEvent" AS event
      INNER JOIN "Transcript" AS transcript
        ON transcript."id" = event."transcriptId"
       AND transcript."userId" = event."userId"
      WHERE event."userId" = ${userId}
        AND event."origin" = 'EXPLICIT'::"InterestEventOrigin"
        AND transcript."status" = 'ACTIVE'::"ContentStatus"
      ORDER BY event."transcriptId", event."occurredAt" DESC, event."createdAt" DESC, event."id" DESC
    `),
    db.interestEvent.findFirst({
      where: { userId, transcript: { status: 'ACTIVE' } },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: { occurredAt: true },
    }),
  ]);
  const events: InterestProjectionEvent[] = [...observed, ...explicitRows];
  const transcriptIds = [...new Set(events.map((event) => event.transcriptId))];
  const featuresByTranscript = await loadProjectionFeatures(userId, transcriptIds, true);
  return calculateInterestProjections({
    events: events.filter((event) => featuresByTranscript.has(event.transcriptId)),
    featuresByTranscript,
    now,
    eventWatermark: latestEvent?.occurredAt ?? null,
  });
}
