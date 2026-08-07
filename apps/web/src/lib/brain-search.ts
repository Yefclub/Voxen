import { db } from './db';

type BrainSearchDb = Pick<typeof db, 'brainNode' | 'transcriptEnrichment'>;

export async function searchBrainNodes(
  userId: string,
  query: string,
  limit: number,
  client: BrainSearchDb = db,
) {
  const take = Math.max(1, Math.min(120, limit * 4));
  const candidates = await client.brainNode.findMany({
    where: {
      userId,
      status: 'ACTIVE',
      OR: [
        { key: { contains: query, mode: 'insensitive' } },
        { label: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take,
    select: {
      id: true,
      key: true,
      type: true,
      label: true,
      description: true,
      status: true,
      sourceType: true,
      sourceId: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const enrichmentIds = candidates.flatMap((node) =>
    node.sourceType === 'EXTERNAL_ENRICHMENT' && node.sourceId ? [node.sourceId] : [],
  );
  if (enrichmentIds.length === 0) return candidates.slice(0, limit);
  const currentEnrichments = await client.transcriptEnrichment.findMany({
    where: {
      id: { in: enrichmentIds },
      userId,
      status: 'READY',
      reviewState: 'ACCEPTED',
      staleReason: null,
      OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
      transcript: { status: 'ACTIVE' },
    },
    select: { id: true },
  });
  const currentIds = new Set(currentEnrichments.map((item) => item.id));
  return candidates
    .filter(
      (node) =>
        node.sourceType !== 'EXTERNAL_ENRICHMENT' ||
        (node.sourceId !== null && currentIds.has(node.sourceId)),
    )
    .slice(0, limit);
}
