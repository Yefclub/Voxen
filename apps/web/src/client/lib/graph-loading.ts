import type { GraphIndexState, GraphIndexStatus } from '../../shared/graph-index';

export type GraphPollingAction = 'poll-status' | 'refresh-snapshot' | 'stop';
export type GraphIndexVisualState = 'indexing' | 'deferred' | 'failed' | 'ready';

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

export function resolveGraphPollingAction(
  previousState: GraphIndexState | null,
  currentStatus: GraphIndexStatus,
  snapshotIndexing: boolean,
): GraphPollingAction {
  if (currentStatus.state === 'running') return 'poll-status';
  if (isGraphIndexDeferred(currentStatus)) return 'poll-status';
  if (currentStatus.state === 'ready' && (previousState === 'running' || snapshotIndexing)) {
    return 'refresh-snapshot';
  }
  return 'stop';
}
