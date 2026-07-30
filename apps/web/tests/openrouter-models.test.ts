import { describe, expect, it } from 'bun:test';
import { hasCanonicalOpenRouterModels } from '../src/lib/model-defaults';
import { listUserModels } from '../src/lib/openrouter';

describe('OpenRouter user model catalog', () => {
  it('uses the key-filtered catalog endpoint', async () => {
    let requestedUrl = '';
    let authorization = '';
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      return Response.json({ data: [{ id: 'x-ai/grok-4.5', name: 'Grok 4.5' }] });
    }) as typeof fetch;
    const models = await listUserModels('sk-or-test', fetcher);

    expect(requestedUrl).toBe('https://openrouter.ai/api/v1/models/user');
    expect(authorization).toBe('Bearer sk-or-test');
    expect(models.map((model) => model.id)).toEqual(['x-ai/grok-4.5']);
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
