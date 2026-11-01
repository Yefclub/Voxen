// ============================================================================
// Knowledge deletion executor (web) — spec 215
// ============================================================================
// Retained Product 1 maintenance that used to run in the analysis worker:
// durable, idempotent deletion of user-owned knowledge resources. Runs in the
// web process (startup drain + interval + post-enqueue trigger) so deletions
// complete and recover after restart without the worker.
//
// Mirrors apps/worker/src/knowledge_deletion.py: same ordering (advisory
// lock → graph lease → canonical transaction → storage deletes), same
// ownership checks, same retry budget (3 attempts, expired leases requeue).
// ============================================================================

import { randomUUID } from 'node:crypto';

import { db } from './db';
import type { Prisma } from '../../prisma-generated/client';
import { runWithBrainIndexLease } from './brain-index-lease';
import { publishJobEvent } from './job-events';
import { storageDelete } from './storage/index';
import type { KnowledgeDeletionTargetType } from './knowledge-deletion';

const LEASE_TTL_MS = 90_000;
const MAX_ATTEMPTS = 3;
const WORKER_ID_PREFIX = 'web-executor';

type ClaimedDeletionJob = {
  id: string;
  userId: string;
  deletionTargetType: KnowledgeDeletionTargetType;
  deletionTargetId: string;
  attempt: number;
  workerId: string;
};

async function claimDeletionJob(jobId: string, owner: string): Promise<ClaimedDeletionJob | null> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; userId: string }>>`
      SELECT id, "userId"
      FROM "Job"
      WHERE id = ${jobId}
        AND type = 'DELETE_KNOWLEDGE'
        AND (status = 'QUEUED' OR (status = 'RUNNING' AND "leaseExpiresAt" < NOW()))
      FOR UPDATE SKIP LOCKED
    `;
    if (rows.length === 0) return null;
    const now = new Date();
    const updated = await tx.job.updateMany({
      where: { id: jobId },
      data: {
        status: 'RUNNING',
        finishedAt: null,
        errorMsg: null,
        workerId: owner,
        attempt: { increment: 1 },
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + LEASE_TTL_MS),
        progressStage: 'running',
        progressedAt: now,
      },
    });
    if (updated.count !== 1) return null;
    const job = await tx.job.findUniqueOrThrow({
      where: { id: jobId },
      select: {
        id: true,
        userId: true,
        deletionTargetType: true,
        deletionTargetId: true,
        attempt: true,
        workerId: true,
      },
    });
    if (!job.deletionTargetType || !job.deletionTargetId || !job.workerId) return null;
    return {
      id: job.id,
      userId: job.userId,
      deletionTargetType: job.deletionTargetType,
      deletionTargetId: job.deletionTargetId,
      attempt: job.attempt,
      workerId: job.workerId,
    };
  });
}

type DbClient = Prisma.TransactionClient;

async function assertOwnership(tx: DbClient, job: ClaimedDeletionJob): Promise<void> {
  const owner = await tx.job.findFirst({
    where: {
      id: job.id,
      userId: job.userId,
      status: 'RUNNING',
      workerId: job.workerId,
      attempt: job.attempt,
    },
    select: { id: true },
  });
  if (!owner) throw new Error('Knowledge deletion lease was lost.');
}

