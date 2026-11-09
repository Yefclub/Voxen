import { describe, expect, test } from 'bun:test';
import { createKeyProbe } from './probe';

const KEY = 'sk-ant-api03-probeTESTkey-0000000000';

function fetchReturning(status: number, seen: Array<{ url: string; headers: Headers }> = []) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response('{}', { status });
  }) as typeof fetch;
}

describe('probeProviderKey', () => {
  test('uses the fixed endpoint and auth header of each provider', async () => {
    const seen: Array<{ url: string; headers: Headers }> = [];
    const probe = createKeyProbe(fetchReturning(200, seen));
    for (const provider of ['openai', 'anthropic', 'xai', 'openrouter'] as const) {
      expect(await probe(provider, KEY)).toEqual({ status: 'valid', error: null });
    }
    expect(seen.map((request) => request.url)).toEqual([
      'https://api.openai.com/v1/models',
      'https://api.anthropic.com/v1/models',
      'https://api.x.ai/v1/models',
      'https://openrouter.ai/api/v1/key',
    ]);
    expect(seen[0]!.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(seen[1]!.headers.get('x-api-key')).toBe(KEY);
    expect(seen[1]!.headers.get('anthropic-version')).toBe('2023-06-01');
    expect(seen[1]!.headers.get('authorization')).toBeNull();
  });

  test('401/403 are invalid; 5xx and network failures are unknown', async () => {
    expect(await createKeyProbe(fetchReturning(401))('openai', KEY)).toEqual({
      status: 'invalid',
      error: 'HTTP_401',
    });
    expect((await createKeyProbe(fetchReturning(403))('xai', KEY)).status).toBe('invalid');
    expect(await createKeyProbe(fetchReturning(503))('openai', KEY)).toEqual({
      status: 'unknown',
      error: 'HTTP_503',
    });
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await createKeyProbe(offline)('anthropic', KEY)).toEqual({
      status: 'unknown',
      error: 'PROBE_NETWORK',
    });
    const slow = (async () => {
      throw new DOMException('timed out', 'TimeoutError');
    }) as unknown as typeof fetch;
    expect((await createKeyProbe(slow)('openrouter', KEY)).error).toBe('PROBE_TIMEOUT');
  });
});
