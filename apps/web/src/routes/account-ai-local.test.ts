import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { ProbeProviderKey } from '../lib/ai/probe';
import { db } from '../lib/db';
import { getRedisPublisher } from '../lib/redis';
import { registerAccountAiRoutes } from './account-ai';

const describeIfServices =
  process.env.DATABASE_URL && process.env.REDIS_URL ? describe : describe.skip;

const KEYS = { openai: 'sk-proj-ownerOPENAIsecret-000000002' } as const;

// Fake probe: no network; every key is valid.
const probe: ProbeProviderKey = async () => ({ status: 'valid', error: null });

type Json = Record<string, unknown>;

describeIfServices('account AI keyless local STT', () => {
  let userId = '';
  let localUp = false;
  const app = new Hono<{ Variables: { userId: string } }>();
  const LOCAL = { provider: 'local', model: 'parakeet-tdt-0.6b-v3' } as const;

  async function call(method: string, path: string, body?: unknown) {
    const response = await app.request(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      text: await response.clone().text(),
      json: (await response.json()) as Json,
    };
  }

  beforeAll(async () => {
    const user = await db.user.create({
      data: {
        email: `ai-local-${crypto.randomUUID()}@voxen.local`,
        name: 'AI local',
        status: 'APPROVED',
      },
    });
    userId = user.id;
    app.use('*', async (c, next) => {
      c.set('userId', userId);
      return next();
    });
    registerAccountAiRoutes(app, { probe, localSttAvailable: async () => localUp });
  });

  afterAll(async () => {
    await db.setting.deleteMany({ where: { scope: 'USER', userId } });
    await getRedisPublisher()
      .del(`voxen:rl:ai-providers:${userId}`)
      .catch(() => undefined);
    await db.user.deleteMany({ where: { id: userId } });
  });

  test('GET reports local availability and model, never a URL or a key card', async () => {
    localUp = true;
    const { json, text } = await call('GET', '/ai');
    expect(json.local).toEqual({ available: true, model: 'parakeet-tdt-0.6b-v3' });
    expect(text).not.toMatch(/https?:\/\/[^"]*5092|stt-local/);
    const providers = json.providers as Array<{ provider: string }>;
    expect(providers.map((item) => item.provider)).not.toContain('local');
    localUp = false;
    expect((await call('GET', '/ai')).json.local).toMatchObject({ available: false });
  });

  test('the key routes never accept local', async () => {
    const key = { apiKey: 'sk-local-never-stored-000000000' };
    expect((await call('PUT', '/ai/providers/local', key)).status).toBe(400);
    expect((await call('POST', '/ai/providers/local/test')).status).toBe(400);
    expect((await call('DELETE', '/ai/providers/local')).status).toBe(400);
    const rows = await db.setting.findMany({
      where: { scope: 'USER', userId, key: { startsWith: 'ai_provider_' } },
    });
    expect(rows).toHaveLength(0);
  });

  test('local is accepted only for stt, only while available, and kept while down', async () => {
    localUp = true;
    for (const role of ['fast', 'standard', 'vision'] as const) {
      const wrongRole = await call('PUT', '/ai/roles', { [role]: [LOCAL] });
      expect(wrongRole.status).toBe(400);
      expect(JSON.stringify(wrongRole.json.details)).toContain('UNKNOWN_MODEL');
    }
    const otherModel = await call('PUT', '/ai/roles', {
      stt: [{ provider: 'local', model: 'whisper-1' }],
    });
    expect(otherModel.status).toBe(400);

    localUp = false;
    const down = await call('PUT', '/ai/roles', { stt: [LOCAL] });
    expect(down.status).toBe(400);
    expect(JSON.stringify(down.json.details)).toContain('PROVIDER_UNAVAILABLE');

    // No key needed: local is keyless.
    localUp = true;
    const saved = await call('PUT', '/ai/roles', { stt: [LOCAL] });
    expect(saved.status).toBe(200);
    expect(saved.json.chains).toEqual({ stt: [LOCAL] });

    // A key saved later never joins the non-empty stt chain by itself.
    await call('PUT', '/ai/providers/openai', { apiKey: KEYS.openai });
    const afterKey = (await call('GET', '/ai')).json.chains as Json;
    expect(afterKey.stt).toEqual([LOCAL]);

    // While the sidecar is down the stored entry stays and re-saving keeps it.
    localUp = false;
    const kept = await call('PUT', '/ai/roles', {
      ...afterKey,
      stt: [LOCAL, { provider: 'openai', model: 'gpt-transcribe' }],
    });
    expect(kept.status).toBe(200);
    expect((await call('GET', '/ai')).json.chains).toMatchObject({
      stt: [LOCAL, { provider: 'openai', model: 'gpt-transcribe' }],
    });

    // Removing a key never touches the local entry.
    await call('DELETE', '/ai/providers/openai');
    expect((await call('GET', '/ai')).json.chains).toEqual({ stt: [LOCAL] });
  });
});
