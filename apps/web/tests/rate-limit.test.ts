// ============================================================================
// Tests do helper rate-limit (janela fixa via Redis INCR+EXPIRE atomic).
// Skipa se DATABASE_URL não setado (CI tem Redis em sidecar).
// ============================================================================

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { rateLimit, rateLimitRequiredWithRedis, rateLimitWithRedis } from '../src/lib/rate-limit';
import { closeRedis, getRedisPublisher } from '../src/lib/redis';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

describeIfDb('rateLimit', () => {
  const TEST_KEY = 'voxen:test:rl';

  beforeEach(async () => {
    await getRedisPublisher().del(TEST_KEY);
  });

  afterAll(async () => {
    await getRedisPublisher().del(TEST_KEY);
    await closeRedis();
  });

  it('primeiro hit é allowed e seta TTL', async () => {
    const r = await rateLimit(TEST_KEY, 3, 60);
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(1);
    expect(r.limit).toBe(3);
    expect(r.resetIn).toBeGreaterThan(0);
    expect(r.resetIn).toBeLessThanOrEqual(60);
  });

  it('hits dentro do limit são allowed', async () => {
    const r1 = await rateLimit(TEST_KEY, 3, 60);
    const r2 = await rateLimit(TEST_KEY, 3, 60);
    const r3 = await rateLimit(TEST_KEY, 3, 60);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(true);
    expect(r3.count).toBe(3);
  });

  it('hit acima do limit é rejected', async () => {
    await rateLimit(TEST_KEY, 2, 60);
    await rateLimit(TEST_KEY, 2, 60);
    const r = await rateLimit(TEST_KEY, 2, 60);
    expect(r.allowed).toBe(false);
    expect(r.count).toBe(3);
    expect(r.limit).toBe(2);
  });

  it('TTL é preservado entre hits (EXPIRE NX)', async () => {
    const r1 = await rateLimit(TEST_KEY, 10, 60);
    const ttl1 = r1.resetIn;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const r2 = await rateLimit(TEST_KEY, 10, 60);
    // TTL deve ter diminuído (não resetado pra 60 de novo)
    expect(r2.resetIn).toBeLessThan(ttl1);
    expect(r2.resetIn).toBeGreaterThan(0);
  });

  it('janela expira → contador reseta', async () => {
    await rateLimit(TEST_KEY, 1, 1); // limit 1, janela 1s
    const r2 = await rateLimit(TEST_KEY, 1, 1);
    expect(r2.allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const r3 = await rateLimit(TEST_KEY, 1, 1);
    expect(r3.allowed).toBe(true);
    expect(r3.count).toBe(1);
  });
});

describe('rateLimitWithRedis', () => {
  it('falha aberta quando MULTI/EXEC aborta', async () => {
    const pipeline = {
      incr: () => pipeline,
      expire: () => pipeline,
      ttl: () => pipeline,
      exec: async () => null,
    };
    const redis = {
      multi: () => pipeline,
    };

    const result = await rateLimitWithRedis(redis, 'voxen:test:abort', 3, 60);
    expect(result).toEqual({ allowed: true, count: 0, limit: 3, resetIn: 60 });
  });

  it('falha fechada para endpoints que criam estado durável', async () => {
    const pipeline = {
      incr: () => pipeline,
      expire: () => pipeline,
      ttl: () => pipeline,
      exec: async () => null,
    };
    const redis = { multi: () => pipeline };

    await expect(
      rateLimitRequiredWithRedis(redis, 'voxen:test:required-abort', 3, 60),
    ).rejects.toThrow('Rate-limit store unavailable');
  });
});
