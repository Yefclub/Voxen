import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { estimateSttCostUsd, findCatalogModel, type ReasoningEffort } from './catalog';
import { createAiClient, type AiClientDependencies } from './client';
import type { ModelRoles } from './credentials';
import { AiError, redactSecrets } from './errors';
import { createKeyProbe } from './probe';

const USER = 'user-a';
const KEY = 'AIzaSyGeminiTESTkey_1234567890abcdefg';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

type Captured = { url: string; body: Record<string, unknown>; headers: Headers };

function geminiFetch(captured: Captured[], respond: (url: string) => Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    captured.push({
      url,
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      headers: new Headers(init?.headers),
    });
    return respond(url);
  }) as typeof fetch;
}

function client(
  roles: ModelRoles,
  fetchImpl: typeof fetch,
  effort: ReasoningEffort = 'medium',
): ReturnType<typeof createAiClient> {
  const deps: AiClientDependencies = {
    getRoles: async () => roles,
    getReasoning: async () => ({ fast: effort, standard: effort, vision: effort }),
    getKey: async () => KEY,
    fetch: fetchImpl,
  };
  return createAiClient(deps);
}

const Summary = z.object({ title: z.string() });

describe('Gemini text and vision', () => {
  test('calls the fixed generateContent endpoint with header auth, no tools, medium thinking', async () => {
    const captured: Captured[] = [];
    const ai = client(
      { standard: [{ provider: 'google', model: 'gemini-3.5-flash-lite' }] },
      geminiFetch(captured, () =>
        Response.json({
          candidates: [
            {
              content: { role: 'model', parts: [{ text: '{"title":"Ok"}' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 1000,
            candidatesTokenCount: 500,
            totalTokenCount: 1500,
          },
        }),
      ),
    );
    const result = await ai.generateStructured({
      userId: USER,
      role: 'standard',
      instructions: 'Summarize.',
      untrusted: [{ text: 'content' }],
      schema: Summary,
      maxOutputTokens: 400,
    });
    expect(result.output).toEqual({ title: 'Ok' });
    expect(result.modelRef).toBe('google:gemini-3.5-flash-lite');
    // Flash-Lite: $0.30 in / $2.50 out per 1M tokens.
    expect(result.costUsd).toBeCloseTo((1000 * 0.3 + 500 * 2.5) / 1_000_000, 10);

    const request = captured[0]!;
    expect(request.url).toBe(`${BASE}/models/gemini-3.5-flash-lite:generateContent`);
    expect(request.url).not.toContain(KEY);
    expect(request.headers.get('x-goog-api-key')).toBe(KEY);
    expect(request.headers.get('authorization')).toBeNull();
    expect(request.body.tools).toBeUndefined();
    expect(request.body.toolConfig).toBeUndefined();
    const config = request.body.generationConfig as Record<string, unknown>;
    expect(config.thinkingConfig).toEqual({ thinkingLevel: 'medium' });
    // 400 requested + the 6k medium reasoning allowance.
    expect(config.maxOutputTokens).toBe(6_400);
    expect(config.temperature).toBeUndefined();
  });

  test.each([
    ['gemini-3.5-flash-lite', 'off', 'minimal'],
    ['gemini-3.8-flash', 'off', 'low'],
    ['gemini-3.8-flash', 'low', 'low'],
    ['gemini-3.8-flash', 'high', 'high'],
  ] as const)('%s with effort %s sends thinking level %s', async (model, effort, level) => {
    const captured: Captured[] = [];
    const ai = client(
      { standard: [{ provider: 'google', model }] },
      geminiFetch(captured, () => new Response('{}', { status: 404 })),
      effort,
    );
    await ai
      .generateStructured({
        userId: USER,
        role: 'standard',
        instructions: 'x',
        untrusted: [{ text: 'y' }],
        schema: Summary,
        maxOutputTokens: 100,
      })
      .catch(() => undefined);
    const config = captured[0]!.body.generationConfig as Record<string, unknown>;
    expect(config.thinkingConfig).toEqual({ thinkingLevel: level });
  });

  test('a 400 API_KEY_INVALID maps to LLM_AUTH without echoing the key', async () => {
    const ai = client(
      { standard: [{ provider: 'google', model: 'gemini-3.5-flash-lite' }] },
      geminiFetch([], () =>
        Response.json(
          {
            error: {
              code: 400,
              message: `API key not valid. Please pass a valid API key. ${KEY}`,
              status: 'INVALID_ARGUMENT',
              details: [{ reason: 'API_KEY_INVALID' }],
            },
          },
          { status: 400 },
        ),
      ),
    );
    const error = (await ai
      .generateStructured({
        userId: USER,
        role: 'standard',
        instructions: 'x',
        untrusted: [{ text: 'y' }],
        schema: Summary,
        maxOutputTokens: 100,
      })
      .catch((caught: unknown) => caught)) as AiError;
    expect(error).toBeInstanceOf(AiError);
    expect(error.code).toBe('LLM_AUTH');
    expect(error.provider).toBe('google');
    expect(error.message).not.toContain(KEY);
  });

  test('redacts AIza keys from free text', () => {
    expect(redactSecrets(`key=${KEY} and ${KEY}`)).not.toContain(KEY);
    expect(redactSecrets(`plain ${KEY} text`)).toBe('plain [redacted] text');
  });
});

describe('Gemini speech-to-text', () => {
  test('uses the pinned SDK transcription model on the fixed Interactions endpoint', async () => {
    const captured: Captured[] = [];
    const ai = client(
      { stt: [{ provider: 'google', model: 'gemini-3.5-transcribe' }] },
      geminiFetch(captured, () =>
        Response.json({
          status: 'completed',
          steps: [
            {
              type: 'model_output',
              content: [
                {
                  type: 'text',
                  text: 'Olá mundo.',
                  annotations: [
                    { type: 'word_info', text: 'Olá', start_offset: '0.5s', end_offset: '0.9s' },
                    { type: 'word_info', text: 'mundo.', start_offset: '1s', end_offset: '1.4s' },
                  ],
                },
              ],
            },
          ],
          usage: { total_input_tokens: 1500, total_output_tokens: 20 },
        }),
      ),
    );
    const result = await ai.transcribeAudio({
      userId: USER,
      chunks: [
        { data: new Uint8Array([0xff, 0xfb, 0x90, 0x00]), mime: 'audio/mpeg', startSec: 60 },
      ],
      language: 'pt-BR',
    });

    const request = captured[0]!;
    expect(request.url).toBe(`${BASE}/interactions`);
    expect(request.url).not.toContain(KEY);
    expect(request.headers.get('x-goog-api-key')).toBe(KEY);
    expect(request.body.model).toBe('gemini-3.5-transcribe');
    const input = (request.body.input as Array<Record<string, unknown>>)[0]!;
    expect(input.type).toBe('audio');
    expect(input.data).toBe(Buffer.from([0xff, 0xfb, 0x90, 0x00]).toString('base64'));
    expect(request.body.generation_config).toEqual({
      transcription_config: {
        language_codes: ['pt-BR'],
        mode: { type: 'verbatim', timestamp_granularities: ['word'] },
      },
    });
    expect(request.body.tools).toBeUndefined();

    expect(result.model).toBe('google:gemini-3.5-transcribe');
    expect(result.text).toBe('Olá mundo.');
    // Word timings are merged into a sentence and offset by the chunk start.
    expect(result.segments).toEqual([{ startSec: 60.5, endSec: 61.4, text: 'Olá mundo.' }]);
    // Token usage wins over the per-minute estimate: $2 / 1M in, $12 / 1M out.
    expect(result.costUsd).toBeCloseTo((1500 * 2 + 20 * 12) / 1_000_000, 10);
  });

  test('falls back to the per-minute rate when no usage is reported', () => {
    const model = findCatalogModel('google', 'gemini-3.5-transcribe')!;
    expect(estimateSttCostUsd(model, 120, null)).toBeCloseTo(0.01, 10);
    expect(estimateSttCostUsd(model, 120, { inputTokens: 3000, outputTokens: 100 })).toBeCloseTo(
      (3000 * 2 + 100 * 12) / 1_000_000,
      10,
    );
  });
});

describe('Gemini key probe', () => {
  function probeWith(status: number, seen: Captured[] = [], body = '{}') {
    return createKeyProbe(geminiFetch(seen, () => new Response(body, { status })));
  }

  test('lists models with the key only in the x-goog-api-key header', async () => {
    const seen: Captured[] = [];
    expect(await probeWith(200, seen)('google', KEY)).toEqual({ status: 'valid', error: null });
    expect(seen[0]!.url).toBe(`${BASE}/models`);
    expect(seen[0]!.url).not.toContain(KEY);
    expect(seen[0]!.headers.get('x-goog-api-key')).toBe(KEY);
    expect(seen[0]!.headers.get('authorization')).toBeNull();
  });

  test('400, 401 and 403 are invalid without reading the body; 5xx is unknown', async () => {
    for (const status of [400, 401, 403]) {
      expect(await probeWith(status)('google', KEY)).toEqual({
        status: 'invalid',
        error: `HTTP_${status}`,
      });
    }
    expect(await probeWith(503)('google', KEY)).toEqual({ status: 'unknown', error: 'HTTP_503' });
  });
});
