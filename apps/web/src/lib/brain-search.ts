import { Prisma } from '../../prisma-generated/client';
import { db } from './db';
import { normalizeEntityAlias } from './brain-temporal';

type BrainSearchDb = Pick<typeof db, 'brainNode' | 'transcriptEnrichment' | '$queryRaw'>;

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
  const seenNodeIds = new Set<string>();
  let skip = 0;

  const normalizedAlias = normalizeEntityAlias(query);
  if (normalizedAlias) {
    const aliases = await client.$queryRaw<Array<{ entityNodeId: string }>>(Prisma.sql`
      SELECT DISTINCT alias."entityNodeId"
      FROM "BrainEntityAlias" alias
      JOIN "BrainNode" node
        ON node.id = alias."entityNodeId"
       AND node."userId" = alias."userId"
       AND node.status = 'ACTIVE'::"ContentStatus"
      JOIN "Transcript" transcript
        ON alias."sourceType" = 'TRANSCRIPT'::"BrainSourceType"
       AND transcript.id = alias."sourceId"
       AND transcript."userId" = alias."userId"
       AND transcript.status = 'ACTIVE'::"ContentStatus"
      WHERE alias."userId" = ${userId}
        AND alias."normalizedAlias" = ${normalizedAlias}
        AND alias."invalidatedAt" IS NULL
      ORDER BY alias."entityNodeId"
      LIMIT ${requestedLimit}
    `);
    if (aliases.length > 0) {
      const aliasNodes = await client.brainNode.findMany({
        where: { userId, status: 'ACTIVE', id: { in: aliases.map((item) => item.entityNodeId) } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        select: brainSearchNodeSelect,
      });
      for (const node of aliasNodes) {
        if (seenNodeIds.has(node.id)) continue;
        seenNodeIds.add(node.id);
        results.push(node);
      }
    }
  }

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
      for (const candidate of candidates) {
        if (seenNodeIds.has(candidate.id)) continue;
        seenNodeIds.add(candidate.id);
        results.push(candidate);
      }
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
      for (const candidate of candidates) {
        if (
          candidate.sourceType === 'EXTERNAL_ENRICHMENT' &&
          (candidate.sourceId === null || !currentIds.has(candidate.sourceId))
        )
          continue;
        if (seenNodeIds.has(candidate.id)) continue;
        seenNodeIds.add(candidate.id);
        results.push(candidate);
      }
    }
    if (candidates.length < batchSize) break;
  }

  return results.slice(0, requestedLimit);
}
