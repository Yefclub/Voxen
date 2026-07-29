import { describe, expect, it } from 'bun:test';
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
});
