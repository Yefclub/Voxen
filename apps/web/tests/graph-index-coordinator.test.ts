import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  GRAPH_INDEX_LEASE_TTL_MS,
  acquireGraphIndexLease,
  graphIndexLeaseKey,
  graphIndexStatusKey,
  readGraphIndexStatus,
  reconcileGraphIndexStatus,
  releaseGraphIndexLease,
  renewGraphIndexLease,
  shouldStartGraphIndex,
  writeGraphIndexStatus,
  writeGraphIndexStatusWithoutLease,
  writeOwnedGraphIndexStatus,
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
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<number> {
    if (numberOfKeys === 2) {
      if (args.length === 4) {
        const [leaseKey, statusKey, payload, ttlSec] = args.map(String);
        this.expire(leaseKey ?? '');
        this.expire(statusKey ?? '');
        if (!leaseKey || !statusKey || this.values.has(leaseKey)) return 0;
        this.values.set(statusKey, payload ?? '');
        this.expiresAt.set(statusKey, this.now + Number(ttlSec) * 1_000);
        return 1;
      }
      const [leaseKey, statusKey, owner, payload, ttlSec] = args.map(String);
      this.expire(leaseKey ?? '');
      this.expire(statusKey ?? '');
      if (!leaseKey || !statusKey || this.values.get(leaseKey) !== owner) return 0;
      this.values.set(statusKey, payload ?? '');
      this.expiresAt.set(statusKey, this.now + Number(ttlSec) * 1_000);
      return 1;
    }
    const [keyValue, ownerValue, ttlMs] = args;
    const key = String(keyValue);
    const owner = String(ownerValue);
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

  test('treats a live lease as authoritative over a stale terminal status', async () => {
    const redis = new FakeRedis();
    await writeGraphIndexStatus(
      'user-1',
      { state: 'ready', runId: 'run-a', updatedAt: '2026-07-15T12:00:00.000Z' },
      redis,
    );
    await acquireGraphIndexLease('user-1', 'run-b', redis);

    expect(await readGraphIndexStatus('user-1', redis)).toMatchObject({
      state: 'running',
      runId: 'run-b',
    });
  });

  test('prevents an expired owner from publishing over the new lease owner', async () => {
    const redis = new FakeRedis();
    await acquireGraphIndexLease('user-1', 'run-a', redis);
    expect(
      await writeOwnedGraphIndexStatus(
        'user-1',
        'run-a',
        { state: 'running', runId: 'run-a', updatedAt: '2026-07-15T12:00:00.000Z' },
        redis,
      ),
    ).toBe(true);
    redis.advance(GRAPH_INDEX_LEASE_TTL_MS + 1);
    await acquireGraphIndexLease('user-1', 'run-b', redis);

    expect(
      await writeOwnedGraphIndexStatus(
        'user-1',
        'run-a',
        { state: 'error', runId: 'run-a', updatedAt: '2026-07-15T12:02:00.000Z' },
        redis,
      ),
    ).toBe(false);
    expect(JSON.parse((await redis.get(graphIndexStatusKey('user-1'))) ?? '{}')).toMatchObject({
      state: 'running',
      runId: 'run-a',
    });

    expect(
      await writeOwnedGraphIndexStatus(
        'user-1',
        'run-b',
        { state: 'ready', runId: 'run-b', updatedAt: '2026-07-15T12:03:00.000Z' },
        redis,
      ),
    ).toBe(true);
    await releaseGraphIndexLease('user-1', 'run-b', redis);
    expect(await readGraphIndexStatus('user-1', redis)).toMatchObject({
      state: 'ready',
      runId: 'run-b',
    });
  });

  test('keeps a local fallback running when Redis recovers without a lease', () => {
    const local = {
      state: 'running' as const,
      runId: 'run-local',
      updatedAt: '2026-07-15T12:00:00.000Z',
    };
    const remoteIdle = {
      state: 'idle' as const,
      updatedAt: '2026-07-15T12:01:00.000Z',
    };
    expect(reconcileGraphIndexStatus(remoteIdle, local, true)).toBe(local);
    expect(
      reconcileGraphIndexStatus(
        { state: 'running', runId: 'run-remote', updatedAt: '2026-07-15T12:02:00.000Z' },
        local,
        true,
      ),
    ).toMatchObject({ runId: 'run-remote' });
  });

  test('keeps the newest local terminal state after Redis recovers', () => {
    const localReady = {
      state: 'ready' as const,
      runId: 'run-local-ready',
      updatedAt: '2026-07-15T12:03:00.000Z',
    };
    const remoteError = {
      state: 'error' as const,
      runId: 'run-remote-error',
      updatedAt: '2026-07-15T12:01:00.000Z',
    };
    const localError = {
      state: 'error' as const,
      runId: 'run-local-error',
      updatedAt: '2026-07-15T12:04:00.000Z',
    };
    const remoteReady = {
      state: 'ready' as const,
      runId: 'run-remote-ready',
      updatedAt: '2026-07-15T12:02:00.000Z',
    };

    expect(reconcileGraphIndexStatus(remoteError, localReady, false)).toBe(localReady);
    expect(reconcileGraphIndexStatus(remoteReady, localError, false)).toBe(localError);
    expect(reconcileGraphIndexStatus(localReady, remoteError, false)).toBe(localReady);
  });

  test('publishes a recovered local terminal only when no lease is live', async () => {
    const redis = new FakeRedis();
    const localReady = {
      state: 'ready' as const,
      runId: 'run-local',
      updatedAt: '2026-07-15T12:03:00.000Z',
    };

    expect(await writeGraphIndexStatusWithoutLease('user-1', localReady, redis)).toBe(true);
    expect(JSON.parse((await redis.get(graphIndexStatusKey('user-1'))) ?? '{}')).toMatchObject(
      localReady,
    );
    await acquireGraphIndexLease('user-1', 'run-remote', redis);
    expect(
      await writeGraphIndexStatusWithoutLease('user-1', { ...localReady, state: 'error' }, redis),
    ).toBe(false);
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

  test('checks lease ownership between every expensive indexing phase', () => {
    const routeSource = readFileSync(
      new URL('../src/routes/graph.ts', import.meta.url),
      'utf8',
    ).replaceAll('\r\n', '\n');
    expect(routeSource).toContain(
      'await reindexLibraryFoldersBrain(userId);\n      await assertLeaseOwnership();\n      await reindexNotesBrain(userId);',
    );
    expect(routeSource).toContain(
      'await reindexNotesBrain(userId);\n      await assertLeaseOwnership();\n      await reindexTranscriptsBrain(userId);',
    );
    expect(routeSource).toContain(
      'await invalidateGraphCache(userId);\n      await assertLeaseOwnership();',
    );
  });
});
