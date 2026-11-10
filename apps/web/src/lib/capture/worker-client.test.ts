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

  test('defaults hasVideo, hasAudio and comments when the worker omits them', async () => {
    const { impl } = respond(200, { platform: 'web', text: 'x', images: [], segments: [] });
    const result = await createCaptureWorkerClient(CONFIG, impl).extract(
      'https://example.com/a',
      AbortSignal.timeout(1000),
    );
    expect(result).toMatchObject({ hasVideo: false, hasAudio: false, comments: [] });
  });

  test('keeps only bounded images and ranks comments defensively', async () => {
    const big = 'A'.repeat(2_200_000);
    const { impl } = respond(200, {
      platform: 'youtube',
      hasVideo: true,
      hasAudio: true,
      segments: [],
      images: [
        { kind: 'thumbnail', mime: 'image/svg+xml', dataBase64: 'PHN2Zz4=' },
        { kind: 'thumbnail', mime: 'image/jpeg', dataBase64: big },
        { kind: 'thumbnail', mime: 'image/jpeg', dataBase64: '/9j/' },
      ],
      comments: [
        { author: 'b', text: 'recent', likes: 3, publishedAt: '2026-11-02T00:00:00Z' },
        { author: 'c', text: 'unknown likes', likes: null, publishedAt: null },
        { author: 'a', text: 'top', likes: 10, publishedAt: null },
        { author: 'd', text: 'older', likes: 3, publishedAt: '2026-10-01T00:00:00Z' },
        { author: 'e', text: '   ', likes: 99, publishedAt: null },
        { author: 'f', text: 'x'.repeat(5_000), likes: 1, publishedAt: 'not a date' },
      ],
    });
    const result = await createCaptureWorkerClient(CONFIG, impl).extract(
      'https://youtu.be/x',
      AbortSignal.timeout(1000),
    );
    expect(result.images).toHaveLength(1);
    expect(result.images[0]!.mime).toBe('image/jpeg');
    expect(result.comments.map((c) => c.text.slice(0, 13))).toEqual([
      'top',
      'recent',
      'older',
      'x'.repeat(13),
      'unknown likes',
    ]);
    expect(result.comments[3]).toMatchObject({ publishedAt: null });
    expect(result.comments[3]!.text).toHaveLength(1_000);
  });

  test('requests audio and upload formats and normalizes keyframes', async () => {
    const audio = respond(200, { durationSec: 3, chunks: [] });
    const client = createCaptureWorkerClient(CONFIG, audio.impl);
    await client.audio('https://x.example', AbortSignal.timeout(1000), 'wav');
    expect(await audio.seen[0]!.json()).toEqual({ url: 'https://x.example', format: 'wav' });

    const upload = respond(200, { platform: 'other', images: [], segments: [] });
    await createCaptureWorkerClient(CONFIG, upload.impl).file(
      { body: new Blob(['x']), filename: 'a.mp4', contentType: 'video/mp4', format: 'wav' },
      AbortSignal.timeout(1000),
    );
    expect((await upload.seen[0]!.formData()).get('format')).toBe('wav');

    const frame = { kind: 'x', mime: 'image/jpeg', dataBase64: '/9j/', timeSec: 4.5 };
    const frames = respond(200, { durationSec: 20, images: Array(6).fill(frame) });
    const result = await createCaptureWorkerClient(CONFIG, frames.impl).frames(
      'https://x.example',
      AbortSignal.timeout(1000),
    );
    expect(frames.seen[0]!.url).toBe('http://capture-worker:8080/v1/frames');
    expect(result.durationSec).toBe(20);
    expect(result.images).toHaveLength(4);
    expect(result.images[0]).toMatchObject({ kind: 'frame', timeSec: 4.5 });
  });
});
