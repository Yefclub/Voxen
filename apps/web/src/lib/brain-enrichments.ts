import { db } from './db';
import {
  BRAIN_INDEX_VERSION,
  DESCRIPTION_LIMIT,
  addBrainSource,
  brainNodeKey,
  deleteAutomaticContentEdgesForSource,
  deleteBrainForSource,
  removeRefreshableSourceEvidence,
  truncate,
  upsertBrainEdge,
  upsertBrainNode,
} from './brain';
import { runWithBrainIndexLease, type BrainReindexGuard } from './brain-index-lease';

export async function reindexTranscriptEnrichmentBrain(
  userId: string,
  enrichmentId: string,
  assertLeaseOwnership?: BrainReindexGuard,
): Promise<void> {
  if (!assertLeaseOwnership) {
    await runWithBrainIndexLease(userId, async (guard) => {
      await reindexTranscriptEnrichmentBrain(userId, enrichmentId, guard);
    });
    return;
  }
  const enrichment = await db.transcriptEnrichment.findFirst({
    where: {
      id: enrichmentId,
      userId,
      status: 'READY',
      reviewState: 'ACCEPTED',
      staleReason: null,
      OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
      transcript: { status: 'ACTIVE' },
    },
    select: {
      id: true,
      title: true,
      content: true,
      citations: true,
      transcriptId: true,
      updatedAt: true,
    },
  });
  if (!enrichment) {
    await deleteBrainForSource(userId, 'EXTERNAL_ENRICHMENT', enrichmentId, assertLeaseOwnership);
    return;
  }

  await assertLeaseOwnership();
  const node = await upsertBrainNode({
    userId,
    key: brainNodeKey('EXTERNAL_ENRICHMENT', enrichment.id),
    type: 'CONTENT',
    label: enrichment.title,
    description: truncate(enrichment.content, DESCRIPTION_LIMIT),
    sourceType: 'EXTERNAL_ENRICHMENT',
    sourceId: enrichment.id,
    metadata: {
      authority: 'external-derived',
      transcriptId: enrichment.transcriptId,
      citations: { items: enrichment.citations },
      brainIndexVersion: BRAIN_INDEX_VERSION,
      updatedAt: enrichment.updatedAt.toISOString(),
    },
  });
  await deleteAutomaticContentEdgesForSource(userId, 'EXTERNAL_ENRICHMENT', enrichment.id);
  await removeRefreshableSourceEvidence(userId, 'EXTERNAL_ENRICHMENT', enrichment.id);
  await addBrainSource({
    userId,
    nodeId: node.id,
    sourceType: 'EXTERNAL_ENRICHMENT',
    sourceId: enrichment.id,
    excerpt: enrichment.title,
    assertLeaseOwnership,
  });
  const transcriptNode = await db.brainNode.findUnique({
    where: { userId_key: { userId, key: brainNodeKey('TRANSCRIPT', enrichment.transcriptId) } },
    select: { id: true },
  });
  if (transcriptNode) {
    await upsertBrainEdge({
      userId,
      fromNodeId: node.id,
      toNodeId: transcriptNode.id,
      kind: 'RELATED_TO',
      method: 'external-enrichment',
      confidence: 0.7,
      sourceType: 'EXTERNAL_ENRICHMENT',
      sourceId: enrichment.id,
      excerpt: enrichment.title,
      assertLeaseOwnership,
    });
  }

  // Source refresh can invalidate an enrichment in the worker while this pass
  // is materializing it. Revalidate after every write so a late reindex cannot
  // resurrect stale or parent-inactive evidence.
  await assertLeaseOwnership();
  const remainsCurrent = await db.transcriptEnrichment.findFirst({
    where: {
      id: enrichment.id,
      userId,
      status: 'READY',
      reviewState: 'ACCEPTED',
      staleReason: null,
      OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
      transcript: { status: 'ACTIVE' },
    },
    select: { id: true },
  });
  if (!remainsCurrent) {
    await deleteBrainForSource(userId, 'EXTERNAL_ENRICHMENT', enrichment.id, assertLeaseOwnership);
  }
}

export async function reindexTranscriptEnrichmentsBrain(
  userId: string,
  assertLeaseOwnership?: BrainReindexGuard,
): Promise<void> {
  if (!assertLeaseOwnership) {
    await runWithBrainIndexLease(userId, async (guard) => {
      await reindexTranscriptEnrichmentsBrain(userId, guard);
    });
    return;
  }
  const enrichments = await db.transcriptEnrichment.findMany({
    where: {
      userId,
      status: 'READY',
      reviewState: 'ACCEPTED',
      staleReason: null,
      OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
      transcript: { status: 'ACTIVE' },
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const enrichment of enrichments) {
    await assertLeaseOwnership();
    try {
      await reindexTranscriptEnrichmentBrain(userId, enrichment.id, assertLeaseOwnership);
    } catch (error) {
      await assertLeaseOwnership();
      console.warn('[brain] reindexTranscriptEnrichmentBrain failed', {
        userId,
        enrichmentId: enrichment.id,
        error,
      });
    }
  }
}

export async function syncTranscriptEnrichmentBrainLifecycle(
  userId: string,
  transcriptId: string,
  status: 'ACTIVE' | 'ARCHIVED' | 'TRASH',
): Promise<void> {
  const enrichments = await db.transcriptEnrichment.findMany({
    where: { userId, transcriptId },
    select: { id: true },
  });
  if (status === 'ACTIVE') {
    for (const enrichment of enrichments) {
      await reindexTranscriptEnrichmentBrain(userId, enrichment.id);
    }
    return;
  }
  if (enrichments.length > 0) {
    await db.brainNode.deleteMany({
      where: {
        userId,
        sourceType: 'EXTERNAL_ENRICHMENT',
        sourceId: { in: enrichments.map((item) => item.id) },
      },
    });
  }
}
