import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { AiProvider } from '../lib/ai/catalog';
import type { ProbeProviderKey, ProbeResult } from '../lib/ai/probe';
import { db } from '../lib/db';
import { getUserSetting, setUserSetting } from '../lib/settings';
import { getRedisPublisher } from '../lib/redis';
import { accountRoutes } from './account';
import { registerAccountAiRoutes } from './account-ai';

const describeIfServices =
  process.env.DATABASE_URL && process.env.REDIS_URL ? describe : describe.skip;

const KEYS = {
  anthropic: 'sk-ant-api03-ownerANTHROPICsecret-0001',
  openai: 'sk-proj-ownerOPENAIsecret-000000002',
  xai: 'xai-ownerXAIsecretvalue-0000000003',
  google: 'AIzaSyOwnerGOOGLEsecretValue-000000006',
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

  test('starts with no providers, no chains and the curated catalog', async () => {
    const { status, json } = await call(owner, 'GET', '/ai');
    expect(status).toBe(200);
    const providers = json.providers as Array<{ provider: string; configured: boolean }>;
    expect(providers.map((item) => item.provider).sort()).toEqual([
      'anthropic',
      'google',
      'openai',
      'openrouter',
      'xai',
    ]);
    expect(providers.every((item) => !item.configured)).toBe(true);
    expect(json.chains).toEqual({});
    expect((json.catalog as unknown[]).length).toBe(5);
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

  test('saves a valid key encrypted, returns only last4, and fills the empty chains', async () => {
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
    expect(json.chains).toEqual({
      fast: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }],
      standard: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }],
      vision: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }],
    });
    const row = await db.setting.findFirst({
      where: { scope: 'USER', userId: ownerId, key: 'ai_provider_key:anthropic' },
    });
    expect(row).not.toBeNull();
    expect(row!.valueEnc).not.toContain(KEYS.anthropic);
  });

  test('a second provider only fills chains that are still empty', async () => {
    const { json } = await call(owner, 'PUT', '/ai/providers/openai', { apiKey: KEYS.openai });
    expect(json.chains).toEqual({
      fast: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }],
      standard: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }],
      vision: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }],
      stt: [{ provider: 'openai', model: 'gpt-transcribe' }],
    });
  });

  test('a Gemini key never joins a non-empty chain on its own', async () => {
    const { status, json } = await call(owner, 'PUT', '/ai/providers/google', {
      apiKey: KEYS.google,
    });
    expect(status).toBe(200);
    expect(json.provider).toMatchObject({ provider: 'google', status: 'valid' });
    expect(JSON.stringify(json.chains)).not.toContain('"google"');
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
    expect(JSON.stringify(json.chains)).not.toContain('"xai"');
  });

  test('re-probes a stored key and 404s when none exists', async () => {
    const tested = await call(owner, 'POST', '/ai/providers/openai/test');
    expect(tested.status).toBe(200);
    expect(tested.json.provider).toMatchObject({ provider: 'openai', status: 'valid' });
    expect((await call(owner, 'POST', '/ai/providers/openrouter/test')).status).toBe(404);
  });

  test('validates chains against the catalog, configured providers, duplicates and length', async () => {
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
    const extraEntryField = await call(owner, 'PUT', '/ai/roles', {
      standard: [{ provider: 'openai', model: 'gpt-6-luna', baseURL: 'https://evil.example' }],
    });
    expect(extraEntryField.status).toBe(400);
    const duplicate = await call(owner, 'PUT', '/ai/roles', {
      standard: [
        { provider: 'openai', model: 'gpt-6-luna' },
        { provider: 'openai', model: 'gpt-6-luna' },
      ],
    });
    expect(duplicate.status).toBe(400);
    expect(JSON.stringify(duplicate.json.details)).toContain('DUPLICATE_ENTRY');
    const tooLong = await call(owner, 'PUT', '/ai/roles', {
      standard: [
        { provider: 'openai', model: 'gpt-6-luna' },
        { provider: 'openai', model: 'gpt-6.1-terra' },
        { provider: 'anthropic', model: 'claude-haiku-5-5' },
        { provider: 'anthropic', model: 'claude-sonnet-5-5' },
        { provider: 'google', model: 'gemini-3.8-flash' },
      ],
    });
    expect(tooLong.status).toBe(400);
    const badChain = await call(owner, 'PUT', '/ai/roles', {
      standard: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }, 'gpt-6-luna'],
    });
    expect(badChain.status).toBe(400);
    const geminiStt = await call(owner, 'PUT', '/ai/roles', {
      vision: [{ provider: 'google', model: 'gemini-3.5-transcribe' }],
    });
    expect(geminiStt.status).toBe(400);

    // Spec 220 single-entry shape is still accepted and stored as a chain.
    const legacyShape = await call(owner, 'PUT', '/ai/roles', {
      fast: { provider: 'openai', model: 'gpt-6-luna' },
    });
    expect(legacyShape.status).toBe(200);
    expect(legacyShape.json.chains).toEqual({
      fast: [{ provider: 'openai', model: 'gpt-6-luna' }],
    });

    const saved = await call(owner, 'PUT', '/ai/roles', {
      fast: [{ provider: 'openai', model: 'gpt-6-luna' }],
      standard: [
        { provider: 'openai', model: 'gpt-6.1-terra' },
        { provider: 'google', model: 'gemini-3.8-flash' },
        { provider: 'anthropic', model: 'claude-haiku-5-5' },
      ],
      vision: [
        { provider: 'anthropic', model: 'claude-haiku-5-5' },
        { provider: 'google', model: 'gemini-3.5-flash-lite' },
      ],
      stt: [
        { provider: 'xai', model: 'grok-voice-transcribe-2.0' },
        { provider: 'google', model: 'gemini-3.5-transcribe' },
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.json.chains).toMatchObject({
      standard: [
        { provider: 'openai', model: 'gpt-6.1-terra' },
        { provider: 'google', model: 'gemini-3.8-flash' },
        { provider: 'anthropic', model: 'claude-haiku-5-5' },
      ],
      stt: [
        { provider: 'xai', model: 'grok-voice-transcribe-2.0' },
        { provider: 'google', model: 'gemini-3.5-transcribe' },
      ],
    });
    expect((await call(owner, 'GET', '/ai')).json.chains).toEqual(saved.json.chains);
  });

  test('stores a reasoning effort per text role, default medium, kept across chain edits', async () => {
    const initial = await call(owner, 'GET', '/ai');
    expect(initial.json.reasoning).toEqual({
      fast: 'medium',
      standard: 'medium',
      vision: 'medium',
    });

    const invalidEffort = await call(owner, 'PUT', '/ai/roles', {
      reasoning: { standard: 'extreme' },
    });
    expect(invalidEffort.status).toBe(400);
    const sttEffort = await call(owner, 'PUT', '/ai/roles', { reasoning: { stt: 'high' } });
    expect(sttEffort.status).toBe(400);

    const chains = initial.json.chains as Json;
    const saved = await call(owner, 'PUT', '/ai/roles', {
      ...chains,
      reasoning: { fast: 'off', vision: 'high' },
    });
    expect(saved.status).toBe(200);
    expect(saved.json.reasoning).toEqual({ fast: 'off', standard: 'medium', vision: 'high' });
    expect(saved.json.chains).toEqual(chains);

    // A later chain-only save keeps the stored efforts.
    const chainOnly = await call(owner, 'PUT', '/ai/roles', chains);
    expect(chainOnly.json.reasoning).toEqual({ fast: 'off', standard: 'medium', vision: 'high' });
    expect((await call(owner, 'GET', '/ai')).json.reasoning).toEqual({
      fast: 'off',
      standard: 'medium',
      vision: 'high',
    });
  });

  test('isolates users: B cannot read, test, remove or use A configuration', async () => {
    const read = await call(foreign, 'GET', '/ai');
    const providers = read.json.providers as Array<{ configured: boolean }>;
    expect(providers.every((item) => !item.configured)).toBe(true);
    expect(read.json.chains).toEqual({});

    expect((await call(foreign, 'POST', '/ai/providers/anthropic/test')).status).toBe(404);
    expect(
      (
        await call(foreign, 'PUT', '/ai/roles', {
          standard: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }],
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
    expect(ownerView.json.chains).toMatchObject({
      vision: [
        { provider: 'anthropic', model: 'claude-haiku-5-5' },
        { provider: 'google', model: 'gemini-3.5-flash-lite' },
      ],
    });
  });

  test('removing a key removes only its entries and keeps the order of the rest', async () => {
    const removed = await call(owner, 'DELETE', '/ai/providers/openai');
    expect(removed.status).toBe(200);
    expect(removed.json.provider).toMatchObject({ configured: false, last4: null, status: null });
    expect(removed.json.chains).toEqual({
      standard: [
        { provider: 'google', model: 'gemini-3.8-flash' },
        { provider: 'anthropic', model: 'claude-haiku-5-5' },
      ],
      vision: [
        { provider: 'anthropic', model: 'claude-haiku-5-5' },
        { provider: 'google', model: 'gemini-3.5-flash-lite' },
      ],
      stt: [
        { provider: 'xai', model: 'grok-voice-transcribe-2.0' },
        { provider: 'google', model: 'gemini-3.5-transcribe' },
      ],
    });
    const rows = await db.setting.findMany({
      where: { scope: 'USER', userId: ownerId, key: { startsWith: 'ai_provider_' } },
      select: { key: true },
    });
    expect(rows.map((row) => row.key).sort()).toEqual([
      'ai_provider_key:anthropic',
      'ai_provider_key:google',
      'ai_provider_key:xai',
      'ai_provider_meta:anthropic',
      'ai_provider_meta:google',
      'ai_provider_meta:xai',
    ]);
  });

  test('reads a legacy ai_model_roles value as chains and never rewrites it', async () => {
    const legacy = JSON.stringify({
      standard: { provider: 'anthropic', model: 'claude-haiku-5-5' },
    });
    // Start from a user that only has the spec 220 value.
    await db.setting.deleteMany({
      where: { scope: 'USER', userId: foreignId, key: 'ai_model_chains' },
    });
    await setUserSetting(foreignId, 'ai_model_roles', legacy);
    await call(foreign, 'PUT', '/ai/providers/anthropic', { apiKey: KEYS.foreign });
    const read = await call(foreign, 'GET', '/ai');
    expect(read.json.chains).toMatchObject({
      standard: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }],
    });
    // Removing the provider writes ai_model_chains (now empty) and leaves the legacy value.
    await call(foreign, 'DELETE', '/ai/providers/anthropic');
    expect((await call(foreign, 'GET', '/ai')).json.chains).toEqual({});
    const rows = await db.setting.findMany({
      where: {
        scope: 'USER',
        userId: foreignId,
        key: { in: ['ai_model_roles', 'ai_model_chains'] },
      },
      select: { key: true },
    });
    expect(rows.map((row) => row.key).sort()).toEqual(['ai_model_chains', 'ai_model_roles']);
    expect(await getUserSetting(foreignId, 'ai_model_roles')).toBe(legacy);
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
