import type { GraphIndexStatus } from '../shared/graph-index';
import { getRedisPublisher } from './redis';

export interface GraphIndexRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export const GRAPH_INDEX_LEASE_TTL_MS = 120_000;
export const GRAPH_INDEX_HEARTBEAT_MS = 30_000;
export const GRAPH_INDEX_ERROR_COOLDOWN_MS = 5 * 60_000;

const RUNNING_STATUS_TTL_SEC = 60 * 60;
const READY_STATUS_TTL_SEC = 5 * 60;
const ERROR_STATUS_TTL_SEC = 10 * 60;

const RENEW_LEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_LEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

const WRITE_OWNED_STATUS_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  redis.call('set', KEYS[2], ARGV[2], 'EX', ARGV[3])
  return 1
end
return 0
`;

const WRITE_STATUS_WITHOUT_LEASE_SCRIPT = `
if redis.call('exists', KEYS[1]) == 0 then
  redis.call('set', KEYS[2], ARGV[1], 'EX', ARGV[2])
  return 1
end
return 0
`;

function redisClient(): GraphIndexRedis {
  return getRedisPublisher() as unknown as GraphIndexRedis;
}

export function graphIndexLeaseKey(userId: string): string {
  return `voxen:graph:index:v1:lease:${userId}`;
}

export function graphIndexStatusKey(userId: string): string {
  return `voxen:graph:index:v1:status:${userId}`;
}

export async function acquireGraphIndexLease(
  userId: string,
  runId: string,
  redis: GraphIndexRedis = redisClient(),
): Promise<boolean> {
  const result = await redis.set(
    graphIndexLeaseKey(userId),
    runId,
    'PX',
    GRAPH_INDEX_LEASE_TTL_MS,
    'NX',
  );
  return result === 'OK';
}

export async function renewGraphIndexLease(
  userId: string,
  runId: string,
  redis: GraphIndexRedis = redisClient(),
): Promise<boolean> {
  const result = await redis.eval(
    RENEW_LEASE_SCRIPT,
    1,
    graphIndexLeaseKey(userId),
    runId,
    GRAPH_INDEX_LEASE_TTL_MS,
  );
  return Number(result) === 1;
}

export async function releaseGraphIndexLease(
  userId: string,
  runId: string,
  redis: GraphIndexRedis = redisClient(),
): Promise<boolean> {
  const result = await redis.eval(RELEASE_LEASE_SCRIPT, 1, graphIndexLeaseKey(userId), runId);
  return Number(result) === 1;
}

export async function writeGraphIndexStatus(
  userId: string,
  status: GraphIndexStatus,
  redis: GraphIndexRedis = redisClient(),
): Promise<void> {
  await redis.set(
    graphIndexStatusKey(userId),
    JSON.stringify(status),
    'EX',
    graphIndexStatusTtl(status),
  );
}

export async function writeOwnedGraphIndexStatus(
  userId: string,
  runId: string,
  status: GraphIndexStatus,
  redis: GraphIndexRedis = redisClient(),
): Promise<boolean> {
  const result = await redis.eval(
    WRITE_OWNED_STATUS_SCRIPT,
    2,
    graphIndexLeaseKey(userId),
    graphIndexStatusKey(userId),
    runId,
    JSON.stringify(status),
    graphIndexStatusTtl(status),
  );
  return Number(result) === 1;
}

export async function writeGraphIndexStatusWithoutLease(
  userId: string,
  status: GraphIndexStatus,
  redis: GraphIndexRedis = redisClient(),
): Promise<boolean> {
  const result = await redis.eval(
    WRITE_STATUS_WITHOUT_LEASE_SCRIPT,
    2,
    graphIndexLeaseKey(userId),
    graphIndexStatusKey(userId),
    JSON.stringify(status),
    graphIndexStatusTtl(status),
  );
  return Number(result) === 1;
}

export async function readGraphIndexStatus(
  userId: string,
  redis: GraphIndexRedis = redisClient(),
): Promise<GraphIndexStatus> {
  const [serializedStatus, leaseOwner] = await Promise.all([
    redis.get(graphIndexStatusKey(userId)),
    redis.get(graphIndexLeaseKey(userId)),
  ]);
  const now = new Date().toISOString();
  let status: GraphIndexStatus | null = null;
  if (serializedStatus) {
    try {
      const parsed = JSON.parse(serializedStatus) as GraphIndexStatus;
      if (
        parsed &&
        (parsed.state === 'idle' ||
          parsed.state === 'running' ||
          parsed.state === 'ready' ||
          parsed.state === 'error')
      ) {
        status = parsed;
      }
    } catch {
      // A corrupt status is treated as absent and rebuilt from the lease.
    }
  }
  if (leaseOwner) {
    if (status?.state === 'running' && status.runId === leaseOwner) return status;
    return {
      state: 'running',
      runId: leaseOwner,
      startedAt: status?.runId === leaseOwner ? status.startedAt : undefined,
      updatedAt: now,
    };
  }
  if (status?.state === 'running') {
    return { ...status, state: 'idle', updatedAt: now, recoverable: true };
  }
  return status ?? { state: 'idle', updatedAt: now };
}

export function shouldStartGraphIndex(
  status: GraphIndexStatus,
  force: boolean,
  now = Date.now(),
): boolean {
  if (status.state === 'running') return false;
  if (force) return true;
  if (status.state !== 'error') return true;
  return !status.retryAfter || Date.parse(status.retryAfter) <= now;
}

export function reconcileGraphIndexStatus(
  remoteStatus: GraphIndexStatus,
  localStatus: GraphIndexStatus | undefined,
  localInFlight: boolean,
): GraphIndexStatus {
  if (remoteStatus.state === 'running') return remoteStatus;
  if (localInFlight && localStatus?.state === 'running') return localStatus;
  if (
    localStatus &&
    (localStatus.state === 'ready' || localStatus.state === 'error') &&
    (remoteStatus.state === 'idle' ||
      Date.parse(localStatus.updatedAt) > Date.parse(remoteStatus.updatedAt))
  ) {
    return localStatus;
  }
  return remoteStatus;
}

function graphIndexStatusTtl(status: GraphIndexStatus): number {
  return status.state === 'running'
    ? RUNNING_STATUS_TTL_SEC
    : status.state === 'error'
      ? ERROR_STATUS_TTL_SEC
      : READY_STATUS_TTL_SEC;
}
