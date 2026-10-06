import { expect, test, spyOn } from 'bun:test';
import { Hono } from 'hono';
import {
  McpConcurrencyLimiter,
  checkMcpRequestRate,
  mcpProtectionStore,
} from '../src/routes/mcp-request-protection';

test('concurrency limits apply per owner and globally, with idempotent capacity release', () => {
  const limiter = new McpConcurrencyLimiter(2, 1);
  const first = limiter.acquire('owner-a');
  expect(first).not.toBeNull();
  expect(limiter.acquire('owner-a')).toBeNull();
  const second = limiter.acquire('owner-b');
  expect(second).not.toBeNull();
  expect(limiter.acquire('owner-c')).toBeNull();
  first!();
  first!();
  expect(limiter.acquire('owner-c')).not.toBeNull();
  expect(limiter.acquire('owner-d')).toBeNull();
  second!();
  expect(limiter.acquire('owner-d')).not.toBeNull();
});

test('request safeguards use the connection peer, ignore forwarded identities, and fail closed', async () => {
  const app = new Hono();
  app.post('/mcp', async (c) => (await checkMcpRequestRate(c)) ?? c.json({ ok: true }));
  const reads = spyOn(mcpProtectionStore, 'consume').mockImplementation(async () => ({
    allowed: true,
    count: 1,
    limit: 100,
    resetIn: 60,
  }));
  try {
    const request = () =>
      app.fetch(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: { 'cf-connecting-ip': 'spoofed-client', 'x-forwarded-for': 'spoofed-forwarded' },
        }),
      );
    expect((await request()).status).toBe(200);
    expect(JSON.stringify(reads.mock.calls)).not.toContain('spoofed');
    reads.mockImplementationOnce(async () => {
      throw new Error('PRIVATE REDIS PASSWORD');
    });
    const failure = await request();
    expect(failure.status).toBe(503);
    expect(await failure.text()).not.toContain('PRIVATE');
    expect(failure.headers.get('retry-after')).toBeTruthy();
    reads.mockImplementation(async () => ({ allowed: false, count: 101, limit: 100, resetIn: 42 }));
    const limited = await request();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('42');
  } finally {
    reads.mockRestore();
  }
});
