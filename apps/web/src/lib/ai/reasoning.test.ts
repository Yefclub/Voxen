import { describe, expect, test } from 'bun:test';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';
import { effectiveMaxOutputTokens, REASONING_OUTPUT_ALLOWANCE } from './call-options';
import {
  AI_CATALOG,
  estimateTextCostUsd,
  findCatalogModel,
  type AiProvider,
  type ReasoningEffort,
} from './catalog';
import { createAiClient } from './client';
import { parseModelSettings } from './credentials';

const Schema = z.object({ title: z.string() });

/** Captures the JSON body the provider object sends for one standard-role call. */
async function wireBody(
  provider: AiProvider,
  model: string,
  effort: ReasoningEffort,
  maxOutputTokens = 100,
): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  const ai = createAiClient({
    getRoles: async () => ({ standard: [{ provider, model }] }),
    getReasoning: async () => ({ fast: 'medium', standard: effort, vision: 'medium' }),
    getKey: async () => 'k-test-0000000000000',
    fetch: (async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response('{}', { status: 404 });
    }) as typeof fetch,
  });
  await ai
    .generateStructured({
      userId: 'u',
      role: 'standard',
      instructions: 'x',
      untrusted: [{ text: 'y' }],
      schema: Schema,
      maxOutputTokens,
    })
    .catch(() => undefined);
  return body;
}

const EFFORTS: ('low' | 'medium' | 'high')[] = ['low', 'medium', 'high'];

describe('reasoning effort on the wire', () => {
  test.each(EFFORTS)('OpenAI and xAI send reasoning.effort=%s', async (effort) => {
    for (const [provider, model] of [
      ['openai', 'gpt-6-luna'],
      ['xai', 'grok-4.3'],
    ] as const) {
      const body = await wireBody(provider, model, effort);
      expect((body.reasoning as { effort: string }).effort).toBe(effort);
      expect(body.store).toBe(false);
      expect(body.temperature).toBeUndefined();
      expect(body.max_output_tokens).toBe(100 + REASONING_OUTPUT_ALLOWANCE[effort]);
    }
  });

  test.each(EFFORTS)('Anthropic uses adaptive thinking with effort=%s', async (effort) => {
    const body = await wireBody('anthropic', 'claude-haiku-5-5', effort);
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'omitted' });
    expect((body.output_config as { effort: string }).effort).toBe(effort);
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBe(100 + REASONING_OUTPUT_ALLOWANCE[effort]);
  });

  test.each(EFFORTS)(
    'OpenRouter sends reasoning.effort=%s and keeps routing rules',
    async (effort) => {
      const body = await wireBody('openrouter', 'anthropic/claude-haiku-5.5', effort);
      expect(body.reasoning).toEqual({ effort, exclude: true });
      expect(body.provider).toEqual({ require_parameters: true, data_collection: 'deny' });
    },
  );

  test('off sends each provider minimum and no allowance', async () => {
    const openai = await wireBody('openai', 'gpt-6-luna', 'off');
    expect(openai.reasoning).toEqual({ effort: 'none' });
    expect(openai.max_output_tokens).toBe(100);
    expect((await wireBody('xai', 'grok-4.3', 'off')).reasoning).toEqual({ effort: 'none' });
    expect((await wireBody('openrouter', 'openai/gpt-6-luna', 'off')).reasoning).toEqual({
      effort: 'none',
      exclude: true,
    });
    const haiku = await wireBody('anthropic', 'claude-haiku-5-5', 'off');
    expect(haiku.thinking).toEqual({ type: 'disabled' });
    expect((haiku.output_config as { effort?: string } | undefined)?.effort).toBeUndefined();
    // Sonnet 5.5 cannot disable thinking; the SDK sends its lowest setting.
    const sonnet = await wireBody('anthropic', 'claude-sonnet-5-5', 'off');
    expect(sonnet.thinking).toEqual({ type: 'between_tools' });
  });

  test('a model flagged reasoning:false gets no reasoning field and no allowance', async () => {
    const model = findCatalogModel('openrouter', 'deepseek/deepseek-v4.1-flash')!;
    (model as { reasoning: boolean }).reasoning = false;
    try {
      const body = await wireBody('openrouter', model.id, 'high');
      expect(body.reasoning).toBeUndefined();
      expect(body.max_tokens).toBe(100);
      expect(body.provider).toEqual({ require_parameters: true, data_collection: 'deny' });
    } finally {
      (model as { reasoning: boolean }).reasoning = true;
    }
  });
});

