import { describe, expect, it } from 'bun:test';
import { hasCanonicalOpenRouterModels } from '../src/lib/model-defaults';
import {
  inspectOpenRouterAccount,
  listUserModels,
  OpenrouterError,
  validateApiKey,
} from '../src/lib/openrouter';

describe('OpenRouter user model catalog', () => {
  it('uses the key-filtered catalog endpoint', async () => {
    let requestedUrl = '';
    let authorization = '';
    let requestSignal: AbortSignal | null | undefined;
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      requestSignal = init?.signal;
      return Response.json({ data: [{ id: 'x-ai/grok-4.5', name: 'Grok 4.5' }] });
    }) as typeof fetch;
    const models = await listUserModels('sk-or-test', fetcher);

    expect(requestedUrl).toBe('https://openrouter.ai/api/v1/models/user');
    expect(authorization).toBe('Bearer sk-or-test');
    expect(requestSignal).toBeInstanceOf(AbortSignal);
    expect(models.map((model) => model.id)).toEqual(['x-ai/grok-4.5']);
  });

  it('limits setup validation and returns an actionable timeout without leaking details', async () => {
    let requestSignal: AbortSignal | null | undefined;
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal;
      throw new DOMException('sk-or-sensitive upstream detail', 'TimeoutError');
    }) as unknown as typeof fetch;

    const error = await validateApiKey('sk-or-sensitive', fetcher).catch((reason) => reason);

    expect(requestSignal).toBeInstanceOf(AbortSignal);
    expect(error).toBeInstanceOf(OpenrouterError);
    expect(String((error as Error).message)).toContain('15 segundos');
    expect(String((error as Error).message)).not.toContain('sk-or-sensitive');
    expect(String((error as Error).message)).not.toContain('upstream detail');
  });

  it('shares one total deadline between key and catalog validation', async () => {
    const requestSignals: Array<AbortSignal | null | undefined> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestSignals.push(init?.signal);
      if (String(input).endsWith('/key')) return new Response('{}', { status: 200 });
      return Response.json({ data: [{ id: 'x-ai/grok-4.5' }] });
    }) as typeof fetch;

    const inspection = await inspectOpenRouterAccount('sk-or-test', fetcher);

    expect(inspection.valid).toBe(true);
    expect(requestSignals).toHaveLength(2);
    expect(requestSignals[0]).toBeInstanceOf(AbortSignal);
    expect(requestSignals[1]).toBe(requestSignals[0]);
  });

  it('accepts the canonical STT model when the account catalog omits input modalities', () => {
    expect(
      hasCanonicalOpenRouterModels([
        {
          id: 'x-ai/grok-4.5',
          architecture: {
            input_modalities: ['text', 'image', 'file'],
            output_modalities: ['text'],
          },
        },
        {
          id: 'x-ai/grok-stt-1.0',
          architecture: { output_modalities: ['transcription'] },
        },
      ]),
    ).toBe(true);
  });

  it('rejects missing or incompatible canonical resources', () => {
    expect(
      hasCanonicalOpenRouterModels([
        {
          id: 'x-ai/grok-4.5',
          architecture: {
            input_modalities: ['text', 'image'],
            output_modalities: ['text'],
          },
        },
        {
          id: 'x-ai/grok-stt-1.0',
          architecture: { output_modalities: ['text'] },
        },
      ]),
    ).toBe(false);
  });
});
