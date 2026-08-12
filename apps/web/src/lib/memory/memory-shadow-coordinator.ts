import { randomUUID } from 'node:crypto';
import { db } from '../db';
import { getRedisPublisher } from '../redis';

export interface MemoryShadowRedis {
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export interface MemoryShadowCoordinationStore {
  registerWriter(userId: string, writerId: string): Promise<boolean>;
  finishWriter(writerId: string): Promise<void>;
  placeFence(userId: string, owner: string): Promise<void>;
  clearFence(userId: string, owner: string): Promise<void>;
  clearSubject(userId: string): Promise<void>;
  waitForWriters(userId: string): Promise<boolean>;
}

export interface MemoryShadowWriteOptions {
  redis?: MemoryShadowRedis;
  store?: MemoryShadowCoordinationStore;
}

export interface MemoryShadowDeletionOptions {
  redis?: MemoryShadowRedis;
  store?: MemoryShadowCoordinationStore;
}

const LOCK_TTL_MS = 120_000;
const LOCK_RENEW_MS = 30_000;
const WRITE_WAIT_MS = 5_000;
const DELETE_WAIT_MS = 45_000;
const WRITER_DRAIN_WAIT_MS = 65_000;
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

async function advisoryUserLock(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  userId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 198))`;
}

const prismaCoordinationStore: MemoryShadowCoordinationStore = {
  async registerWriter(userId, writerId) {
    return db.$transaction(async (tx) => {
      await advisoryUserLock(tx, userId);
      const [fenced, userExists] = await Promise.all([
        tx.memoryShadowFence.count({ where: { userId } }),
        tx.user.count({ where: { id: userId } }),
      ]);
      if (fenced > 0 || userExists === 0) return false;
      await tx.memoryShadowSubject.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });
      await tx.memoryShadowWriter.create({ data: { id: writerId, userId } });
      return true;
    });
  },
  async finishWriter(writerId) {
    await db.memoryShadowWriter.deleteMany({ where: { id: writerId } });
  },
  async placeFence(userId, owner) {
    await db.$transaction(async (tx) => {
      await advisoryUserLock(tx, userId);
      await tx.memoryShadowFence.upsert({
        where: { userId },
        create: { userId, owner },
        update: { owner },
      });
    });
  },
  async clearFence(userId, owner) {
    await db.memoryShadowFence.deleteMany({ where: { userId, owner } });
  },
  async clearSubject(userId) {
    await db.memoryShadowSubject.deleteMany({ where: { userId } });
  },
  async waitForWriters(userId) {
    const deadline = Date.now() + WRITER_DRAIN_WAIT_MS;
    do {
      if ((await db.memoryShadowWriter.count({ where: { userId } })) === 0) return true;
      await delay(RETRY_MS);
    } while (Date.now() < deadline);
    return false;
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

/** Runs a best-effort write registered durably before external network I/O. */
export function scheduleUserMemoryShadowWrite(
  userId: string,
  operation: () => Promise<boolean>,
  options: MemoryShadowWriteOptions = {},
): void {
  void (async () => {
    const redis = options.redis ?? redisClient();
    const store = options.store ?? prismaCoordinationStore;
    const writerId = randomUUID();
    let registered = false;
    let confirmed = false;
    let release: (() => Promise<void>) | null = null;
    try {
      release = await acquireDistributedUserLock(userId, WRITE_WAIT_MS, redis);
      if (!release) return;
      registered = await store.registerWriter(userId, writerId);
      if (!registered) return;
      confirmed = await operation();
    } catch {
      console.warn('[memory-shadow] scheduled write failed');
    } finally {
      if (registered && confirmed) {
        await store.finishWriter(writerId).catch(() => {
          console.warn('[memory-shadow] writer lease release failed');
        });
      } else if (registered) {
        console.warn('[memory-shadow] writer outcome ambiguous; durable marker retained');
      }
      await release?.().catch(() => {
        console.warn('[memory-shadow] distributed lock release failed');
      });
    }
  })();
}

/**
 * Fences new writes, drains every durably registered writer, deletes remote
 * memory, and keeps the fence through canonical account deletion.
 */
export async function acquireUserMemoryShadowDeletionFence(
  userId: string,
  deleteRemote: () => Promise<void>,
  options: MemoryShadowDeletionOptions = {},
): Promise<(canonicalDeleted: boolean) => Promise<void>> {
  const redis = options.redis ?? redisClient();
  const store = options.store ?? prismaCoordinationStore;
  const release = await acquireDistributedUserLock(userId, DELETE_WAIT_MS, redis);
  if (!release) throw new Error('Timed out waiting for the memory shadow deletion fence');
  const owner = randomUUID();
  let keepFence = false;
  try {
    await store.placeFence(userId, owner);
    if (!(await store.waitForWriters(userId))) {
      keepFence = true;
      throw new Error('Timed out draining memory shadow writers');
    }
    await deleteRemote();
    return async (canonicalDeleted) => {
      try {
        if (canonicalDeleted) await store.clearSubject(userId);
        await store.clearFence(userId, owner);
      } finally {
        await release();
      }
    };
  } catch (error) {
    if (!keepFence) await store.clearFence(userId, owner).catch(() => {});
    await release();
    throw error;
  }
}
