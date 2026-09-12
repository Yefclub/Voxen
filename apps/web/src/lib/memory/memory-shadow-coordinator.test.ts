import { describe, expect, it } from 'bun:test';
import {
  acquireUserMemoryShadowDeletionFence,
  scheduleUserMemoryShadowWrite,
  type MemoryShadowCoordinationStore,
  type MemoryShadowRedis,
} from './memory-shadow-coordinator';

class FakeRedis implements MemoryShadowRedis {
  private readonly values = new Map<string, string>();

  async set(key: string, value: string): Promise<unknown> {
    if (this.values.has(key)) return null;
    this.values.set(key, value);
    return 'OK';
  }

  async eval(script: string, _count: number, key: string, owner: string): Promise<unknown> {
    if (this.values.get(key) !== owner) return 0;
    if (script.includes("redis.call('del'")) this.values.delete(key);
    return 1;
  }
}

class FakeStore implements MemoryShadowCoordinationStore {
  readonly users = new Set<string>();
  readonly fences = new Map<string, string>();
  readonly writers = new Map<string, string>();
  readonly subjects = new Set<string>();

  constructor(...users: string[]) {
    users.forEach((userId) => this.users.add(userId));
  }

  async registerWriter(userId: string, writerId: string): Promise<boolean> {
    if (!this.users.has(userId) || this.fences.has(userId)) return false;
    this.subjects.add(userId);
    this.writers.set(writerId, userId);
    return true;
  }

  async finishWriter(writerId: string): Promise<void> {
    this.writers.delete(writerId);
  }

  async placeFence(userId: string, owner: string): Promise<void> {
    this.fences.set(userId, owner);
  }

  async clearFence(userId: string, owner: string): Promise<void> {
    if (this.fences.get(userId) === owner) this.fences.delete(userId);
  }

  async clearSubject(userId: string): Promise<void> {
    this.subjects.delete(userId);
  }

  async waitForWriters(userId: string): Promise<boolean> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (![...this.writers.values()].includes(userId)) return true;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    return false;
  }
}

async function eventually(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }
  assertion();
}

describe('memory shadow durable deletion coordination', () => {
  it('drains a registered writer before remote and canonical deletion', async () => {
    const writerRedis = new FakeRedis();
    const deletionRedis = new FakeRedis();
    const store = new FakeStore('user-a');
    const events: string[] = [];
    let finishWrite = () => {};
    const writeCanFinish = new Promise<void>((resolve) => (finishWrite = resolve));

    scheduleUserMemoryShadowWrite(
      'user-a',
      async () => {
        events.push('write-started');
        await writeCanFinish;
        events.push('write-finished');
        return true;
      },
      { redis: writerRedis, store },
    );
    await eventually(() => expect(events).toEqual(['write-started']));

    const deletion = acquireUserMemoryShadowDeletionFence(
      'user-a',
      async () => {
        events.push('remote-deleted');
      },
      { redis: deletionRedis, store },
    );
    await eventually(() => expect(store.fences.has('user-a')).toBe(true));
    expect(events).toEqual(['write-started']);
    finishWrite();
    const finishDeletion = await deletion;
    expect(events).toEqual(['write-started', 'write-finished', 'remote-deleted']);

    store.users.delete('user-a');
    await finishDeletion(true);
    expect(store.fences.has('user-a')).toBe(false);
    expect(store.subjects.has('user-a')).toBe(false);
  });

  it('blocks late writers even when the Redis lease is lost', async () => {
    const store = new FakeStore('user-a');
    const finishDeletion = await acquireUserMemoryShadowDeletionFence('user-a', async () => {}, {
      redis: new FakeRedis(),
      store,
    });
    const events: string[] = [];
    scheduleUserMemoryShadowWrite(
      'user-a',
      async () => {
        events.push('unsafe-write');
        return true;
      },
      { redis: new FakeRedis(), store },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events).toEqual([]);
    await finishDeletion(false);
  });

  it('clears the durable fence when remote deletion fails', async () => {
    const store = new FakeStore('user-a');
    await expect(
      acquireUserMemoryShadowDeletionFence(
        'user-a',
        async () => {
          throw new Error('remote unavailable');
        },
        { redis: new FakeRedis(), store },
      ),
    ).rejects.toThrow('remote unavailable');
    expect(store.fences.has('user-a')).toBe(false);
  });

  it('retains an ambiguous writer and its deletion fence without expiring either', async () => {
    const store = new FakeStore('user-a');
    scheduleUserMemoryShadowWrite('user-a', async () => false, {
      redis: new FakeRedis(),
      store,
    });
    await eventually(() => expect(store.writers.size).toBe(1));

    await expect(
      acquireUserMemoryShadowDeletionFence('user-a', async () => {}, {
        redis: new FakeRedis(),
        store,
      }),
    ).rejects.toThrow('Timed out draining memory shadow writers');
    expect(store.writers.size).toBe(1);
    expect(store.fences.has('user-a')).toBe(true);
    expect(store.subjects.has('user-a')).toBe(true);
  });
});