describe('output allowance and cost', () => {
  test('adds the allowance per effort and caps at the model maximum', () => {
    const lite = findCatalogModel('google', 'gemini-3.5-flash-lite')!;
    expect(effectiveMaxOutputTokens(lite, 2_000, 'off')).toBe(2_000);
    expect(effectiveMaxOutputTokens(lite, 2_000, 'low')).toBe(4_000);
    expect(effectiveMaxOutputTokens(lite, 2_000, 'medium')).toBe(8_000);
    expect(effectiveMaxOutputTokens(lite, 2_000, 'high')).toBe(18_000);
    expect(effectiveMaxOutputTokens(lite, 60_000, 'high')).toBe(65_536);
    expect(effectiveMaxOutputTokens({ reasoning: false, maxOutputTokens: null }, 500, 'high')).toBe(
      500,
    );
  });

  test('off still gets the low allowance where the provider keeps reasoning', () => {
    const flash = findCatalogModel('google', 'gemini-3.8-flash')!;
    expect(effectiveMaxOutputTokens(flash, 2_000, 'off', 'google')).toBe(4_000);
    const lite = findCatalogModel('google', 'gemini-3.5-flash-lite')!;
    expect(effectiveMaxOutputTokens(lite, 2_000, 'off', 'google')).toBe(4_000);
    const luna = findCatalogModel('openai', 'gpt-6-luna')!;
    expect(effectiveMaxOutputTokens(luna, 2_000, 'off', 'openai')).toBe(2_000);
  });

  test('every text model declares reasoning and a max output; STT models declare neither', () => {
    for (const catalog of Object.values(AI_CATALOG)) {
      for (const model of catalog.models) {
        const stt = model.roles.includes('stt');
        expect(model.maxOutputTokens === null).toBe(stt);
        if (stt) expect(model.reasoning).toBe(false);
      }
    }
  });

  test('reasoning tokens are billed as output', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text', text: '{"title":"Ok"}' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 1000, noCache: 1000, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 4500, text: 500, reasoning: 4000 },
        },
        warnings: [],
      }),
    });
    const ai = createAiClient({
      getRoles: async () => ({ standard: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }] }),
      getReasoning: async () => ({ fast: 'high', standard: 'high', vision: 'high' }),
      getKey: async () => 'k-test-0000000000000',
      languageModel: () => model,
    });
    const result = await ai.generateStructured({
      userId: 'u',
      role: 'standard',
      instructions: 'x',
      untrusted: [{ text: 'y' }],
      schema: Schema,
      maxOutputTokens: 100,
    });
    const haiku = findCatalogModel('anthropic', 'claude-haiku-5-5')!;
    expect(result.usage.outputTokens).toBe(4500);
    expect(result.costUsd).toBeCloseTo(
      estimateTextCostUsd(haiku, { inputTokens: 1000, outputTokens: 4500 })!,
      10,
    );
  });
});

describe('stored reasoning', () => {
  test('defaults every text role to medium and reads stored efforts', () => {
    expect(parseModelSettings(null).reasoning).toEqual({
      fast: 'medium',
      standard: 'medium',
      vision: 'medium',
    });
    const stored = JSON.stringify({
      chains: { fast: [{ provider: 'openai', model: 'gpt-6-luna' }] },
      reasoning: { fast: 'off', standard: 'high', vision: 'bogus', stt: 'high' },
    });
    const parsed = parseModelSettings(stored);
    expect(parsed.reasoning).toEqual({ fast: 'off', standard: 'high', vision: 'medium' });
    expect(parsed.chains).toEqual({ fast: [{ provider: 'openai', model: 'gpt-6-luna' }] });
  });

  test('a legacy role map keeps its entries and gets the default effort', () => {
    const legacy = JSON.stringify({ standard: { provider: 'xai', model: 'grok-4.3' } });
    expect(parseModelSettings(legacy)).toEqual({
      chains: { standard: [{ provider: 'xai', model: 'grok-4.3' }] },
      reasoning: { fast: 'medium', standard: 'medium', vision: 'medium' },
    });
  });
});
