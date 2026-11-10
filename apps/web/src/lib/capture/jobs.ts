// Shared capture status and cancellation for HTTP, PWA and MCP.
import type { Prisma } from '../../../prisma-generated/client';
import { db } from '../db';
import { publishJobEvent, requestCancel } from '../job-events';
import { getAppLanguage } from '../settings';
import { describeCaptureError, isCaptureErrorCode, type CaptureLocale } from './errors';
import { ACTIVE_STATUSES, CAPTURE_TYPES } from './submit';

export const JOB_SELECT = {
  id: true,
  type: true,
  status: true,
  sourceUrl: true,
  transcriptId: true,
  refreshTranscriptId: true,
  progressStage: true,
  progressPercent: true,
  captureErrorCode: true,
  captureCostUsd: true,
  captureMeta: true,
  errorMsg: true,
  attempt: true,
  queuedAt: true,
  startedAt: true,
  finishedAt: true,
  notBefore: true,
  transcript: { select: { id: true, title: true, transcriptionMethod: true, model: true } },
} satisfies Prisma.JobSelect;

type JobRow = Prisma.JobGetPayload<{ select: typeof JOB_SELECT }>;

export async function locale(): Promise<CaptureLocale> {
  return (await getAppLanguage()) === 'en' ? 'en' : 'pt-BR';
}

export function serializeJob(job: JobRow, lang: CaptureLocale) {
  const meta = (job.captureMeta ?? {}) as Record<string, unknown>;
  const upload = meta.upload as { filename?: string } | undefined;
  return {
    id: job.id,
    kind: job.type === 'CAPTURE_UPLOAD' ? 'upload' : 'link',
    status: job.status,
    sourceUrl: job.type === 'CAPTURE_UPLOAD' ? null : job.sourceUrl,
    filename: upload?.filename ?? null,
    platform: typeof meta.platform === 'string' ? meta.platform : null,
    warnings: Array.isArray(meta.warnings)
      ? meta.warnings.filter((code): code is string => typeof code === 'string').slice(0, 10)
      : [],
    stage: job.progressStage,
    percent: job.progressPercent,
    attempt: job.attempt,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    retryAt: job.status === 'QUEUED' ? job.notBefore : null,
    costUsd: job.captureCostUsd === null ? null : Number(job.captureCostUsd),
    reprocessOf: job.refreshTranscriptId,
    transcript: job.transcript
      ? {
          id: job.transcript.id,
          title: job.transcript.title,
          method: job.transcript.transcriptionMethod,
          model: job.transcript.model,
        }
      : job.refreshTranscriptId &&
          (job.status === 'DONE' || job.status === 'COMPLETED_WITH_WARNINGS')
        ? { id: job.refreshTranscriptId, title: null, method: null, model: null }
        : null,
    error:
      job.captureErrorCode && isCaptureErrorCode(job.captureErrorCode)
        ? describeCaptureError(job.captureErrorCode, lang)
        : null,
  };
}

export async function readJob(userId: string, id: string): Promise<JobRow | null> {
  return db.job.findFirst({
    where: { id, userId, type: { in: [...CAPTURE_TYPES] } },
    select: JOB_SELECT,
  });
}

export async function cancelCapture(userId: string, id: string, lang: CaptureLocale) {
  const now = new Date();
  const updated = await db.job.updateMany({
    where: { id, userId, type: { in: [...CAPTURE_TYPES] }, status: { in: [...ACTIVE_STATUSES] } },
    data: {
      status: 'CANCELLED',
      captureErrorCode: 'CANCELLED',
      errorMsg: describeCaptureError('CANCELLED', lang).message,
      finishedAt: now,
      workerId: null,
      leaseExpiresAt: null,
      progressStage: 'cancelled',
      progressedAt: now,
    },
  });
  if (updated.count > 0) {
    // The database state is authoritative; notifications are best-effort.
    await publishJobEvent(userId, { jobId: id, stage: 'cancelled' }).catch(() => {});
    await requestCancel(id).catch(() => {});
  }
  return { job: await readJob(userId, id), alreadyFinished: updated.count === 0 };
}
