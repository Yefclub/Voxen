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
