import { describe, expect, test } from 'bun:test';
import { CaptureError } from './errors';
import { createCaptureWorkerClient } from './worker-client';

const CONFIG = { baseUrl: 'http://capture-worker:8080', token: 't'.repeat(64) };

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  const seen: Request[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push(new Request(input, init));
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  }) as typeof fetch;
  return { impl, seen };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(CaptureError);
  return (error as CaptureError).code;
}

describe('capture worker client', () => {
  test('sends the bearer token to the fixed worker URL and never follows redirects', async () => {
    const { impl, seen } = respond(200, { platform: 'web', text: 'x', images: [], segments: [] });
    await createCaptureWorkerClient(CONFIG, impl).extract(
      'https://example.com/a',
      AbortSignal.timeout(1000),
    );
    expect(seen[0]!.url).toBe('http://capture-worker:8080/v1/extract');
    expect(seen[0]!.headers.get('authorization')).toBe(`Bearer ${CONFIG.token}`);
    expect(seen[0]!.redirect).toBe('error');
    expect(await seen[0]!.json()).toEqual({ url: 'https://example.com/a' });
  });

  test('maps worker error bodies to capture codes and keeps their retry flag', async () => {
    const { impl } = respond(422, { error: { code: 'LOGIN_REQUIRED', retryable: false } });
    expect(
      await codeOf(
        createCaptureWorkerClient(CONFIG, impl).extract(
          'https://x.example',
          AbortSignal.timeout(1000),
        ),
      ),
    ).toBe('LOGIN_REQUIRED');
    const limited = respond(503, { error: { code: 'RATE_LIMITED', retryable: true } });
    const error = await createCaptureWorkerClient(CONFIG, limited.impl)
      .extract('https://x.example', AbortSignal.timeout(1000))
      .catch((caught: CaptureError) => caught);
    expect(error).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
  });

  test('treats auth rejections and 5xx without a body as WORKER_UNAVAILABLE', async () => {
    expect(
      await codeOf(
        createCaptureWorkerClient(CONFIG, respond(401, {}).impl).extract(
          'https://x.example',
          AbortSignal.timeout(1000),
        ),
      ),
    ).toBe('WORKER_UNAVAILABLE');
    expect(
      await codeOf(
        createCaptureWorkerClient(CONFIG, respond(502, 'bad gateway').impl).extract(
          'https://x.example',
          AbortSignal.timeout(1000),
        ),
      ),
    ).toBe('WORKER_UNAVAILABLE');
  });

  test('reports WORKER_UNAVAILABLE when unconfigured or unreachable', async () => {
    expect(
      await codeOf(
        createCaptureWorkerClient(null).extract('https://x.example', AbortSignal.timeout(1000)),
      ),
    ).toBe('WORKER_UNAVAILABLE');
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(
      await codeOf(
        createCaptureWorkerClient(CONFIG, offline).extract(
          'https://x.example',
          AbortSignal.timeout(1000),
        ),
      ),
    ).toBe('WORKER_UNAVAILABLE');
  });

  test('maps an aborted call to TIMEOUT', async () => {
    const hanging = ((_input: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      })) as unknown as typeof fetch;
    expect(
      await codeOf(
        createCaptureWorkerClient(CONFIG, hanging).audio(
          'https://x.example',
          AbortSignal.timeout(20),
        ),
      ),
    ).toBe('TIMEOUT');
  });

  test('refuses oversized responses by declared length', async () => {
    const { impl } = respond(200, {}, { 'content-length': String(500 * 1024 * 1024) });
    expect(
      await codeOf(
        createCaptureWorkerClient(CONFIG, impl).audio(
          'https://x.example',
          AbortSignal.timeout(1000),
        ),
      ),
    ).toBe('TOO_LARGE');
  });
});
