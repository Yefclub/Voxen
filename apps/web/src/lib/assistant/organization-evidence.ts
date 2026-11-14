import type { Prisma } from '../../../prisma-generated/client';
import { db } from '../db';
import { evidenceAnchor } from '../transcript-local-graph';

/** Read one consistent source/graph snapshot; classification records origin, not truth. */
export async function readDocumentRelationships(userId: string, id: string, limit: number) {
  return db.$transaction(
    async (tx) => {
      const document = await tx.transcript.findFirst({
        where: { id, userId, status: 'ACTIVE', user: { status: 'APPROVED' } },
        select: { id: true, title: true, sourceVersion: true, correctionRevision: true },
      });
      if (!document) return { error: 'NOT_FOUND' as const };
      const evidenceWhere = {
        userId,
        sourceType: 'TRANSCRIPT',
        sourceId: id,
        invalidatedAt: null,
        authority: { not: null },
        excerpt: { not: null },
      } satisfies Prisma.BrainSourceWhereInput;
      const rows = await tx.brainEdge.findMany({
        where: {
          userId,
          status: 'ACTIVE',
          method: 'llm-grounded-organization',
          from: { userId, status: 'ACTIVE' },
          to: { userId, status: 'ACTIVE' },
          sources: { some: evidenceWhere },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: limit + 1,
        select: {
          id: true,
          kind: true,
          from: { select: { id: true, label: true, type: true } },
          to: { select: { id: true, label: true, type: true } },
          sources: {
            where: evidenceWhere,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            take: 2,
            select: {
              id: true,
              excerpt: true,
              authority: true,
              startLine: true,
              endLine: true,
              startSec: true,
              endSec: true,
            },
          },
        },
      });
      const nodes = new Map<string, { id: string; label: string; type: string }>();
      const evidence: Array<Record<string, unknown>> = [];
      const edges: Array<{ id: string; from: string; to: string; kind: string }> = [];
      for (const row of rows.slice(0, limit)) {
        const sources = row.sources.filter((item) => item.excerpt && item.excerpt.length <= 1600);
        if (!sources.length) continue;
        nodes.set(row.from.id, row.from);
        nodes.set(row.to.id, row.to);
        edges.push({ id: row.id, from: row.from.id, to: row.to.id, kind: row.kind });
        for (const item of sources)
          evidence.push({ ...item, edgeId: row.id, anchor: evidenceAnchor(item) });
      }
      return {
        document,
        nodes: [...nodes.values()],
        edges,
        evidence,
        truncated: rows.length > limit,
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
