import { randomUUID } from 'node:crypto';
import { db } from '../db';
import { getRedisPublisher } from '../redis';

export interface MemoryShadowRedis {
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export interface MemoryShadowFenceStore {
  exists(userId: string): Promise<boolean>;
  place(userId: string, owner: string): Promise<void>;
  clear(userId: string, owner: string): Promise<void>;
}

export interface MemoryShadowUserStore {
  exists(userId: string): Promise<boolean>;
}

export interface MemoryShadowWriteOptions {
  redis?: MemoryShadowRedis;
  fenceStore?: MemoryShadowFenceStore;
  userStore?: MemoryShadowUserStore;
  compensate?: () => Promise<void>;
}

export interface MemoryShadowDeletionOptions {
  redis?: MemoryShadowRedis;
  fenceStore?: MemoryShadowFenceStore;
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

const prismaFenceStore: MemoryShadowFenceStore = {
  async exists(userId) {
    return (await db.memoryShadowFence.count({ where: { userId } })) > 0;
  },
  async place(userId, owner) {
    await db.memoryShadowFence.upsert({
      where: { userId },
      create: { userId, owner },
      update: { owner },
    });
  },
  async clear(userId, owner) {
    await db.memoryShadowFence.deleteMany({ where: { userId, owner } });
  },
};

const prismaUserStore: MemoryShadowUserStore = {
  async exists(userId) {
    return (await db.user.count({ where: { id: userId } })) > 0;
  },
};

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
  options: MemoryShadowWriteOptions = {},
): void {
  void (async () => {
    const redis = options.redis ?? redisClient();
    const fenceStore = options.fenceStore ?? prismaFenceStore;
    const userStore = options.userStore ?? prismaUserStore;
    let release: (() => Promise<void>) | null = null;
    try {
      release = await acquireDistributedUserLock(userId, WRITE_WAIT_MS, redis);
      if (!release) return;
      if (await fenceStore.exists(userId)) return;
      await operation();
      // A Redis lease may be lost while the remote write is running. Recheck
      // durable state afterwards and remove the late write if deletion started
      // or the canonical user disappeared in the meantime.
      if ((await fenceStore.exists(userId)) || !(await userStore.exists(userId))) {
        await options.compensate?.();
      }
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
  options: MemoryShadowDeletionOptions = {},
): Promise<(canonicalDeleted: boolean) => Promise<void>> {
  const redis = options.redis ?? redisClient();
  const fenceStore = options.fenceStore ?? prismaFenceStore;
  const release = await acquireDistributedUserLock(userId, DELETE_WAIT_MS, redis);
  if (!release) throw new Error('Timed out waiting for the memory shadow deletion fence');
  const owner = randomUUID();
  try {
    await fenceStore.place(userId, owner);
    await deleteRemote();
    return async (canonicalDeleted) => {
      if (!canonicalDeleted) await fenceStore.clear(userId, owner);
      await release();
    };
  } catch (error) {
    await fenceStore.clear(userId, owner).catch(() => {});
    await release();
    throw error;
  }
}
