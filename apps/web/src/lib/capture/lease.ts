// Capture job lease, heartbeat and progress (spec 220), mirroring the
// knowledge-deletion executor: FOR UPDATE SKIP LOCKED claim, fenced updates.

import { db } from '../db';
import { publishJobEvent, type JobStage } from '../job-events';
import { CaptureError, captureErrorMessage, isCaptureErrorCode } from './errors';

export const CAPTURE_LEASE_TTL_MS = 90_000;
const HEARTBEAT_MS = 20_000;
export const CAPTURE_MAX_ATTEMPTS = 3;

export type ClaimedCaptureJob = {
  id: string;
  userId: string;
  type: 'CAPTURE_LINK' | 'CAPTURE_UPLOAD';
  sourceUrl: string;
  refreshTranscriptId: string | null;
  attempt: number;
  workerId: string;
  captureMeta: Record<string, unknown>;
};

export class LeaseLostError extends Error {
  constructor() {
    super('capture lease lost');
    this.name = 'LeaseLostError';
  }
}

export function fence(job: ClaimedCaptureJob) {
  return { id: job.id, userId: job.userId, workerId: job.workerId, status: 'RUNNING' as const };
}

export async function claimCaptureJob(
  jobId: string,
  owner: string,
  now = new Date(),
): Promise<ClaimedCaptureJob | null> {
  let exhausted: string | null = null;
  const claimed = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; attempt: number; userId: string }>>`
      SELECT id, attempt, "userId" FROM "Job"
      WHERE id = ${jobId}
        AND type IN ('CAPTURE_LINK', 'CAPTURE_UPLOAD')
        AND (
          (status = 'QUEUED' AND ("notBefore" IS NULL OR "notBefore" <= ${now}))
          OR (status = 'RUNNING' AND "leaseExpiresAt" < ${now})
        )
      FOR UPDATE SKIP LOCKED
    `;
    const row = rows[0];
    if (!row) return null;
    if (row.attempt >= CAPTURE_MAX_ATTEMPTS) {
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
          captureErrorCode: 'TIMEOUT',
          errorMsg: captureErrorMessage('TIMEOUT'),
        },
      });
      exhausted = row.userId;
      return null;
    }
    await tx.job.updateMany({
      where: { id: jobId },
      data: {
        status: 'RUNNING',
        attempt: { increment: 1 },
        workerId: owner,
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + CAPTURE_LEASE_TTL_MS),
        startedAt: now,
        finishedAt: null,
        errorMsg: null,
        captureErrorCode: null,
        notBefore: null,
        progressStage: 'running',
        progressedAt: now,
      },
    });
    const job = await tx.job.findUniqueOrThrow({
      where: { id: jobId },
      select: {
        id: true,
        userId: true,
        type: true,
        sourceUrl: true,
        refreshTranscriptId: true,
        attempt: true,
        workerId: true,
        captureMeta: true,
      },
    });
    if (job.type !== 'CAPTURE_LINK' && job.type !== 'CAPTURE_UPLOAD') return null;
    return {
      id: job.id,
      userId: job.userId,
      type: job.type,
      sourceUrl: job.sourceUrl,
      refreshTranscriptId: job.refreshTranscriptId,
      attempt: job.attempt,
      workerId: job.workerId ?? owner,
      captureMeta: (job.captureMeta ?? {}) as Record<string, unknown>,
    };
  });
  if (exhausted) {
    // Over budget: tell SSE clients the job is terminal now, not on reconnect.
    await publishJobEvent(exhausted, {
      jobId,
      stage: 'failed',
      errorMsg: captureErrorMessage('TIMEOUT'),
    }).catch(() => {});
  }
  return claimed;
}

export function startHeartbeat(job: ClaimedCaptureJob, controller: AbortController): () => void {
  const timer = setInterval(() => {
    const now = new Date();
    void db.job
      .updateMany({
        where: fence(job),
        data: { heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + CAPTURE_LEASE_TTL_MS) },
      })
      .then((updated) => {
        if (updated.count !== 1) controller.abort(new LeaseLostError());
      })
      .catch(() => {});
  }, HEARTBEAT_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

export async function ensureLease(
  job: ClaimedCaptureJob,
  controller: AbortController,
): Promise<void> {
  if (controller.signal.aborted) throw controller.signal.reason ?? new LeaseLostError();
  const still = await db.job.count({ where: fence(job) });
  if (still !== 1) {
    controller.abort(new LeaseLostError());
    throw new LeaseLostError();
  }
}

export async function progress(
  job: ClaimedCaptureJob,
  stage: JobStage,
  percent: number,
): Promise<void> {
  // Fenced: a progress write racing a cancel must not move a CANCELLED row
  // back to a running stage or emit a non-terminal event after `cancelled`.
  const live = await db.job.count({ where: fence(job) }).catch(() => 0);
  if (live !== 1) return;
  await publishJobEvent(job.userId, { jobId: job.id, stage, percent }).catch(() => {});
}

export function withTimeout(parent: AbortSignal, ms: number): AbortSignal {
  return AbortSignal.any([parent, AbortSignal.timeout(ms)]);
}

export function mapUnknownError(error: unknown, parent: AbortSignal): CaptureError {
  if (error instanceof CaptureError) return error;
  if (error instanceof LeaseLostError || parent.reason instanceof LeaseLostError)
    throw new LeaseLostError();
  const code = (error as { code?: unknown } | null)?.code;
  if (isCaptureErrorCode(code)) {
    // Keep the provider's transient flag (429 / retryable 5xx) for backoff.
    const retryable = (error as { retryable?: unknown }).retryable;
    return new CaptureError(code, code, {
      retryable: typeof retryable === 'boolean' ? retryable || undefined : undefined,
    });
  }
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return new CaptureError('TIMEOUT');
  return new CaptureError('UNKNOWN', error instanceof Error ? error.name : 'unknown');
}
