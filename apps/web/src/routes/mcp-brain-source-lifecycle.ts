import type { BrainSourceType } from '../../prisma-generated/client';
import { db } from '../lib/db';

export async function keepCurrentOwnedSources<
  T extends { sourceType: BrainSourceType; sourceId: string },
>(userId: string, sources: T[]): Promise<T[]> {
  const transcriptIds = sources
    .filter((source) => source.sourceType === 'TRANSCRIPT')
    .map((source) => source.sourceId);
  if (transcriptIds.length === 0) return sources;
  const activeIds = new Set(
    (
      await db.transcript.findMany({
        where: { userId, id: { in: transcriptIds }, status: 'ACTIVE' },
        select: { id: true },
      })
    ).map((transcript) => transcript.id),
  );
  return sources.filter(
    (source) => source.sourceType !== 'TRANSCRIPT' || activeIds.has(source.sourceId),
  );
}
