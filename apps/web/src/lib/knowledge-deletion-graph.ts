// ============================================================================
// Knowledge deletion canonical writes (web) — spec 215
// ============================================================================
// Shared ownership-fence and graph-cleanup helpers for the web deletion
// executor. Mirrors the lease fence and graph cleanup in
// apps/worker/src/db.py and apps/worker/src/knowledge_deletion.py.
// ============================================================================

import type { Prisma } from '../../prisma-generated/client';
import type { KnowledgeDeletionTargetType } from './knowledge-deletion';

export type DeletionTx = Prisma.TransactionClient;

export class LeaseLostError extends Error {
  constructor() {
    super('Knowledge deletion lease was lost.');
  }
}

export type ClaimedDeletionJob = {
  id: string;
  userId: string;
  deletionTargetType: KnowledgeDeletionTargetType;
  deletionTargetId: string;
  attempt: number;
  workerId: string;
};

export function fence(job: ClaimedDeletionJob) {
  return {
    id: job.id,
    userId: job.userId,
    status: 'RUNNING' as const,
    workerId: job.workerId,
    attempt: job.attempt,
    leaseExpiresAt: { gte: new Date() },
  };
}

export async function assertOwnership(tx: DeletionTx, job: ClaimedDeletionJob): Promise<void> {
  const owner = await tx.job.findFirst({
    where: fence(job),
    select: { id: true },
  });
  if (!owner) throw new LeaseLostError();
}

export async function deleteGraphSources(
  tx: DeletionTx,
  userId: string,
  sourceType: string,
  sourceIds: string[],
): Promise<void> {
  const ids = [...new Set(sourceIds)];
  if (ids.length === 0) return;
  const edgeRows = await tx.$queryRaw<Array<{ edgeId: string | null }>>`
    SELECT DISTINCT "edgeId"
    FROM "BrainSource"
    WHERE "userId" = ${userId}
      AND "sourceType" = ${sourceType}::"BrainSourceType"
      AND "sourceId" = ANY(${ids}::text[])
      AND "edgeId" IS NOT NULL
  `;
  await tx.$executeRaw`
    DELETE FROM "BrainSource"
    WHERE "userId" = ${userId}
      AND "sourceType" = ${sourceType}::"BrainSourceType"
      AND "sourceId" = ANY(${ids}::text[])
  `;
  await tx.$executeRaw`
    DELETE FROM "BrainEntityAlias"
    WHERE "userId" = ${userId}
      AND "sourceType" = ${sourceType}::"BrainSourceType"
      AND "sourceId" = ANY(${ids}::text[])
  `;
  await tx.$executeRaw`
    DELETE FROM "BrainFact" fact
    WHERE fact."userId" = ${userId}
      AND NOT EXISTS (
        SELECT 1 FROM "BrainSource" source WHERE source."factId" = fact.id
      )
  `;
  const affectedEdgeIds = edgeRows.map((row) => row.edgeId).filter((id): id is string => !!id);
  if (affectedEdgeIds.length > 0) {
    await tx.$executeRaw`
      DELETE FROM "BrainEdge" edge
      WHERE edge."userId" = ${userId}
        AND edge.id = ANY(${affectedEdgeIds}::text[])
        AND edge.method <> 'manual'
        AND NOT EXISTS (
          SELECT 1 FROM "BrainSource" source WHERE source."edgeId" = edge.id
        )
    `;
  }
  await tx.$executeRaw`
    DELETE FROM "BrainNode"
    WHERE "userId" = ${userId}
      AND "sourceType" = ${sourceType}::"BrainSourceType"
      AND "sourceId" = ANY(${ids}::text[])
  `;
  await tx.$executeRaw`
    DELETE FROM "BrainNode" node
    WHERE node."userId" = ${userId}
      AND node."sourceType" IS NULL
      AND node."updatedAt" < NOW() - INTERVAL '2 minutes'
      AND (
        (node.type = 'TOPIC'::"BrainNodeType" AND node.metadata->>'method' = 'keyword')
        OR (
          node.type = 'ENTITY'::"BrainNodeType"
          AND node.metadata->>'method' IN ('entity-heuristic', 'llm-grounded')
        )
        OR (
          node.type = 'CLAIM'::"BrainNodeType"
          AND node.metadata->>'method' = 'llm-grounded'
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM "BrainEdge" edge
        WHERE edge."userId" = node."userId"
          AND (edge."fromNodeId" = node.id OR edge."toNodeId" = node.id)
      )
  `;
}

export async function ownedTreeIds(
  tx: DeletionTx,
  table: 'Note' | 'LibraryFolder',
  userId: string,
  rootId: string,
): Promise<string[]> {
  const query =
    table === 'Note'
      ? `
        WITH RECURSIVE tree AS (
          SELECT id, "userId" FROM "Note" WHERE id = $1
          UNION
          SELECT child.id, child."userId"
          FROM "Note" child
          JOIN tree parent ON child."parentId" = parent.id
        )
        SELECT id, "userId" FROM tree
        `
      : `
        WITH RECURSIVE tree AS (
          SELECT id, "userId" FROM "LibraryFolder" WHERE id = $1
          UNION
          SELECT child.id, child."userId"
          FROM "LibraryFolder" child
          JOIN tree parent ON child."parentId" = parent.id
        )
        SELECT id, "userId" FROM tree
        `;
  const rows = await tx.$queryRawUnsafe<Array<{ id: string; userId: string }>>(query, rootId);
  if (rows.length === 0) return [];
  if (rows.some((row) => String(row.userId) !== userId)) {
    throw new Error('Cross-workspace tree relation rejected.');
  }
  return rows.map((row) => String(row.id));
}
