// ============================================================================
// Job events — canal Redis pub/sub `jobs:<userId>:<jobId>`
// ============================================================================
// O worker publica eventos de progresso aqui; o endpoint SSE assina.
// Também há `jobs:new` (sem userId) para notificar workers sobre novo job.
// ============================================================================

import type { Redis } from 'ioredis';
import { db } from './db';
import { getRedisPublisher } from './redis';

export type JobStage =
  | 'queued'
  | 'running'
  | 'downloading'
  | 'preparing_upload'
  | 'analyzing_image'
  | 'analyzing_x'
  | 'converting_document'
  | 'analyzing_document'
  | 'extracting_audio'
  | 'choosing_method'
  | 'transcribing'
  | 'uploading'
  | 'indexing'
  | 'summarizing'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface JobEvent {
  id: string;
  jobId: string;
  stage: JobStage;
  percent?: number;
  chunkIndex?: number;
  transcriptId?: string;
  errorMsg?: string;
  ts: string;
}

export function jobChannel(userId: string, jobId: string): string {
  return `jobs:${userId}:${jobId}`;
}

export function jobsNewChannel(): string {
  return 'jobs:new';
}

// Canal de cancelamento — worker assina e interrompe o job
export function jobCancelChannel(): string {
  return 'jobs:cancel';
}

// Canal por user (qualquer evento de seus jobs) — usado por toast global
export function userChannel(userId: string): string {
  return `user:${userId}:jobs`;
}

export async function publishUserJobEvent(
  userId: string,
  evt: Omit<JobEvent, 'id' | 'ts'>,
  pub: Redis = getRedisPublisher(),
): Promise<void> {
  const payload: JobEvent = { ...evt, id: crypto.randomUUID(), ts: new Date().toISOString() };
  await pub.publish(userChannel(userId), JSON.stringify(payload));
}

export async function requestCancel(
  jobId: string,
  pub: Redis = getRedisPublisher(),
): Promise<void> {
  await pub.publish(jobCancelChannel(), jobId);
}

export async function publishJobEvent(
  userId: string,
  evt: Omit<JobEvent, 'id' | 'ts'>,
  pub: Redis = getRedisPublisher(),
): Promise<void> {
  const stored = await db.$transaction(async (tx) => {
    const event = await tx.jobProgressEvent.create({
      data: {
        jobId: evt.jobId,
        userId,
        stage: evt.stage,
        percent: evt.percent,
        chunkIndex: evt.chunkIndex,
        transcriptId: evt.transcriptId,
        errorMsg: evt.errorMsg,
      },
    });
    const expired = await tx.jobProgressEvent.findMany({
      where: { jobId: evt.jobId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 120,
      select: { id: true },
    });
    if (expired.length > 0) {
      await tx.jobProgressEvent.deleteMany({
        where: { id: { in: expired.map((item) => item.id) } },
      });
    }
    await tx.job.updateMany({
      where: { id: evt.jobId, userId },
      data: {
        progressStage: evt.stage,
        progressPercent: evt.percent ?? null,
        progressedAt: event.createdAt,
      },
    });
    return event;
  });
  const payload: JobEvent = {
    ...evt,
    id: stored.id,
    ts: stored.createdAt.toISOString(),
  };
  // canal do job (assinado pelo detalhe do job + lista de jobs)
  await pub.publish(jobChannel(userId, evt.jobId), JSON.stringify(payload));
  // canal do user (assinado pela notif global em qualquer página)
  await pub.publish(userChannel(userId), JSON.stringify(payload));
}

export async function notifyNewJob(jobId: string, pub: Redis = getRedisPublisher()): Promise<void> {
  await pub.publish(jobsNewChannel(), jobId);
}

export function isTerminalStage(stage: JobStage): boolean {
  return stage === 'done' || stage === 'failed' || stage === 'cancelled';
}
