import { describe, expect, test } from 'bun:test';
import {
  clearSessionIntent,
  readSessionIntent,
  recordSessionIntent,
  SESSION_INTENT_TTL_SEC,
  sessionIntentKey,
  type SessionIntentStore,
} from './personal-interest-session';

class FakeIntentStore implements SessionIntentStore {
  values = new Map<string, string>();
  ttl = new Map<string, number>();

  async set(key: string, value: string, _expiryMode: 'EX', ttlSec: number): Promise<void> {
    this.values.set(key, value);
    this.ttl.set(key, ttlSec);
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async del(key: string): Promise<void> {
    this.values.delete(key);
    this.ttl.delete(key);
  }
}

describe('ephemeral personal session intent', () => {
  test('isolates, replaces, expires, and clears intent without durable blending', async () => {
    const store = new FakeIntentStore();
    const now = new Date('2026-08-11T12:00:00.000Z');
    await recordSessionIntent({
      userId: 'user-a',
      sessionId: 'session-1',
      now,
      store,
      items: [
        {
          dimension: 'TOPIC',
          key: 'topic:agents',
          label: 'AI agents',
          weight: 0.8,
          brainNodeId: 'node-1',
        },
      ],
    });
    expect(store.ttl.get(sessionIntentKey('user-a', 'session-1'))).toBe(SESSION_INTENT_TTL_SEC);
    expect(await readSessionIntent({ userId: 'user-b', sessionId: 'session-1', store })).toBeNull();
    expect(
      await readSessionIntent({ userId: 'user-a', sessionId: 'session-1', store }),
    ).toMatchObject({
      sessionId: 'session-1',
      expiresAt: '2026-08-11T14:00:00.000Z',
    });

    await recordSessionIntent({
      userId: 'user-a',
      sessionId: 'session-1',
      now,
      store,
      items: [
        {
          dimension: 'AUTHOR',
          key: 'author:karpathy',
          label: 'Andrej Karpathy',
          weight: -0.5,
          brainNodeId: null,
        },
      ],
    });
    const replaced = await readSessionIntent({ userId: 'user-a', sessionId: 'session-1', store });
    expect(replaced?.items).toHaveLength(1);
    expect(replaced?.items[0]?.dimension).toBe('AUTHOR');

    await clearSessionIntent({ userId: 'user-a', sessionId: 'session-1', store });
    expect(await readSessionIntent({ userId: 'user-a', sessionId: 'session-1', store })).toBeNull();
  });

  test('degrades corrupted Redis state to no temporary intent', async () => {
    const store = new FakeIntentStore();
    store.values.set(sessionIntentKey('user-a', 'session-2'), '{invalid');
    expect(await readSessionIntent({ userId: 'user-a', sessionId: 'session-2', store })).toBeNull();
  });
});
