import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { AiProvider } from '../lib/ai/catalog';
import type { ProbeProviderKey, ProbeResult } from '../lib/ai/probe';
import { db } from '../lib/db';
import { getRedisPublisher } from '../lib/redis';
import { accountRoutes } from './account';
import { registerAccountAiRoutes } from './account-ai';

const describeIfServices =
  process.env.DATABASE_URL && process.env.REDIS_URL ? describe : describe.skip;

const KEYS = {
  anthropic: 'sk-ant-api03-ownerANTHROPICsecret-0001',
  openai: 'sk-proj-ownerOPENAIsecret-000000002',
  xai: 'xai-ownerXAIsecretvalue-0000000003',
  rejected: 'sk-ant-api03-REJECTEDsecretvalue-0004',
  foreign: 'sk-ant-api03-foreignUSERsecret-00005',
} as const;

// Fake probe: no network. Keys containing REJECTED are refused; xAI is unreachable.
const probe: ProbeProviderKey = async (provider: AiProvider, apiKey: string) => {
  const result: ProbeResult = apiKey.includes('REJECTED')
    ? { status: 'invalid', error: 'HTTP_401' }
    : provider === 'xai'
      ? { status: 'unknown', error: 'PROBE_NETWORK' }
      : { status: 'valid', error: null };
  return result;
};

type Json = Record<string, unknown>;

