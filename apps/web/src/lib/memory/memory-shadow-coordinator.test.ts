import { describe, expect, it } from 'bun:test';
import {
  acquireUserMemoryShadowDeletionFence,
  scheduleUserMemoryShadowWrite,
  type MemoryShadowRedis,
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
      redis,
    );
    await eventually(() => expect(events).toEqual(['write-1-started']));

    const deletion = acquireUserMemoryShadowDeletionFence(
      'race-user',
      async () => {
        events.push('remote-deleted');
      },
      redis,
    );
    finishFirstWrite();
    const releaseDeletion = await deletion;
    expect(events).toEqual(['write-1-started', 'write-1-finished', 'remote-deleted']);

    scheduleUserMemoryShadowWrite(
      'race-user',
      async () => {
        events.push('write-2');
      },
      redis,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events).not.toContain('write-2');
    await releaseDeletion();
    await eventually(() => expect(events).toContain('write-2'));
  });

  it('releases the distributed fence when remote deletion fails', async () => {
    const redis = new FakeRedis();
    await expect(
      acquireUserMemoryShadowDeletionFence(
        'failed-delete-user',
        async () => {
          throw new Error('remote unavailable');
        },
        redis,
      ),
    ).rejects.toThrow('remote unavailable');
    const events: string[] = [];
    scheduleUserMemoryShadowWrite(
      'failed-delete-user',
      async () => {
        events.push('write');
      },
      redis,
    );
    await eventually(() => expect(events).toEqual(['write']));
  });
});
