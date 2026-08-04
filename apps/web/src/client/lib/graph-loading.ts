import type { GraphIndexStatus } from '../../shared/graph-index';

export type GraphPollingAction = 'poll-status' | 'refresh-snapshot' | 'stop';
export type GraphIndexVisualState = 'indexing' | 'deferred' | 'failed' | 'ready';

export const GRAPH_STATUS_POLL_INTERVAL_MS = 2_500;
export const GRAPH_DEFERRED_POLL_INTERVAL_MS = 30_000;
export const GRAPH_DEFERRED_MAX_POLLS = 2;

export function graphIndexState(
  indexing: boolean,
  deferred: boolean,
  failed: boolean,
  ready: boolean,
): GraphIndexVisualState | null {
  if (indexing) return 'indexing';
  if (deferred) return 'deferred';
  if (failed) return 'failed';
  return ready ? 'ready' : null;
}

export function isGraphIndexDeferred(status: GraphIndexStatus | null | undefined): boolean {
  return (
    status?.state === 'error' &&
    status.reason === 'coverage-incomplete' &&
    status.recoverable === true
  );
}

export function isGraphDeferredRetryDue(status: GraphIndexStatus, now = Date.now()): boolean {
  if (!isGraphIndexDeferred(status)) return false;
  const retryAt = status.retryAfter ? Date.parse(status.retryAfter) : Number.NaN;
  return !Number.isFinite(retryAt) || retryAt <= now;
}

export function resolveGraphPollingAction(
  previousStatus: GraphIndexStatus | null,
  currentStatus: GraphIndexStatus,
  snapshotIndexing: boolean,
): GraphPollingAction {
  if (currentStatus.state === 'running') return 'poll-status';
  if (isGraphIndexDeferred(currentStatus)) return 'poll-status';
  if (
    currentStatus.state === 'ready' &&
    (previousStatus?.state === 'running' ||
      isGraphIndexDeferred(previousStatus) ||
      snapshotIndexing)
  ) {
    return 'refresh-snapshot';
  }
  return 'stop';
}

export function graphStatusPollDelay(
  status: GraphIndexStatus,
  deferredPolls: number,
  now = Date.now(),
): number | null {
  if (status.state === 'running') return GRAPH_STATUS_POLL_INTERVAL_MS;
  if (!isGraphIndexDeferred(status)) return null;

  const retryAt = status.retryAfter ? Date.parse(status.retryAfter) : Number.NaN;
  if (!isGraphDeferredRetryDue(status, now)) {
    return Math.max(GRAPH_STATUS_POLL_INTERVAL_MS, retryAt - now);
  }
  return deferredPolls < GRAPH_DEFERRED_MAX_POLLS ? GRAPH_DEFERRED_POLL_INTERVAL_MS : null;
}
