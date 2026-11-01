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

import type { Prisma } from '../../prisma-generated/client';
import { db } from './db';
import { runWithBrainIndexLease } from './brain-index-lease';
import { invalidateGraphCache } from './graph-cache';
import { publishJobEvent } from './job-events';
import { storageDelete } from './storage/index';
import type { KnowledgeDeletionTargetType } from './knowledge-deletion';

type DbClient = Prisma.TransactionClient;

const LEASE_TTL_MS = 90_000;
const HEARTBEAT_MS = 20_000;
const MAX_ATTEMPTS = 3;
const GRAPH_LEASE_ATTEMPTS = 5;
const WORKER_ID_PREFIX = 'web-executor';
const INTERRUPTED_MESSAGE = 'Knowledge deletion was interrupted and will be retried.';

const GRAPH_SOURCE_TYPE: Partial<Record<KnowledgeDeletionTargetType, string>> = {
  TRANSCRIPT: 'TRANSCRIPT',
  NOTE: 'NOTE',
  LIBRARY_FOLDER: 'FOLDER',
  TRANSCRIPT_ENRICHMENT: 'EXTERNAL_ENRICHMENT',
};

class LeaseUnavailableError extends Error {
  constructor() {
    super('Knowledge graph lease is temporarily unavailable.');
  }
}

class LeaseLostError extends Error {
  constructor() {
    super('Knowledge deletion lease was lost.');
  }
}

type ClaimedDeletionJob = {
  id: string;
  userId: string;
  deletionTargetType: KnowledgeDeletionTargetType;
  deletionTargetId: string;
  attempt: number;
  workerId: string;
};

function fence(job: ClaimedDeletionJob) {
  return {
    id: job.id,
    userId: job.userId,
    status: 'RUNNING' as const,
    workerId: job.workerId,
    attempt: job.attempt,
    leaseExpiresAt: { gte: new Date() },
  };
}

