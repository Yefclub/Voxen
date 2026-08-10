export type GraphIndexState = 'idle' | 'running' | 'ready' | 'error';

export type GraphIndexErrorReason =
  | 'coverage-incomplete'
  | 'failed'
  | 'lease-lost'
  | 'redis-unavailable';

export interface GraphSourceCoverage {
  expected: number;
  indexed: number;
  stale: number;
}

export interface GraphSemanticCoverage {
  total: number;
  pending: number;
  running: number;
  retrying: number;
  completed: number;
  failed: number;
  skipped: number;
}

export interface GraphIndexCoverage {
  source: GraphSourceCoverage;
  semantic: GraphSemanticCoverage;
}

export function graphIndexCoverage(coverage: {
  expectedSourceNodes: number;
  indexedSourceNodes: number;
  staleSourceNodes: number;
  semantic: GraphSemanticCoverage;
}): GraphIndexCoverage {
  return {
    source: {
      expected: coverage.expectedSourceNodes,
      indexed: coverage.indexedSourceNodes,
      stale: coverage.staleSourceNodes,
    },
    semantic: coverage.semantic,
  };
}

export interface GraphIndexStatus {
  state: GraphIndexState;
  runId?: string;
  startedAt?: string;
  updatedAt: string;
  retryAfter?: string;
  reason?: GraphIndexErrorReason;
  recoverable?: boolean;
  /** Fresh database coverage; never persisted as authoritative Redis state. */
  coverage?: GraphIndexCoverage;
}
