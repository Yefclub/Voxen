import { randomUUID } from 'node:crypto';
import { getRedisPublisher } from '../redis';

export interface MemoryShadowRedis {
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

const LOCK_TTL_MS = 120_000;
const LOCK_RENEW_MS = 30_000;
const WRITE_WAIT_MS = 5_000;
const DELETE_WAIT_MS = 45_000;
const RETRY_MS = 50;

const RELEASE_LOCK_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

const RENEW_LOCK_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
`;

function redisClient(): MemoryShadowRedis {
  return getRedisPublisher() as unknown as MemoryShadowRedis;
}

function lockKey(userId: string): string {
  return `voxen:memory:shadow:v1:lock:${userId}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireDistributedUserLock(
  userId: string,
  waitMs: number,
  redis: MemoryShadowRedis,
): Promise<(() => Promise<void>) | null> {
  const key = lockKey(userId);
  const owner = randomUUID();
  const deadline = Date.now() + waitMs;
  do {
    const result = await redis.set(key, owner, 'PX', LOCK_TTL_MS, 'NX');
    if (result === 'OK') {
      const heartbeat = setInterval(() => {
        void redis.eval(RENEW_LOCK_SCRIPT, 1, key, owner, LOCK_TTL_MS).catch(() => {
          console.warn('[memory-shadow] distributed lock renewal failed');
        });
      }, LOCK_RENEW_MS);
      heartbeat.unref?.();
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        clearInterval(heartbeat);
        await redis.eval(RELEASE_LOCK_SCRIPT, 1, key, owner);
      };
    }
    await delay(RETRY_MS);
  } while (Date.now() < deadline);
  return null;
}

/**
 * Runs a best-effort write under the same distributed per-user mutex used by
 * account deletion. A write waiting behind a deletion rechecks canonical rows
 * only after the account has been removed, so it cannot recreate remote data.
 */
export function scheduleUserMemoryShadowWrite(
  userId: string,
  operation: () => Promise<void>,
  redis: MemoryShadowRedis = redisClient(),
): void {
  void (async () => {
    let release: (() => Promise<void>) | null = null;
    try {
      release = await acquireDistributedUserLock(userId, WRITE_WAIT_MS, redis);
      if (!release) return;
      await operation();
    } catch {
      console.warn('[memory-shadow] scheduled write failed');
    } finally {
      await release?.().catch(() => {
        console.warn('[memory-shadow] distributed lock release failed');
      });
    }
  })();
}

/**
 * Acquires the distributed user mutex, deletes remote memory, and returns a
 * release function that the caller holds through canonical account deletion.
 */
export async function acquireUserMemoryShadowDeletionFence(
  userId: string,
  deleteRemote: () => Promise<void>,
  redis: MemoryShadowRedis = redisClient(),
): Promise<() => Promise<void>> {
  const release = await acquireDistributedUserLock(userId, DELETE_WAIT_MS, redis);
  if (!release) throw new Error('Timed out waiting for the memory shadow deletion fence');
  try {
    await deleteRemote();
    return release;
  } catch (error) {
    await release();
    throw error;
  }
}