async function claimDeletionJob(jobId: string, owner: string): Promise<ClaimedDeletionJob | null> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{ id: string; userId: string; attempt: number }>
    >`
      SELECT id, "userId", attempt
      FROM "Job"
      WHERE id = ${jobId}
        AND type = 'DELETE_KNOWLEDGE'
        AND (status = 'QUEUED' OR (status = 'RUNNING' AND "leaseExpiresAt" < NOW()))
      FOR UPDATE SKIP LOCKED
    `;
    const row = rows[0];
    if (!row) return null;
    // Over-budget expired leases fail directly without re-executing,
    // mirroring the worker's recover_expired_jobs.
    if (row.attempt >= MAX_ATTEMPTS) {
      const now = new Date();
      await tx.job.updateMany({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          workerId: null,
          heartbeatAt: null,
          leaseExpiresAt: null,
          progressStage: 'failed',
          progressedAt: now,
          finishedAt: now,
          errorMsg: INTERRUPTED_MESSAGE,
        },
      });
      return null;
    }
    const now = new Date();
    const updated = await tx.job.updateMany({
      where: { id: jobId },
      data: {
        status: 'RUNNING',
        finishedAt: null,
        errorMsg: null,
        workerId: owner,
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

function startHeartbeat(job: ClaimedDeletionJob): { stop: () => void; isLost: () => boolean } {
  let lost = false;
  const beat = async (): Promise<void> => {
    if (lost) return;
    const now = new Date();
    try {
      const updated = await db.job.updateMany({
        where: fence(job),
        data: { heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + LEASE_TTL_MS) },
      });
      if (updated.count !== 1) lost = true;
    } catch {
      // A failed heartbeat must not crash the drain; the ownership fence in
      // the canonical writes still rejects stale executors.
    }
  };
  const timer = setInterval(() => void beat(), HEARTBEAT_MS);
  return { stop: () => clearInterval(timer), isLost: () => lost };
}

async function assertOwnership(tx: DbClient, job: ClaimedDeletionJob): Promise<void> {
  const owner = await tx.job.findFirst({
    where: fence(job),
    select: { id: true },
  });
  if (!owner) throw new LeaseLostError();
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

async function withGraphLease<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  let delayMs = 250;
  for (let attempt = 1; ; attempt += 1) {
    let executed = false;
    let result: T | undefined;
    const leased = await runWithBrainIndexLease(userId, async () => {
      executed = true;
      result = await operation();
    });
    if (leased) return result as T;
    if (!executed) {
      // Lease contention without running the operation: back off and retry
      // instead of burning the job attempt budget.
      if (attempt >= GRAPH_LEASE_ATTEMPTS) throw new LeaseUnavailableError();
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 2, 1000);
      continue;
    }
    throw new LeaseUnavailableError();
  }
}

async function executeTranscriptDeletion(job: ClaimedDeletionJob): Promise<void> {
  const lockKey = `voxen:source-refresh:${job.deletionTargetId}`;
  await withGraphLease(job.userId, async () => {
    await db.$transaction(async (tx) => {
      // Transaction-scoped advisory lock: same connection, auto-released.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      await assertOwnership(tx, job);
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
}

async function executeNoteDeletion(job: ClaimedDeletionJob): Promise<void> {
  await withGraphLease(job.userId, async () => {
    await db.$transaction(async (tx) => {
      await assertOwnership(tx, job);
      const ids = await ownedTreeIds(tx, 'Note', job.userId, job.deletionTargetId);
      await deleteGraphSources(tx, job.userId, 'NOTE', ids.length > 0 ? ids : [job.deletionTargetId]);
      await tx.$executeRaw`
        DELETE FROM "Note" WHERE id = ${job.deletionTargetId} AND "userId" = ${job.userId}
      `;
    });
  });
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
  await withGraphLease(job.userId, async () => {
    await db.$transaction(async (tx) => {
      await assertOwnership(tx, job);
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
        await deleteGraphSources(tx, job.userId, 'FOLDER', ids);
        await tx.$executeRaw`DELETE FROM "LibraryFolder" WHERE "userId" = ${job.userId}`;
      } else {
        ids = await ownedTreeIds(tx, 'LibraryFolder', job.userId, job.deletionTargetId);
        await deleteGraphSources(
          tx,
          job.userId,
          'FOLDER',
          ids.length > 0 ? ids : [job.deletionTargetId],
        );
        await tx.$executeRaw`
          DELETE FROM "LibraryFolder" WHERE id = ${job.deletionTargetId} AND "userId" = ${job.userId}
        `;
      }
      const transcripts = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Transcript" WHERE "userId" = ${job.userId}
        AND "folderId" = ANY(${ids}::text[])
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
    });
  });
}

async function executeTranscriptEnrichmentDeletion(job: ClaimedDeletionJob): Promise<void> {
  await withGraphLease(job.userId, async () => {
    await db.$transaction(async (tx) => {
      await assertOwnership(tx, job);
      await deleteGraphSources(tx, job.userId, 'EXTERNAL_ENRICHMENT', [job.deletionTargetId]);
      await tx.$executeRaw`
        DELETE FROM "TranscriptEnrichment"
        WHERE id = ${job.deletionTargetId} AND "userId" = ${job.userId}
      `;
    });
  });
}

async function revertDeletingSavedMedia(job: ClaimedDeletionJob): Promise<void> {
  if (job.deletionTargetType !== 'SAVED_MEDIA') return;
  const media = await db.savedMedia.findFirst({
    where: { id: job.deletionTargetId, userId: job.userId, status: 'DELETING' },
    select: { objectKey: true },
  });
  if (!media) return;
  await db.savedMedia.update({
    where: { id: job.deletionTargetId },
    data: media.objectKey
      ? { status: 'READY', errorMsg: null }
      : { status: 'FAILED', errorMsg: 'O arquivo não está disponível.' },
  });
}

async function finishJob(
  job: ClaimedDeletionJob,
  outcome: 'done' | 'failed',
  heartbeat: { isLost: () => boolean },
  errorMsg?: string,
): Promise<void> {
  if (heartbeat.isLost()) return;
  const now = new Date();
  if (outcome === 'done') {
    if (GRAPH_SOURCE_TYPE[job.deletionTargetType]) {
      await invalidateGraphCache(job.userId).catch(() => {});
    }
    await db.job.updateMany({
      where: fence(job),
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
    await publishJobEvent(job.userId, { jobId: job.id, stage: 'done', percent: 100 }).catch(
      () => {},
    );
    return;
  }
  const attempt = job.attempt + 1;
  if (attempt >= MAX_ATTEMPTS) {
    const updated = await db.job.updateMany({
      where: fence(job),
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
    if (updated.count === 1) await revertDeletingSavedMedia(job);
    return;
  }
  await db.job.updateMany({
    where: fence(job),
    data: {
      status: 'QUEUED',
      workerId: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
      attempt,
      progressStage: 'queued',
      progressPercent: 0,
      progressedAt: now,
      errorMsg: (errorMsg ?? INTERRUPTED_MESSAGE).slice(0, 2000),
    },
  });
}

async function releaseClaim(job: ClaimedDeletionJob): Promise<void> {
  const now = new Date();
  await db.job.updateMany({
    where: fence(job),
    data: {
      status: 'QUEUED',
      workerId: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
      progressStage: 'queued',
      progressPercent: 0,
      progressedAt: now,
    },
  });
}

export async function runKnowledgeDeletionJob(jobId: string): Promise<boolean> {
  const owner = `${WORKER_ID_PREFIX}:${randomUUID()}`;
  const job = await claimDeletionJob(jobId, owner);
  if (!job) return false;
  const heartbeat = startHeartbeat(job);
  try {
    await publishJobEvent(job.userId, {
      jobId: job.id,
      stage: 'deleting_content',
      percent: 15,
    }).catch(() => {});
    switch (job.deletionTargetType) {
      case 'TRANSCRIPT':
        await publishJobEvent(job.userId, {
          jobId: job.id,
          stage: 'deleting_storage',
          percent: 30,
        }).catch(() => {});
        await executeTranscriptDeletion(job);
        break;
      case 'NOTE':
        await executeNoteDeletion(job);
        break;
      case 'SAVED_MEDIA':
        await publishJobEvent(job.userId, {
          jobId: job.id,
          stage: 'deleting_storage',
          percent: 30,
        }).catch(() => {});
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
    if (GRAPH_SOURCE_TYPE[job.deletionTargetType]) {
      await publishJobEvent(job.userId, {
        jobId: job.id,
        stage: 'updating_graph',
        percent: 85,
      }).catch(() => {});
    }
    await finishJob(job, 'done', heartbeat);
    return true;
  } catch (error) {
    if (heartbeat.isLost() || error instanceof LeaseLostError) return true;
    if (error instanceof LeaseUnavailableError) {
      await releaseClaim(job);
      return true;
    }
    await finishJob(job, 'failed', heartbeat, error instanceof Error ? error.message : String(error));
    return true;
  } finally {
    heartbeat.stop();
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
