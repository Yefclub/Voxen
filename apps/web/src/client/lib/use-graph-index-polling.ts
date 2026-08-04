import { useEffect, useRef } from 'react';
import type { GraphIndexStatus } from '../../shared/graph-index';
import {
  GRAPH_STATUS_POLL_INTERVAL_MS,
  graphStatusPollDelay,
  isGraphDeferredRetryDue,
  resolveGraphPollingAction,
} from './graph-loading';

interface GraphIndexPollingOptions {
  indexStatus: GraphIndexStatus | null;
  snapshotIndexing: boolean;
  statusError: string | null;
  refreshIndexStatus: () => void;
  refreshSnapshot: () => void;
}

export function useGraphIndexPolling({
  indexStatus,
  snapshotIndexing,
  statusError,
  refreshIndexStatus,
  refreshSnapshot,
}: GraphIndexPollingOptions): void {
  const previousStatus = useRef<GraphIndexStatus | null>(null);
  const deferredPolls = useRef({ signature: '', count: 0 });

  useEffect(() => {
    if (!indexStatus) {
      const timer = window.setTimeout(refreshIndexStatus, GRAPH_STATUS_POLL_INTERVAL_MS);
      return () => window.clearTimeout(timer);
    }
    const action = resolveGraphPollingAction(previousStatus.current, indexStatus, snapshotIndexing);
    previousStatus.current = indexStatus;
    if (action === 'refresh-snapshot') {
      deferredPolls.current = { signature: '', count: 0 };
      refreshSnapshot();
      return;
    }
    if (action !== 'poll-status') {
      deferredPolls.current = { signature: '', count: 0 };
      return;
    }

    const signature = `${indexStatus.runId ?? ''}:${indexStatus.updatedAt}:${indexStatus.retryAfter ?? ''}`;
    if (deferredPolls.current.signature !== signature) {
      deferredPolls.current = { signature, count: 0 };
    }
    const delay = graphStatusPollDelay(indexStatus, deferredPolls.current.count);
    if (delay === null) return;
    if (isGraphDeferredRetryDue(indexStatus)) {
      deferredPolls.current.count += 1;
    }
    const timer = window.setTimeout(refreshIndexStatus, delay);
    return () => window.clearTimeout(timer);
  }, [indexStatus, refreshIndexStatus, refreshSnapshot, snapshotIndexing, statusError]);
}
