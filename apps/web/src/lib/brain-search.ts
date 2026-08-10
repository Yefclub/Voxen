import type { Prisma } from '../../prisma-generated/client';
import { db } from './db';

type BrainSearchDb = Pick<typeof db, 'brainNode' | 'transcriptEnrichment'>;

const brainSearchNodeSelect = {
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
} satisfies Prisma.BrainNodeSelect;

type BrainSearchNode = Prisma.BrainNodeGetPayload<{ select: typeof brainSearchNodeSelect }>;

export async function searchBrainNodes(
  userId: string,
  query: string,
  limit: number,
  client: BrainSearchDb = db,
) {
  const requestedLimit = Math.max(1, Math.min(120, Math.trunc(limit)));
  const batchSize = Math.max(20, Math.min(120, requestedLimit * 4));
  const results: BrainSearchNode[] = [];
  let skip = 0;

  while (results.length < requestedLimit) {
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
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      skip,
      take: batchSize,
      select: brainSearchNodeSelect,
    });
    if (candidates.length === 0) break;
    skip += candidates.length;

    const enrichmentIds = candidates.flatMap((node) =>
      node.sourceType === 'EXTERNAL_ENRICHMENT' && node.sourceId ? [node.sourceId] : [],
    );
    if (enrichmentIds.length === 0) {
      results.push(...candidates);
    } else {
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
      results.push(
        ...candidates.filter(
          (node) =>
            node.sourceType !== 'EXTERNAL_ENRICHMENT' ||
            (node.sourceId !== null && currentIds.has(node.sourceId)),
        ),
      );
    }
    if (candidates.length < batchSize) break;
  }

  return results.slice(0, requestedLimit);
}
