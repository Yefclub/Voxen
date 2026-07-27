export type GraphIndexState = 'idle' | 'running' | 'ready' | 'error';

export type GraphIndexErrorReason =
  | 'coverage-incomplete'
  | 'failed'
  | 'lease-lost'
  | 'redis-unavailable';

export interface GraphIndexStatus {
  state: GraphIndexState;
  runId?: string;
  startedAt?: string;
  updatedAt: string;
  retryAfter?: string;
  reason?: GraphIndexErrorReason;
  recoverable?: boolean;
}
