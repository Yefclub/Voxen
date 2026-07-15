import { describe, expect, test } from 'bun:test';
import {
  GRAPH_INDEX_LEASE_TTL_MS,
  acquireGraphIndexLease,
  graphIndexLeaseKey,
  readGraphIndexStatus,
  releaseGraphIndexLease,
  renewGraphIndexLease,
  shouldStartGraphIndex,
  writeGraphIndexStatus,
  type GraphIndexRedis,
} from '../src/lib/graph-index-coordinator';

class FakeRedis implements GraphIndexRedis {
  private readonly values = new Map<string, string>();
  private readonly expiresAt = new Map<string, number>();

  constructor(private now = 1_000) {}

  advance(ms: number): void {
    this.now += ms;
  }

  async get(key: string): Promise<string | null> {
    this.expire(key);
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, ...args: Array<string | number>): Promise<'OK' | null> {
    this.expire(key);
    const nx = args.includes('NX');
    if (nx && this.values.has(key)) return null;
    this.values.set(key, value);
    const pxIndex = args.indexOf('PX');
    const exIndex = args.indexOf('EX');
    if (pxIndex >= 0) this.expiresAt.set(key, this.now + Number(args[pxIndex + 1]));
    if (exIndex >= 0) this.expiresAt.set(key, this.now + Number(args[exIndex + 1]) * 1_000);
    return 'OK';
  }

  async eval(
    script: string,
    _numberOfKeys: number,
    key: string,
    owner: string,
    ttlMs?: number,
  ): Promise<number> {
    this.expire(key);
    if (this.values.get(key) !== owner) return 0;
    if (script.includes('pexpire')) {
      this.expiresAt.set(key, this.now + Number(ttlMs));
      return 1;
    }
    this.values.delete(key);
    this.expiresAt.delete(key);
    return 1;
  }

  private expire(key: string): void {
    const expiry = this.expiresAt.get(key);
    if (expiry !== undefined && expiry <= this.now) {
      this.values.delete(key);
      this.expiresAt.delete(key);
    }
  }
}

describe('graph index Redis coordinator', () => {
  test('allows only one owner and safely renews/releases its lease', async () => {
    const redis = new FakeRedis();

    expect(await acquireGraphIndexLease('user-1', 'run-a', redis)).toBe(true);
    expect(await acquireGraphIndexLease('user-1', 'run-b', redis)).toBe(false);
    expect(await renewGraphIndexLease('user-1', 'run-b', redis)).toBe(false);
    expect(await renewGraphIndexLease('user-1', 'run-a', redis)).toBe(true);
    expect(await releaseGraphIndexLease('user-1', 'run-b', redis)).toBe(false);
    expect(await releaseGraphIndexLease('user-1', 'run-a', redis)).toBe(true);
    expect(await acquireGraphIndexLease('user-1', 'run-b', redis)).toBe(true);
  });

  test('turns an abandoned running status into recoverable idle after lease expiry', async () => {
    const redis = new FakeRedis();
    await acquireGraphIndexLease('user-1', 'run-a', redis);
    await writeGraphIndexStatus(
      'user-1',
      {
        state: 'running',
        runId: 'run-a',
        startedAt: '2026-07-15T12:00:00.000Z',
        updatedAt: '2026-07-15T12:00:00.000Z',
      },
      redis,
    );

    expect((await readGraphIndexStatus('user-1', redis)).state).toBe('running');
    redis.advance(GRAPH_INDEX_LEASE_TTL_MS + 1);

    expect(await readGraphIndexStatus('user-1', redis)).toMatchObject({
      state: 'idle',
      recoverable: true,
      runId: 'run-a',
    });
    expect(await redis.get(graphIndexLeaseKey('user-1'))).toBeNull();
  });

  test('honors an error cooldown but allows an explicit retry', () => {
    const status = {
      state: 'error' as const,
      runId: 'run-a',
      updatedAt: '2026-07-15T12:00:00.000Z',
      retryAfter: '2026-07-15T12:05:00.000Z',
      reason: 'coverage-incomplete' as const,
    };

    expect(shouldStartGraphIndex(status, false, Date.parse('2026-07-15T12:04:00.000Z'))).toBe(
      false,
    );
    expect(shouldStartGraphIndex(status, true, Date.parse('2026-07-15T12:04:00.000Z'))).toBe(true);
    expect(shouldStartGraphIndex(status, false, Date.parse('2026-07-15T12:06:00.000Z'))).toBe(true);
  });
});
