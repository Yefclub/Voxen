import type { JobProgressEvent, JobType } from './types';

export interface JobProgressSnapshot {
  jobId: string;
  type?: JobType;
  stage: string;
  percent?: number;
  transcriptId?: string | null;
  errorMsg?: string | null;
  ts: string;
  events: JobProgressEvent[];
}

export function isJobProgressSnapshot(value: unknown): value is JobProgressSnapshot {
  return Boolean(
    value &&
    typeof value === 'object' &&
    Array.isArray((value as { events?: unknown }).events) &&
    typeof (value as { jobId?: unknown }).jobId === 'string',
  );
}

export function jobProgressEventKey(event: Pick<JobProgressEvent, 'id' | 'stage' | 'ts'>): string {
  return event.id || `${event.stage}:${event.ts}`;
}

/** Mescla SSE, snapshot e polling sem duplicar nem remontar a timeline. */
export function mergeJobProgressEvents(
  previous: readonly JobProgressEvent[],
  incoming: readonly JobProgressEvent[],
): JobProgressEvent[] {
  const byKey = new Map(previous.map((event) => [jobProgressEventKey(event), event]));
  let changed = false;
  for (const event of incoming) {
    const key = jobProgressEventKey(event);
    if (!byKey.has(key)) {
      byKey.set(key, event);
      changed = true;
    }
  }
  if (!changed) return previous as JobProgressEvent[];
  return [...byKey.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}

export function jobElapsedMs(
  queuedAt: string | Date,
  finishedAt: string | Date | null | undefined,
  now: number = Date.now(),
): number {
  const start = new Date(queuedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, end - start);
}

export function formatJobElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function jobProgressEventDurationMs(
  events: readonly Pick<JobProgressEvent, 'ts'>[],
  index: number,
  finishedAt: string | Date | null | undefined,
  now: number = Date.now(),
): number {
  const start = new Date(events[index]?.ts ?? '').getTime();
  const next = events[index + 1]?.ts;
  const end = next ? new Date(next).getTime() : finishedAt ? new Date(finishedAt).getTime() : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, end - start);
}
