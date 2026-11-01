// ============================================================================
// Knowledge deletion executor (web) — spec 215
// ============================================================================
// Retained Product 1 maintenance that used to run in the analysis worker:
// durable, idempotent deletion of user-owned knowledge resources. Runs in the
// web process (startup drain + interval with cancellation window) so deletions
// complete and recover after restart without the worker.
//
// Mirrors apps/worker/src/knowledge_deletion.py: same ordering (advisory
// lock → graph lease → canonical transaction → storage deletes), same
// ownership checks, same retry budget (3 attempts, expired leases requeue).
// ============================================================================

import { randomUUID } from 'node:crypto';

import { db } from './db';
import { invalidateGraphCache } from './graph-cache';
import { publishJobEvent } from './job-events';
import { fence, LeaseLostError, type ClaimedDeletionJob } from './knowledge-deletion-graph';
import {
  LeaseUnavailableError,
  executeLibraryFolderDeletion,
  executeNoteDeletion,
  executeSavedMediaDeletion,
  executeTranscriptDeletion,
  executeTranscriptEnrichmentDeletion,
  revertDeletingSavedMedia,
} from './knowledge-deletion-targets';
import type { KnowledgeDeletionTargetType } from './knowledge-deletion';

const LEASE_TTL_MS = 90_000;
const HEARTBEAT_MS = 20_000;
const MAX_ATTEMPTS = 3;
const WORKER_ID_PREFIX = 'web-executor';
// Grace period before the drain picks up a fresh deletion: doubles as a
// cancellation window and keeps enqueue-only test semantics deterministic.
const DRAIN_MIN_AGE_MS = 10_000;
const INTERRUPTED_MESSAGE = 'Knowledge deletion was interrupted and will be retried.';

const GRAPH_SOURCE_TYPE: Partial<Record<KnowledgeDeletionTargetType, string>> = {
  TRANSCRIPT: 'TRANSCRIPT',
  NOTE: 'NOTE',
  LIBRARY_FOLDER: 'FOLDER',
  TRANSCRIPT_ENRICHMENT: 'EXTERNAL_ENRICHMENT',
};

async function claimDeletionJob(jobId: string, owner: string): Promise<ClaimedDeletionJob | null> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        userId: string;
        attempt: number;
        deletionTargetType: KnowledgeDeletionTargetType | null;
        deletionTargetId: string | null;
      }>
    >`
      SELECT id, "userId", attempt, "deletionTargetType", "deletionTargetId"
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
      if (row.deletionTargetType === 'SAVED_MEDIA' && row.deletionTargetId) {
        await tx.savedMedia.updateMany({
          where: { id: row.deletionTargetId, userId: row.userId, status: 'DELETING' },
          data: { status: 'FAILED', errorMsg: 'O arquivo não está disponível.' },
        });
      }
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
    const updated = await db.job.updateMany({
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
    if (updated.count !== 1) return;
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
    await finishJob(
      job,
      'failed',
      heartbeat,
      error instanceof Error ? error.message : String(error),
    );
    return true;
  } finally {
    heartbeat.stop();
  }
}

export async function drainPendingKnowledgeDeletions(limit = 10): Promise<{ processed: number }> {
  const now = new Date();
  const candidates = await db.job.findMany({
    where: {
      type: 'DELETE_KNOWLEDGE',
      OR: [
        { status: 'QUEUED', queuedAt: { lt: new Date(now.getTime() - DRAIN_MIN_AGE_MS) } },
        { status: 'RUNNING', leaseExpiresAt: { lt: now } },
      ],
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
