import { describe, expect, test } from 'bun:test';
import { APICallError } from 'ai';
import { MockLanguageModelV4, MockTranscriptionModelV4 } from 'ai/test';
import { z } from 'zod';
import {
  estimateSttCostUsd,
  estimateTextCostUsd,
  findCatalogModel,
  type AiProvider,
} from './catalog';
import { createAiClient, type ResolvedRole } from './client';
import { parseModelRoles, type ModelRoles } from './credentials';
import type { AiError } from './errors';

const USER = 'user-a';
const Summary = z.object({ title: z.string() });

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning: undefined },
});

function answering(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: usage(1000, 500),
      warnings: [],
    }),
  });
}

function failing(statusCode: number, responseBody = '{}'): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw new APICallError({
        message: `HTTP ${statusCode}`,
        url: 'https://example.invalid',
        requestBodyValues: {},
        statusCode,
        responseBody,
        isRetryable: false,
      });
    },
  });
}

function throwing(error: Error): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw error;
    },
  });
}

function aiWith(
  roles: ModelRoles,
  models: Partial<Record<AiProvider, MockLanguageModelV4>>,
  keys: Partial<Record<AiProvider, string>> = {
    anthropic: 'k-anthropic-000000',
    google: 'k-google-0000000000',
    openai: 'k-openai-0000000000',
    xai: 'k-xai-0000000000000',
    openrouter: 'k-openrouter-000000',
  },
) {
  return createAiClient({
    getRoles: async () => roles,
    getReasoning: async () => ({ fast: 'medium', standard: 'medium', vision: 'medium' }),
    getKey: async (_userId, provider) => keys[provider] ?? null,
    languageModel: (resolved: ResolvedRole) => models[resolved.provider]!,
  });
}

const generate = (
  ai: ReturnType<typeof aiWith>,
  extra: { role?: 'fast' | 'standard' | 'vision'; signal?: AbortSignal; image?: boolean } = {},
) =>
  ai.generateStructured({
    userId: USER,
    role: extra.role ?? 'standard',
    instructions: 'x',
    untrusted: extra.image ? [{ image: new Uint8Array([1]), mime: 'image/png' }] : [{ text: 'y' }],
    schema: Summary,
    maxOutputTokens: 100,
    signal: extra.signal,
  });

const ANTHROPIC_THEN_GOOGLE: ModelRoles = {
  standard: [
    { provider: 'anthropic', model: 'claude-haiku-5-5' },
    { provider: 'google', model: 'gemini-3.5-flash-lite' },
  ],
};

const textCost = (provider: AiProvider, model: string) =>
  estimateTextCostUsd(findCatalogModel(provider, model)!, {
    inputTokens: 1000,
    outputTokens: 500,
  })!;

describe('role chain resolution', () => {
  test('keeps chain order and skips entries whose key is gone', async () => {
    const ai = aiWith(
      {
        standard: [
          { provider: 'openai', model: 'gpt-6-luna' },
          { provider: 'anthropic', model: 'claude-haiku-5-5' },
          { provider: 'google', model: 'gemini-3.8-flash' },
        ],
      },
      {},
      { anthropic: 'k-anthropic-000000', google: 'k-google-0000000000' },
    );
    const chain = await ai.resolveRoleChain(USER, 'standard');
    expect(chain.map((entry) => `${entry.provider}:${entry.model}`)).toEqual([
      'anthropic:claude-haiku-5-5',
      'google:gemini-3.8-flash',
    ]);
  });

  test('standard borrows the fast chain only when its own chain is empty', async () => {
    const fast = [{ provider: 'openai' as const, model: 'gpt-6-luna' }];
    const borrowed = aiWith({ fast }, {});
    expect((await borrowed.resolveRoleChain(USER, 'standard'))[0]!.model).toBe('gpt-6-luna');
    const own = aiWith({ fast, standard: [{ provider: 'xai', model: 'grok-4.3' }] }, {});
    const chain = await own.resolveRoleChain(USER, 'standard');
    expect(chain.map((entry) => entry.model)).toEqual(['grok-4.3']);
  });

  test('vision and stt never borrow another role', async () => {
    const ai = aiWith(ANTHROPIC_THEN_GOOGLE, {});
    await expect(ai.resolveRoleChain(USER, 'vision')).rejects.toMatchObject({
      code: 'AI_NOT_CONFIGURED',
    });
    await expect(ai.resolveRoleChain(USER, 'stt')).rejects.toMatchObject({
      code: 'STT_NOT_CONFIGURED',
    });
  });
});

