// ============================================================================
// Job events — canal Redis pub/sub `jobs:<userId>:<jobId>`
// ============================================================================
// O worker publica eventos de progresso aqui; o endpoint SSE assina.
// Também há `jobs:new` (sem userId) para notificar workers sobre novo job.
// ============================================================================

import type { Redis } from 'ioredis';
import { getRedisPublisher } from './redis';

export type JobStage =
  | 'queued'
  | 'running'
  | 'downloading'
  | 'extracting_audio'
  | 'choosing_method'
  | 'transcribing'
  | 'uploading'
  | 'indexing'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface JobEvent {
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

export async function publishJobEvent(
  userId: string,
  evt: Omit<JobEvent, 'ts'>,
  pub: Redis = getRedisPublisher(),
): Promise<void> {
  const payload: JobEvent = { ...evt, ts: new Date().toISOString() };
  await pub.publish(jobChannel(userId, evt.jobId), JSON.stringify(payload));
}

export async function notifyNewJob(jobId: string, pub: Redis = getRedisPublisher()): Promise<void> {
  await pub.publish(jobsNewChannel(), jobId);
}

export function isTerminalStage(stage: JobStage): boolean {
  return stage === 'done' || stage === 'failed' || stage === 'cancelled';
}
