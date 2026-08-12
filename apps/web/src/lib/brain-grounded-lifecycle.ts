import { Prisma } from '../../prisma-generated/client';
import { cancelTranscriptEnrichmentsForInactiveParent } from './transcript-enrichments';
import { TRANSCRIPT_LIST_SELECT } from './transcript-list-select';
import { reindexTranscriptBrain } from './brain';
import { runWithBrainIndexLease } from './brain-index-lease';
import { db } from './db';

type GroundedLifecycleDb = Pick<typeof db, '$executeRaw'>;
type TranscriptLifecycleStatus = 'ACTIVE' | 'ARCHIVED' | 'TRASH';
type TranscriptListItem = Prisma.TranscriptGetPayload<{ select: typeof TRANSCRIPT_LIST_SELECT }>;

/**
 * Projects source lifecycle into the navigable graph without deleting the
 * temporal ledger. A grounded edge is current only while at least one of its
 * non-invalidated transcript sources is ACTIVE.
 */
export async function reconcileGroundedBrainLifecycle(
  userId: string,
  client: GroundedLifecycleDb = db,
): Promise<void> {
  await client.$executeRaw(Prisma.sql`
    WITH desired AS (
      SELECT edge.id,
        CASE WHEN EXISTS (
            SELECT 1
            FROM "BrainSource" source
            JOIN "Transcript" transcript
              ON source."sourceType" = 'TRANSCRIPT'::"BrainSourceType"
             AND transcript.id = source."sourceId"
             AND transcript."userId" = source."userId"
             AND transcript.status = 'ACTIVE'::"ContentStatus"
            WHERE source."userId" = ${userId}
              AND source."edgeId" = edge.id
              AND source."invalidatedAt" IS NULL
          ) THEN 'ACTIVE'::"ContentStatus" ELSE 'ARCHIVED'::"ContentStatus" END AS status
      FROM "BrainEdge" edge
      WHERE edge."userId" = ${userId}
        AND edge.method LIKE 'llm-grounded%'
        AND edge.status <> 'TRASH'::"ContentStatus"
    )
    UPDATE "BrainEdge" edge
    SET status = desired.status,
        "updatedAt" = CURRENT_TIMESTAMP
    FROM desired
    WHERE edge.id = desired.id
      AND edge.status IS DISTINCT FROM desired.status
  `);

  await client.$executeRaw(Prisma.sql`
    WITH desired AS (
      SELECT node.id,
        CASE WHEN EXISTS (
            SELECT 1 FROM "BrainEdge" edge
            WHERE edge."userId" = ${userId}
              AND edge.status = 'ACTIVE'::"ContentStatus"
              AND (edge."fromNodeId" = node.id OR edge."toNodeId" = node.id)
          ) THEN 'ACTIVE'::"ContentStatus" ELSE 'ARCHIVED'::"ContentStatus" END AS status
      FROM "BrainNode" node
      WHERE node."userId" = ${userId}
        AND node.metadata->>'method' = 'llm-grounded'
        AND node."sourceType" IS NULL
        AND node.status <> 'TRASH'::"ContentStatus"
    )
    UPDATE "BrainNode" node
    SET status = desired.status,
        "updatedAt" = CURRENT_TIMESTAMP
    FROM desired
    WHERE node.id = desired.id
      AND node.status IS DISTINCT FROM desired.status
  `);
}

export async function applyTranscriptLifecycle(
  userId: string,
  transcriptId: string,
  status: TranscriptLifecycleStatus,
): Promise<TranscriptListItem | null> {
  let transcript: TranscriptListItem | null = null;
  const applied = await runWithBrainIndexLease(userId, async (assertLeaseOwnership) => {
    transcript = await db.$transaction(async (tx) => {
      const now = new Date();
      const updated = await tx.transcript.update({
        where: { id: transcriptId },
        data: {
          status,
          archivedAt: status === 'ARCHIVED' ? now : null,
          trashedAt: status === 'TRASH' ? now : null,
        },
        select: TRANSCRIPT_LIST_SELECT,
      });
      if (status !== 'ACTIVE') {
        await cancelTranscriptEnrichmentsForInactiveParent(tx, userId, transcriptId, now);
      }
      await reconcileGroundedBrainLifecycle(userId, tx);
      return updated;
    });
    await assertLeaseOwnership();
    await reindexTranscriptBrain(userId, transcriptId, { assertLeaseOwnership });
  });
  return applied ? transcript : null;
}