describe('generateStructured fallback', () => {
  test.each([
    ['quota 429', () => failing(429, '{"error":{"message":"You exceeded your current quota"}}')],
    ['rate limit 429', () => failing(429, '{"error":{"type":"rate_limit_error"}}')],
    ['auth 401', () => failing(401)],
    ['retired model 404', () => failing(404)],
    ['per-entry timeout', () => throwing(new DOMException('timed out', 'TimeoutError'))],
  ])('primary %s → the secondary answers and is recorded', async (_label, primary) => {
    const google = answering('{"title":"Gemini"}');
    const ai = aiWith(ANTHROPIC_THEN_GOOGLE, { anthropic: primary(), google });
    const result = await generate(ai);
    expect(result.output.title).toBe('Gemini');
    expect(result.modelRef).toBe('google:gemini-3.5-flash-lite');
    expect(google.doGenerateCalls).toHaveLength(1);
    // A rejected request reports no usage, so only the answering call is billed.
    expect(result.costUsd).toBeCloseTo(textCost('google', 'gemini-3.5-flash-lite'), 10);
  });

  test('schema failure retries once on the entry, then falls back and sums every cost', async () => {
    const anthropic = answering('not json');
    const google = answering('{"title":"Gemini"}');
    const ai = aiWith(ANTHROPIC_THEN_GOOGLE, { anthropic, google });
    const result = await generate(ai);
    expect(anthropic.doGenerateCalls).toHaveLength(2);
    expect(result.modelRef).toBe('google:gemini-3.5-flash-lite');
    expect(result.usage).toEqual({ inputTokens: 1000, outputTokens: 500 });
    expect(result.costUsd).toBeCloseTo(
      2 * textCost('anthropic', 'claude-haiku-5-5') + textCost('google', 'gemini-3.5-flash-lite'),
      10,
    );
  });

  test('a caller abort during the first entry stops the chain', async () => {
    const controller = new AbortController();
    const anthropic = new MockLanguageModelV4({
      doGenerate: async () => {
        controller.abort();
        throw new DOMException('aborted', 'AbortError');
      },
    });
    const google = answering('{"title":"Gemini"}');
    const ai = aiWith(ANTHROPIC_THEN_GOOGLE, { anthropic, google });
    await expect(generate(ai, { signal: controller.signal })).rejects.toMatchObject({
      code: 'TIMEOUT',
      provider: 'anthropic',
    });
    expect(google.doGenerateCalls).toHaveLength(0);
  });

  test('when every entry fails, the last entry error is thrown', async () => {
    const ai = aiWith(ANTHROPIC_THEN_GOOGLE, { anthropic: failing(401), google: failing(402) });
    const error = (await generate(ai).catch((caught: unknown) => caught)) as AiError;
    expect(error.code).toBe('LLM_QUOTA');
    expect(error.provider).toBe('google');
  });

  test('an entry that cannot take images is skipped for the next one', async () => {
    const haiku = findCatalogModel('anthropic', 'claude-haiku-5-5')!;
    const original = haiku.vision;
    (haiku as { vision: boolean }).vision = false;
    try {
      const anthropic = answering('{"title":"Haiku"}');
      const google = answering('{"title":"Gemini"}');
      const ai = aiWith(ANTHROPIC_THEN_GOOGLE, { anthropic, google });
      const result = await generate(ai, { image: true });
      expect(result.modelRef).toBe('google:gemini-3.5-flash-lite');
      expect(anthropic.doGenerateCalls).toHaveLength(0);
    } finally {
      (haiku as { vision: boolean }).vision = original;
    }
  });

  test('vision chain failures never reach a text-only chain', async () => {
    const anthropic = failing(429);
    const google = answering('{"title":"Gemini"}');
    const ai = aiWith(
      { vision: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }], ...ANTHROPIC_THEN_GOOGLE },
      { anthropic, google },
    );
    await expect(generate(ai, { role: 'vision', image: true })).rejects.toMatchObject({
      provider: 'anthropic',
    });
    expect(google.doGenerateCalls).toHaveLength(0);
  });
});