describeIfServices('account AI provider API', () => {
  let ownerId = '';
  let foreignId = '';
  const responses: string[] = [];
  const owner = new Hono<{ Variables: { userId: string } }>();
  const foreign = new Hono<{ Variables: { userId: string } }>();

  async function call(
    app: Hono<{ Variables: { userId: string } }>,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: Json }> {
    const response = await app.request(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    responses.push(text);
    return { status: response.status, json: JSON.parse(text) as Json };
  }

  beforeAll(async () => {
    const suffix = crypto.randomUUID();
    const [a, b] = await Promise.all([
      db.user.create({
        data: { email: `ai-owner-${suffix}@voxen.local`, name: 'AI owner', status: 'APPROVED' },
      }),
      db.user.create({
        data: { email: `ai-foreign-${suffix}@voxen.local`, name: 'AI foreign', status: 'APPROVED' },
      }),
    ]);
    ownerId = a.id;
    foreignId = b.id;
    owner.use('*', async (c, next) => {
      c.set('userId', ownerId);
      return next();
    });
    foreign.use('*', async (c, next) => {
      c.set('userId', foreignId);
      return next();
    });
    registerAccountAiRoutes(owner, { probe });
    registerAccountAiRoutes(foreign, { probe });
  });

  afterAll(async () => {
    const ids = [ownerId, foreignId].filter(Boolean);
    await db.setting.deleteMany({ where: { scope: 'USER', userId: { in: ids } } });
    await getRedisPublisher()
      .del(...ids.map((id) => `voxen:rl:ai-providers:${id}`))
      .catch(() => undefined);
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  });

  test('requires an authenticated session', async () => {
    for (const [method, path] of [
      ['GET', '/ai'],
      ['PUT', '/ai/providers/openai'],
      ['POST', '/ai/providers/openai/test'],
      ['DELETE', '/ai/providers/openai'],
      ['PUT', '/ai/roles'],
    ] as const) {
      const response = await accountRoutes.request(path, { method });
      expect(response.status).toBe(401);
    }
  });

  test('starts with no providers, no roles and the curated catalog', async () => {
    const { status, json } = await call(owner, 'GET', '/ai');
    expect(status).toBe(200);
    const providers = json.providers as Array<{ provider: string; configured: boolean }>;
    expect(providers.map((item) => item.provider).sort()).toEqual([
      'anthropic',
      'openai',
      'openrouter',
      'xai',
    ]);
    expect(providers.every((item) => !item.configured)).toBe(true);
    expect(json.roles).toEqual({});
    expect((json.catalog as unknown[]).length).toBe(4);
  });

  test('rejects unknown providers and malformed keys', async () => {
    expect((await call(owner, 'PUT', '/ai/providers/gemini', { apiKey: KEYS.openai })).status).toBe(
      400,
    );
    expect((await call(owner, 'PUT', '/ai/providers/openai', { apiKey: 'short' })).status).toBe(
      400,
    );
    expect(
      (await call(owner, 'PUT', '/ai/providers/openai', { apiKey: `${KEYS.openai} with space` }))
        .status,
    ).toBe(400);
    expect((await call(owner, 'POST', '/ai/providers/gemini/test')).status).toBe(400);
    expect((await call(owner, 'DELETE', '/ai/providers/gemini')).status).toBe(400);
  });

  test('saves a valid key encrypted, returns only last4, and auto-assigns roles', async () => {
    const { status, json } = await call(owner, 'PUT', '/ai/providers/anthropic', {
      apiKey: `  ${KEYS.anthropic}  `,
    });
    expect(status).toBe(200);
    expect(json.result).toBe('valid');
    expect(json.provider).toMatchObject({
      provider: 'anthropic',
      configured: true,
      last4: KEYS.anthropic.slice(-4),
      status: 'valid',
    });
    expect(json.roles).toEqual({
      fast: { provider: 'anthropic', model: 'claude-haiku-5-5' },
      standard: { provider: 'anthropic', model: 'claude-haiku-5-5' },
      vision: { provider: 'anthropic', model: 'claude-haiku-5-5' },
    });
    const row = await db.setting.findFirst({
      where: { scope: 'USER', userId: ownerId, key: 'ai_provider_key:anthropic' },
    });
    expect(row).not.toBeNull();
    expect(row!.valueEnc).not.toContain(KEYS.anthropic);
  });

  test('a second provider only fills roles that are still empty', async () => {
    const { json } = await call(owner, 'PUT', '/ai/providers/openai', { apiKey: KEYS.openai });
    expect(json.roles).toMatchObject({
      standard: { provider: 'anthropic', model: 'claude-haiku-5-5' },
      stt: { provider: 'openai', model: 'gpt-transcribe' },
    });
  });

  test('does not store a key the provider rejects', async () => {
    const { status, json } = await call(owner, 'PUT', '/ai/providers/anthropic', {
      apiKey: KEYS.rejected,
    });
    expect(status).toBe(422);
    expect(json.code).toBe('LLM_AUTH');
    // The previously saved key stays in place.
    expect(json.provider).toMatchObject({ last4: KEYS.anthropic.slice(-4), status: 'valid' });
  });

  test('stores a key with an inconclusive probe as unknown without assigning roles', async () => {
    const { status, json } = await call(owner, 'PUT', '/ai/providers/xai', { apiKey: KEYS.xai });
    expect(status).toBe(200);
    expect(json.result).toBe('unknown');
    expect(json.provider).toMatchObject({ status: 'unknown', error: 'PROBE_NETWORK' });
    expect(JSON.stringify(json.roles)).not.toContain('"xai"');
  });

  test('re-probes a stored key and 404s when none exists', async () => {
    const tested = await call(owner, 'POST', '/ai/providers/openai/test');
    expect(tested.status).toBe(200);
    expect(tested.json.provider).toMatchObject({ provider: 'openai', status: 'valid' });
    expect((await call(owner, 'POST', '/ai/providers/openrouter/test')).status).toBe(404);
  });

  test('validates role assignments against the catalog and configured providers', async () => {
    const unknownModel = await call(owner, 'PUT', '/ai/roles', {
      standard: { provider: 'openai', model: 'gpt-0-imaginary' },
    });
    expect(unknownModel.status).toBe(400);
    const wrongRole = await call(owner, 'PUT', '/ai/roles', {
      fast: { provider: 'openai', model: 'gpt-transcribe' },
    });
    expect(wrongRole.status).toBe(400);
    const anthropicStt = await call(owner, 'PUT', '/ai/roles', {
      stt: { provider: 'anthropic', model: 'claude-haiku-5-5' },
    });
    expect(anthropicStt.status).toBe(400);
    const unconfigured = await call(owner, 'PUT', '/ai/roles', {
      standard: { provider: 'openrouter', model: 'anthropic/claude-haiku-5.5' },
    });
    expect(unconfigured.status).toBe(400);
    expect(JSON.stringify(unconfigured.json.details)).toContain('PROVIDER_NOT_CONFIGURED');
    const unknownField = await call(owner, 'PUT', '/ai/roles', { userId: foreignId });
    expect(unknownField.status).toBe(400);

    const saved = await call(owner, 'PUT', '/ai/roles', {
      fast: { provider: 'openai', model: 'gpt-6-luna' },
      standard: { provider: 'openai', model: 'gpt-6.1-terra' },
      vision: { provider: 'anthropic', model: 'claude-haiku-5-5' },
      stt: { provider: 'xai', model: 'grok-voice-transcribe-2.0' },
    });
    expect(saved.status).toBe(200);
    expect(saved.json.roles).toMatchObject({
      standard: { provider: 'openai', model: 'gpt-6.1-terra' },
      stt: { provider: 'xai', model: 'grok-voice-transcribe-2.0' },
    });
  });

  test('isolates users: B cannot read, test, remove or use A configuration', async () => {
    const read = await call(foreign, 'GET', '/ai');
    const providers = read.json.providers as Array<{ configured: boolean }>;
    expect(providers.every((item) => !item.configured)).toBe(true);
    expect(read.json.roles).toEqual({});

    expect((await call(foreign, 'POST', '/ai/providers/anthropic/test')).status).toBe(404);
    expect(
      (
        await call(foreign, 'PUT', '/ai/roles', {
          standard: { provider: 'anthropic', model: 'claude-haiku-5-5' },
        })
      ).status,
    ).toBe(400);
    await call(foreign, 'PUT', '/ai/providers/anthropic', { apiKey: KEYS.foreign });
    await call(foreign, 'DELETE', '/ai/providers/anthropic');

    const ownerView = await call(owner, 'GET', '/ai');
    const anthropic = (ownerView.json.providers as Array<Json>).find(
      (item) => item.provider === 'anthropic',
    );
    expect(anthropic).toMatchObject({ configured: true, last4: KEYS.anthropic.slice(-4) });
    expect(ownerView.json.roles).toMatchObject({
      vision: { provider: 'anthropic', model: 'claude-haiku-5-5' },
    });
  });

  test('removing a key clears its status and every role that used it', async () => {
    const removed = await call(owner, 'DELETE', '/ai/providers/openai');
    expect(removed.status).toBe(200);
    expect(removed.json.provider).toMatchObject({ configured: false, last4: null, status: null });
    expect(removed.json.roles).toEqual({
      vision: { provider: 'anthropic', model: 'claude-haiku-5-5' },
      stt: { provider: 'xai', model: 'grok-voice-transcribe-2.0' },
    });
    const rows = await db.setting.findMany({
      where: { scope: 'USER', userId: ownerId, key: { startsWith: 'ai_provider_' } },
      select: { key: true },
    });
    expect(rows.map((row) => row.key).sort()).toEqual([
      'ai_provider_key:anthropic',
      'ai_provider_key:xai',
      'ai_provider_meta:anthropic',
      'ai_provider_meta:xai',
    ]);
  });

  test('no response ever contained a submitted key', () => {
    expect(responses.length).toBeGreaterThan(20);
    const serialized = responses.join('\n');
    for (const key of Object.values(KEYS)) {
      expect(serialized).not.toContain(key);
      // Not even the key without its last four characters.
      expect(serialized).not.toContain(key.slice(0, -4));
    }
  });
});
