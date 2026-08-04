import type { GraphIndexErrorReason, GraphIndexStatus } from '../shared/graph-index';

interface GraphCoverageDetails {
  expectedSourceNodes: number;
  indexedSourceNodes: number;
  staleSourceNodes: number;
}

export class GraphIndexRunError extends Error {
  constructor(
    readonly reason: GraphIndexErrorReason,
    readonly coverage?: GraphCoverageDetails,
  ) {
    super(reason);
  }
}

export function reportGraphIndexRunFailure(userId: string, error: unknown): GraphIndexErrorReason {
  const reason = error instanceof GraphIndexRunError ? error.reason : 'failed';
  if (reason === 'coverage-incomplete') {
    process.stdout.write(
      `${JSON.stringify({
        level: 'info',
        event: 'graph-reindex-deferred',
        userId,
        ...(error instanceof GraphIndexRunError ? error.coverage : undefined),
      })}\n`,
    );
  } else {
    console.warn('[graph] background reindex failed', { userId, error });
  }
  return reason;
}

export function createGraphIndexFailureStatus(
  running: Pick<GraphIndexStatus, 'runId' | 'startedAt'>,
  reason: GraphIndexErrorReason,
  failedAt: number,
  retryDelayMs: number,
): GraphIndexStatus {
  return {
    state: 'error',
    runId: running.runId,
    startedAt: running.startedAt,
    updatedAt: new Date(failedAt).toISOString(),
    retryAfter: new Date(failedAt + retryDelayMs).toISOString(),
    reason,
    recoverable: reason === 'coverage-incomplete',
  };
}
