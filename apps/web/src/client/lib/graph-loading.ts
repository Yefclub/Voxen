import type { GraphIndexState, GraphIndexStatus } from '../../shared/graph-index';

export type GraphPollingAction = 'poll-status' | 'refresh-snapshot' | 'stop';

export function resolveGraphPollingAction(
  previousState: GraphIndexState | null,
  currentStatus: GraphIndexStatus,
  snapshotIndexing: boolean,
): GraphPollingAction {
  if (currentStatus.state === 'running') return 'poll-status';
  if (currentStatus.state === 'ready' && (previousState === 'running' || snapshotIndexing)) {
    return 'refresh-snapshot';
  }
  return 'stop';
}
