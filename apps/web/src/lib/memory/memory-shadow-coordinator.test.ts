import { describe, expect, it } from 'bun:test';
import {
  acquireUserMemoryShadowDeletionFence,
  scheduleUserMemoryShadowWrite,
  type MemoryShadowFenceStore,
  type MemoryShadowRedis,
  type MemoryShadowUserStore,
} from './memory-shadow-coordinator';

class FakeRedis implements MemoryShadowRedis {
  private readonly values = new Map<string, string>();

  async set(key: string, value: string): Promise<unknown> {
    if (this.values.has(key)) return null;
    this.values.set(key, value);
    return 'OK';
  }

  async eval(script: string, _numberOfKeys: number, key: string, owner: string): Promise<unknown> {
    if (this.values.get(key) !== owner) return 0;
    if (script.includes("redis.call('del'")) this.values.delete(key);
    return 1;
  }
}

class FakeFenceStore implements MemoryShadowFenceStore {
  private readonly owners = new Map<string, string>();

  async exists(userId: string): Promise<boolean> {
    return this.owners.has(userId);
  }

  async place(userId: string, owner: string): Promise<void> {
    this.owners.set(userId, owner);
  }

  async clear(userId: string, owner: string): Promise<void> {
    if (this.owners.get(userId) === owner) this.owners.delete(userId);
  }
}

class FakeUserStore implements MemoryShadowUserStore {
  readonly users = new Set<string>();

  constructor(...userIds: string[]) {
    userIds.forEach((userId) => this.users.add(userId));
  }

  async exists(userId: string): Promise<boolean> {
    return this.users.has(userId);
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

describe('memory shadow distributed deletion coordination', () => {
  it('serializes a prior write, deletion, and a late cross-replica write', async () => {
    const redis = new FakeRedis();
    const fences = new FakeFenceStore();
    const users = new FakeUserStore('race-user');
    const events: string[] = [];
    let finishFirstWrite = () => {};
    const firstWriteCanFinish = new Promise<void>((resolve) => {
      finishFirstWrite = resolve;
    });
    scheduleUserMemoryShadowWrite(
      'race-user',
      async () => {
        events.push('write-1-started');
        await firstWriteCanFinish;
        events.push('write-1-finished');
      },
      { redis, fenceStore: fences, userStore: users },
    );
    await eventually(() => expect(events).toEqual(['write-1-started']));

    const deletion = acquireUserMemoryShadowDeletionFence(
      'race-user',
      async () => {
        events.push('remote-deleted');
      },
      { redis, fenceStore: fences },
    );
    finishFirstWrite();
    const releaseDeletion = await deletion;
    expect(events).toEqual(['write-1-started', 'write-1-finished', 'remote-deleted']);

    scheduleUserMemoryShadowWrite(
      'race-user',
      async () => {
        events.push('write-2');
      },
      { redis, fenceStore: fences, userStore: users },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events).not.toContain('write-2');
    await releaseDeletion(false);
    await eventually(() => expect(events).toContain('write-2'));
  });

  it('releases the distributed fence when remote deletion fails', async () => {
    const redis = new FakeRedis();
    const fences = new FakeFenceStore();
    const users = new FakeUserStore('failed-delete-user');
    await expect(
      acquireUserMemoryShadowDeletionFence(
        'failed-delete-user',
        async () => {
          throw new Error('remote unavailable');
        },
        { redis, fenceStore: fences },
      ),
    ).rejects.toThrow('remote unavailable');
    const events: string[] = [];
    scheduleUserMemoryShadowWrite(
      'failed-delete-user',
      async () => {
        events.push('write');
      },
      { redis, fenceStore: fences, userStore: users },
    );
    await eventually(() => expect(events).toEqual(['write']));
  });

  it('keeps a persistent fence after lock loss until canonical deletion succeeds', async () => {
    const redis = new FakeRedis();
    const fences = new FakeFenceStore();
    const users = new FakeUserStore('persistent-fence-user');
    const finishDeletion = await acquireUserMemoryShadowDeletionFence(
      'persistent-fence-user',
      async () => {},
      { redis, fenceStore: fences },
    );
    // Simulate a lost/expired Redis lease by using another Redis instance.
    const replacementRedis = new FakeRedis();
    const events: string[] = [];
    scheduleUserMemoryShadowWrite(
      'persistent-fence-user',
      async () => {
        events.push('unsafe-write');
      },
      { redis: replacementRedis, fenceStore: fences, userStore: users },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events).toEqual([]);
    await finishDeletion(true);
  });

  it('compensates a late remote write when deletion starts after Redis lease loss', async () => {
    const writerRedis = new FakeRedis();
    const deletionRedis = new FakeRedis();
    const fences = new FakeFenceStore();
    const users = new FakeUserStore('late-write-user');
    const events: string[] = [];
    let finishWrite = () => {};
    const writeCanFinish = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });

    scheduleUserMemoryShadowWrite(
      'late-write-user',
      async () => {
        events.push('write-started');
        await writeCanFinish;
        events.push('write-finished');
      },
      {
        redis: writerRedis,
        fenceStore: fences,
        userStore: users,
        compensate: async () => {
          events.push('late-write-deleted');
        },
      },
    );
    await eventually(() => expect(events).toEqual(['write-started']));

    const finishDeletion = await acquireUserMemoryShadowDeletionFence(
      'late-write-user',
      async () => {
        events.push('remote-deleted');
      },
      { redis: deletionRedis, fenceStore: fences },
    );
    finishWrite();
    await eventually(() => expect(events).toContain('late-write-deleted'));
    users.users.delete('late-write-user');
    await finishDeletion(true);
    expect(events).toEqual([
      'write-started',
      'remote-deleted',
      'write-finished',
      'late-write-deleted',
    ]);
  });
});
