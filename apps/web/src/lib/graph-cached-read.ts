import { getRedisPublisher } from './redis';
import { db } from './db';
import { filterAccessibleBrainNodes } from './brain-source-visibility';
import type { GraphReadEdge, GraphReadNode } from './graph-read-model';

/** Cached graph snapshots must still satisfy current canonical research visibility. */
export async function readCurrentGraphCache(userId: string, key: string): Promise<string | null> {
  const value = await getRedisPublisher().get(key);
  if (!value) return null;
  const cached = JSON.parse(value) as { nodes?: GraphReadNode[]; edges?: GraphReadEdge[] };
  if (!Array.isArray(cached.nodes)) return null;
  const organized = Array.isArray(cached.edges)
    ? cached.edges.filter((edge) => edge.method === 'llm-grounded-organization')
    : [];
  if (organized.length) {
    const current = await db.brainEdge.count({
      where: {
        userId,
        method: 'llm-grounded-organization',
        id: { in: organized.map((edge) => edge.id) },
        status: 'ACTIVE',
        from: { userId, status: 'ACTIVE' },
        to: { userId, status: 'ACTIVE' },
      },
    });
    if (current !== organized.length) return null;
  }
  const research = cached.nodes.filter((node) => node.sourceType === 'EXTERNAL_ENRICHMENT');
  const current = await filterAccessibleBrainNodes(
    userId,
    research.map((node) => ({
      ...node,
      metadata: { enrichmentRevision: node.enrichmentRevision },
    })),
  );
  // Recompute slices and insights together; do not retain derived labels from an obsolete cache.
  return current.length === research.length ? value : null;
}
