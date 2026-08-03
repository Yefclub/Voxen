import type { JobSummary } from './types';

function semanticEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => semanticEqual(value, right[index]))
    );
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(rightRecord, key) &&
        semanticEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

/**
 * Reusa objetos e o próprio array quando um snapshot não trouxe mudança
 * semântica. Isso mantém os JobRows memoizados, foco e estado local durante
 * polling/SSE de reconciliação.
 */
export function reconcileJobSummaries(
  current: readonly JobSummary[],
  incoming: readonly JobSummary[],
): JobSummary[] {
  const previousById = new Map(current.map((job) => [job.id, job]));
  const reconciled = incoming.map((job) => {
    const previous = previousById.get(job.id);
    return previous && semanticEqual(previous, job) ? previous : job;
  });

  if (
    reconciled.length === current.length &&
    reconciled.every((job, index) => job === current[index])
  ) {
    return current as JobSummary[];
  }
  return reconciled;
}

/**
 * Mantém o conjunto de streams ativos que perderam a conexão. Preserva a
 * referência quando o estado solicitado já está aplicado, evitando renders
 * do container por eventos repetidos do EventSource.
 */
export function reconcileClosedJobStreams(
  current: ReadonlySet<string>,
  jobId: string,
  closed: boolean,
): ReadonlySet<string> {
  if (current.has(jobId) === closed) return current;
  const next = new Set(current);
  if (closed) next.add(jobId);
  else next.delete(jobId);
  return next;
}

export function createDeferredJobRefresh(
  delayMs = 400,
  scheduleTimer: (callback: () => void, delay: number) => number = (callback, delay) =>
    window.setTimeout(callback, delay),
  cancelTimer: (timerId: number) => void = (timerId) => window.clearTimeout(timerId),
): { schedule: (refresh: () => void) => void; cancel: () => void } {
  let timerId: number | null = null;

  return {
    schedule(refresh): void {
      if (timerId !== null) return;
      timerId = scheduleTimer(() => {
        timerId = null;
        refresh();
      }, delayMs);
    },
    cancel(): void {
      if (timerId === null) return;
      cancelTimer(timerId);
      timerId = null;
    },
  };
}