async function deleteGraphSources(
  tx: DbClient,
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

async function ownedTreeIds(
  tx: DbClient,
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

async function deleteStorageKeys(keys: Array<string | null | undefined>): Promise<void> {
  for (const key of new Set(keys.filter((key): key is string => !!key))) {
    await storageDelete(key);
  }
}

async function executeTranscriptDeletion(job: ClaimedDeletionJob): Promise<void> {
  const lockKey = `voxen:source-refresh:${job.deletionTargetId}`;
  await db.$executeRaw`SELECT pg_advisory_lock(hashtext(${lockKey}))`;
  try {
    const leased = await runWithBrainIndexLease(job.userId, async (assertLeaseOwnership) => {
      await db.$transaction(async (tx) => {
        await assertOwnership(tx, job);
        await assertLeaseOwnership();
        const locked = await tx.$queryRaw<
          Array<{
            id: string;
            status: string;
            mdPath: string | null;
            originalObjectKey: string | null;
            previewObjectKey: string | null;
            savedMediaId: string | null;
            savedMediaObjectKey: string | null;
          }>
        >`
          SELECT transcript.id, transcript.status, transcript."mdPath",
                 transcript."originalObjectKey", transcript."previewObjectKey",
                 media.id AS "savedMediaId",
                 media."objectKey" AS "savedMediaObjectKey"
          FROM "Transcript" transcript
          LEFT JOIN "SavedMedia" media ON media."transcriptId" = transcript.id
          WHERE transcript.id = ${job.deletionTargetId} AND transcript."userId" = ${job.userId}
          FOR UPDATE OF transcript
        `;
        const row = locked[0];
        if (row && String(row.status) !== 'TRASH') {
          throw new Error('Transcript must remain in trash until deletion completes.');
        }
        const versions = row
          ? await tx.$queryRaw<Array<{ mdPath: string | null }>>`
              SELECT "mdPath" FROM "SourceContentVersion"
              WHERE "transcriptId" = ${job.deletionTargetId} AND "userId" = ${job.userId}
            `
          : [];
        if (row) {
          await deleteStorageKeys([
            row.mdPath,
            row.previewObjectKey,
            row.originalObjectKey === row.savedMediaObjectKey ? null : row.originalObjectKey,
            ...versions.map((version) => version.mdPath),
          ]);
        }
        if (row?.savedMediaId) {
          if (row.savedMediaObjectKey) {
            await tx.$executeRaw`
              UPDATE "SavedMedia"
              SET status = 'READY'::"SavedMediaStatus", "transcriptId" = NULL,
                  "processedAt" = NULL, "errorMsg" = NULL, "updatedAt" = NOW()
              WHERE id = ${row.savedMediaId} AND "userId" = ${job.userId}
            `;
          } else {
            await tx.$executeRaw`
              UPDATE "SavedMedia"
              SET status = 'FAILED'::"SavedMediaStatus", "transcriptId" = NULL,
                  "processedAt" = NULL,
                  "errorMsg" = 'O arquivo original não está mais disponível.',
                  "updatedAt" = NOW()
              WHERE id = ${row.savedMediaId} AND "userId" = ${job.userId}
            `;
          }
        }
        await deleteGraphSources(tx, job.userId, 'TRANSCRIPT', [job.deletionTargetId]);
        await tx.$executeRaw`
          DELETE FROM "Transcript" WHERE id = ${job.deletionTargetId} AND "userId" = ${job.userId}
        `;
      });
    });
    if (!leased) throw new Error('Knowledge graph lease is temporarily unavailable.');
  } finally {
    await db.$executeRaw`SELECT pg_advisory_unlock(hashtext(${lockKey}))`;
  }
}

async function executeNoteDeletion(job: ClaimedDeletionJob): Promise<void> {
  const leased = await runWithBrainIndexLease(job.userId, async (assertLeaseOwnership) => {
    await db.$transaction(async (tx) => {
      await assertOwnership(tx, job);
      await assertLeaseOwnership();
      const ids = await ownedTreeIds(tx, 'Note', job.userId, job.deletionTargetId);
      await deleteGraphSources(tx, job.userId, 'NOTE', ids.length > 0 ? ids : [job.deletionTargetId]);
      await tx.$executeRaw`
        DELETE FROM "Note" WHERE id = ${job.deletionTargetId} AND "userId" = ${job.userId}
      `;
    });
  });
  if (!leased) throw new Error('Knowledge graph lease is temporarily unavailable.');
}

async function executeSavedMediaDeletion(job: ClaimedDeletionJob): Promise<void> {
  const rows = await db.$queryRaw<
    Array<{ id: string; objectKey: string | null; status: string; transcriptId: string | null }>
  >`
    SELECT id, "objectKey", status, "transcriptId"
    FROM "SavedMedia" WHERE id = ${job.deletionTargetId} AND "userId" = ${job.userId}
  `;
  const media = rows[0];
  if (media) {
    if (media.transcriptId || String(media.status) === 'PROCESSED') {
      throw new Error('Processed saved media remains linked to its transcript.');
    }
    if (['QUEUED', 'DOWNLOADING', 'PROCESSING'].includes(String(media.status))) {
      throw new Error('Saved media is still being processed.');
    }
    await deleteStorageKeys([media.objectKey]);
  }
  await db.$transaction(async (tx) => {
    await assertOwnership(tx, job);
    await tx.$executeRaw`
      DELETE FROM "SavedMedia"
      WHERE id = ${job.deletionTargetId} AND "userId" = ${job.userId} AND "transcriptId" IS NULL
    `;
  });
}

async function executeLibraryFolderDeletion(job: ClaimedDeletionJob): Promise<void> {
  const leased = await runWithBrainIndexLease(job.userId, async (assertLeaseOwnership) => {
    await db.$transaction(async (tx) => {
      await assertOwnership(tx, job);
      await assertLeaseOwnership();
      let ids: string[];
      if (job.deletionTargetId === '*') {
        const forest = await tx.$queryRaw<Array<{ id: string; userId: string }>>`
          WITH RECURSIVE tree AS (
            SELECT id, "userId" FROM "LibraryFolder" WHERE "userId" = ${job.userId}
            UNION
            SELECT child.id, child."userId"
            FROM "LibraryFolder" child
            JOIN tree parent ON child."parentId" = parent.id
          )
          SELECT id, "userId" FROM tree
        `;
        if (forest.some((row) => String(row.userId) !== job.userId)) {
          throw new Error('Cross-workspace folder relation rejected.');
        }
        ids = forest.map((row) => String(row.id));
        const transcripts = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "Transcript" WHERE "userId" = ${job.userId}
          AND "folderId" = ANY(${ids}::text[])
        `;
        await deleteGraphSources(tx, job.userId, 'FOLDER', ids);
        await tx.$executeRaw`DELETE FROM "LibraryFolder" WHERE "userId" = ${job.userId}`;
        const transcriptIds = transcripts.map((row) => String(row.id));
        if (transcriptIds.length > 0) {
          await tx.$executeRaw`
            UPDATE "BrainNode"
            SET metadata = COALESCE(metadata, '{}'::jsonb) - 'folderId',
                "updatedAt" = NOW()
            WHERE "userId" = ${job.userId}
              AND "sourceType" = 'TRANSCRIPT'::"BrainSourceType"
              AND "sourceId" = ANY(${transcriptIds}::text[])
          `;
        }
      } else {
        ids = await ownedTreeIds(tx, 'LibraryFolder', job.userId, job.deletionTargetId);
        const transcripts = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "Transcript" WHERE "userId" = ${job.userId}
          AND "folderId" = ANY(${ids}::text[])
        `;
        await deleteGraphSources(tx, job.userId, 'FOLDER', ids.length > 0 ? ids : [job.deletionTargetId]);
        await tx.$executeRaw`
          DELETE FROM "LibraryFolder" WHERE id = ${job.deletionTargetId} AND "userId" = ${job.userId}
        `;
        const transcriptIds = transcripts.map((row) => String(row.id));
        if (transcriptIds.length > 0) {
          await tx.$executeRaw`
            UPDATE "BrainNode"
            SET metadata = COALESCE(metadata, '{}'::jsonb) - 'folderId',
                "updatedAt" = NOW()
            WHERE "userId" = ${job.userId}
              AND "sourceType" = 'TRANSCRIPT'::"BrainSourceType"
              AND "sourceId" = ANY(${transcriptIds}::text[])
          `;
        }
      }
    });
  });
  if (!leased) throw new Error('Knowledge graph lease is temporarily unavailable.');
}

async function executeTranscriptEnrichmentDeletion(job: ClaimedDeletionJob): Promise<void> {
  const leased = await runWithBrainIndexLease(job.userId, async (assertLeaseOwnership) => {
    await db.$transaction(async (tx) => {
      await assertOwnership(tx, job);
      await assertLeaseOwnership();
      await deleteGraphSources(tx, job.userId, 'EXTERNAL_ENRICHMENT', [job.deletionTargetId]);
      await tx.$executeRaw`
        DELETE FROM "TranscriptEnrichment"
        WHERE id = ${job.deletionTargetId} AND "userId" = ${job.userId}
      `;
    });
  });
  if (!leased) throw new Error('Knowledge graph lease is temporarily unavailable.');
}

async function finishJob(job: ClaimedDeletionJob, outcome: 'done' | 'failed', errorMsg?: string): Promise<void> {
  const now = new Date();
  if (outcome === 'done') {
    await publishJobEvent(job.userId, { jobId: job.id, stage: 'done', percent: 100 }).catch(() => {});
    await db.job.updateMany({
      where: { id: job.id, userId: job.userId, status: 'RUNNING' },
      data: {
        status: 'DONE',
        workerId: null,
        heartbeatAt: null,
        leaseExpiresAt: null,
        progressStage: 'done',
        progressPercent: 100,
        progressedAt: now,
        finishedAt: now,
        errorMsg: null,
      },
    });
  } else if (job.attempt >= MAX_ATTEMPTS) {
    await db.job.updateMany({
      where: { id: job.id, userId: job.userId },
      data: {
        status: 'FAILED',
        workerId: null,
        heartbeatAt: null,
        leaseExpiresAt: null,
        progressStage: 'failed',
        progressedAt: now,
        finishedAt: now,
        errorMsg: (errorMsg ?? 'Knowledge deletion failed.').slice(0, 2000),
      },
    });
  } else {
    await db.job.updateMany({
      where: { id: job.id, userId: job.userId },
      data: {
        status: 'QUEUED',
        workerId: null,
        heartbeatAt: null,
        leaseExpiresAt: null,
        progressStage: 'queued',
        progressPercent: 0,
        progressedAt: now,
        errorMsg: (errorMsg ?? 'Knowledge deletion will be retried.').slice(0, 2000),
      },
    });
  }
}

export async function runKnowledgeDeletionJob(jobId: string): Promise<boolean> {
  const owner = `${WORKER_ID_PREFIX}:${randomUUID()}`;
  const job = await claimDeletionJob(jobId, owner);
  if (!job) return false;
  try {
    await publishJobEvent(job.userId, { jobId: job.id, stage: 'deleting_content', percent: 15 }).catch(
      () => {},
    );
    switch (job.deletionTargetType) {
      case 'TRANSCRIPT':
        await publishJobEvent(job.userId, { jobId: job.id, stage: 'deleting_storage', percent: 30 }).catch(
          () => {},
        );
        await executeTranscriptDeletion(job);
        break;
      case 'NOTE':
        await executeNoteDeletion(job);
        break;
      case 'SAVED_MEDIA':
        await publishJobEvent(job.userId, { jobId: job.id, stage: 'deleting_storage', percent: 30 }).catch(
          () => {},
        );
        await executeSavedMediaDeletion(job);
        break;
      case 'LIBRARY_FOLDER':
        await executeLibraryFolderDeletion(job);
        break;
      case 'TRANSCRIPT_ENRICHMENT':
        await executeTranscriptEnrichmentDeletion(job);
        break;
      default:
        throw new Error('Unsupported knowledge deletion target.');
    }
    await publishJobEvent(job.userId, { jobId: job.id, stage: 'updating_graph', percent: 85 }).catch(
      () => {},
    );
    await finishJob(job, 'done');
    return true;
  } catch (error) {
    await finishJob(job, 'failed', error instanceof Error ? error.message : String(error));
    return true;
  }
}

export async function drainPendingKnowledgeDeletions(limit = 10): Promise<{ processed: number }> {
  const candidates = await db.job.findMany({
    where: {
      type: 'DELETE_KNOWLEDGE',
      OR: [{ status: 'QUEUED' }, { status: 'RUNNING', leaseExpiresAt: { lt: new Date() } }],
    },
    orderBy: { queuedAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  let processed = 0;
  for (const candidate of candidates) {
    try {
      if (await runKnowledgeDeletionJob(candidate.id)) processed += 1;
    } catch {
      // Claim races and isolated job failures must not stop the drain.
    }
  }
  return { processed };
}