describe('transcribeAudio fallback', () => {
  const chunks = [
    { data: new Uint8Array([1]), mime: 'audio/mpeg', startSec: 0 },
    { data: new Uint8Array([2]), mime: 'audio/mpeg', startSec: 600 },
  ];

  function sttModel(failOnCall: number | null, label: string): MockTranscriptionModelV4 {
    let call = 0;
    return new MockTranscriptionModelV4({
      doGenerate: async () => {
        call += 1;
        if (call === failOnCall) {
          throw new APICallError({
            message: 'HTTP 503',
            url: 'https://example.invalid',
            requestBodyValues: {},
            statusCode: 503,
            isRetryable: false,
          });
        }
        return {
          text: `${label} ${call}.`,
          segments: [{ text: `${label} ${call}.`, startSecond: 0, endSecond: 600 }],
          language: 'pt',
          durationInSeconds: 600,
          warnings: [],
          response: { timestamp: new Date(), modelId: label },
        };
      },
    });
  }

  test('restarts the whole audio on the next entry and sums every attempt', async () => {
    const openai = sttModel(2, 'openai');
    const xai = sttModel(null, 'xai');
    const ai = createAiClient({
      getReasoning: async () => ({ fast: 'medium', standard: 'medium', vision: 'medium' }),
      getRoles: async () => ({
        stt: [
          { provider: 'openai', model: 'gpt-transcribe' },
          { provider: 'xai', model: 'grok-voice-transcribe-2.0' },
        ],
      }),
      getKey: async () => 'k-test-000000000000',
      transcriptionModel: (resolved) => (resolved.provider === 'openai' ? openai : xai),
    });
    const result = await ai.transcribeAudio({ userId: USER, chunks });
    expect(result.model).toBe('xai:grok-voice-transcribe-2.0');
    expect(result.text).toBe('xai 1.\nxai 2.');
    expect(result.segments.map((segment) => segment.startSec)).toEqual([0, 600]);
    const openaiChunk = estimateSttCostUsd(findCatalogModel('openai', 'gpt-transcribe')!, 600)!;
    const xaiAudio = estimateSttCostUsd(
      findCatalogModel('xai', 'grok-voice-transcribe-2.0')!,
      1200,
    )!;
    expect(result.costUsd).toBeCloseTo(openaiChunk + xaiAudio, 7);
  });
});

describe('stored chains', () => {
  test('reads the legacy single-entry shape as a one-entry chain', () => {
    const legacy = JSON.stringify({
      standard: { provider: 'anthropic', model: 'claude-haiku-5-5' },
      stt: { provider: 'openai', model: 'gpt-transcribe' },
    });
    expect(parseModelRoles(legacy)).toEqual({
      standard: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }],
      stt: [{ provider: 'openai', model: 'gpt-transcribe' }],
    });
  });

  test('drops unknown, wrong-role and duplicate entries and caps chains at 4', () => {
    const raw = JSON.stringify({
      standard: [
        { provider: 'anthropic', model: 'claude-haiku-5-5' },
        { provider: 'anthropic', model: 'claude-haiku-5-5' },
        { provider: 'openai', model: 'gpt-0-imaginary' },
        { provider: 'openai', model: 'gpt-transcribe' },
        { provider: 'google', model: 'gemini-3.5-flash-lite' },
        { provider: 'google', model: 'gemini-3.8-flash' },
        { provider: 'openai', model: 'gpt-6-luna' },
        { provider: 'xai', model: 'grok-4.3' },
      ],
      vision: 'garbage',
    });
    expect(parseModelRoles(raw).standard?.map((entry) => entry.model)).toEqual([
      'claude-haiku-5-5',
      'gemini-3.5-flash-lite',
      'gemini-3.8-flash',
      'gpt-6-luna',
    ]);
    expect(parseModelRoles(raw).vision).toBeUndefined();
    expect(parseModelRoles('not json')).toEqual({});
  });
});
