import { describe, expect, test } from 'bun:test';
import { MockTranscriptionModelV4 } from 'ai/test';
import { estimateSttCostUsd, findCatalogModel } from './catalog';
import { createAiClient, type AudioChunk } from './client';
import { parseModelRoles, type ModelRoles } from './credentials';
import type { AiError } from './errors';
import { transcribeWithLocal } from './local-stt';
import {
  createLocalSttAvailability,
  LOCAL_STT_CACHE_MS,
  LOCAL_STT_HEALTH_TIMEOUT_MS,
  localSttBaseUrl,
} from './local-stt-availability';

const USER = 'user-local';
const BASE = 'http://stt-local:5092';
const LOCAL = { provider: 'local', model: 'parakeet-tdt-0.6b-v3' } as const;
const OPENAI = { provider: 'openai', model: 'gpt-transcribe' } as const;

const wav = (startSec: number): AudioChunk => ({
  data: new Uint8Array([82, 73, 70, 70]),
  mime: 'audio/wav',
  startSec,
});
const mp3 = (startSec: number): AudioChunk => ({
  data: new Uint8Array([73, 68, 51]),
  mime: 'audio/mpeg',
  startSec,
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const verbose = (label: string) => ({
  task: 'transcribe',
  language: 'pt',
  duration: 30,
  text: `${label} um. ${label} dois.`,
  segments: [
    { id: 0, start: 1.5, end: 4, text: ` ${label} um.` },
    { id: 1, start: 4.2, end: 9, text: ` ${label} dois.` },
  ],
});

interface Captured {
  url: string;
  init: RequestInit | undefined;
}

function sidecar(respond: (call: number) => Response | Promise<Response>) {
  const calls: Captured[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return respond(calls.length);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

/** Cloud STT stand-in that counts its calls. */
function cloudModel(label = 'openai') {
  const counter = { calls: 0 };
  const model = new MockTranscriptionModelV4({
    doGenerate: async () => {
      counter.calls += 1;
      return {
        text: `${label}.`,
        segments: [{ text: `${label}.`, startSecond: 0, endSecond: 5 }],
        language: 'pt',
        durationInSeconds: 30,
        warnings: [],
        response: { timestamp: new Date(), modelId: label },
      };
    },
  });
  return Object.assign(model, { counter });
}

function client(
  roles: ModelRoles,
  options: {
    fetch?: typeof fetch;
    endpoint?: string | null;
    cloud?: ReturnType<typeof cloudModel>;
  } = {},
) {
  return createAiClient({
    fetch: options.fetch,
    getRoles: async () => roles,
    getReasoning: async () => ({ fast: 'medium', standard: 'medium', vision: 'medium' }),
    getKey: async (_userId, provider) => (provider === 'openai' ? 'k-openai-0000000000' : null),
    localSttEndpoint: async () => (options.endpoint === undefined ? BASE : options.endpoint),
    transcriptionModel: () => options.cloud ?? cloudModel(),
  });
}

describe('STT_LOCAL_URL', () => {
  test('accepts http(s) base URLs and drops a trailing slash', () => {
    expect(localSttBaseUrl({ STT_LOCAL_URL: 'http://stt-local:5092/' })).toBe(BASE);
    expect(localSttBaseUrl({ STT_LOCAL_URL: ' https://stt.internal/base/ ' })).toBe(
      'https://stt.internal/base',
    );
  });

  test.each([
    ['unset', undefined],
    ['empty', '  '],
    ['not a URL', 'stt-local:5092'],
    ['file scheme', 'file:///etc/passwd'],
    ['credentials', 'http://user:pass@stt-local:5092'],
    ['query string', 'http://stt-local:5092?token=x'],
    ['fragment', 'http://stt-local:5092#x'],
  ])('rejects %s', (_label, value) => {
    expect(localSttBaseUrl({ STT_LOCAL_URL: value })).toBeNull();
  });
});

describe('local STT availability', () => {
  function availability(
    respond: () => Response | Promise<Response>,
    env: NodeJS.ProcessEnv = { STT_LOCAL_URL: BASE },
  ) {
    let clock = 1_000;
    const calls: Captured[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return respond();
    }) as typeof fetch;
    const subject = createLocalSttAvailability({ env, fetch: fetchImpl, now: () => clock });
    return { subject, calls, advance: (ms: number) => (clock += ms) };
  }

  test('is unavailable without STT_LOCAL_URL and never calls the network', async () => {
    const { subject, calls } = availability(() => jsonResponse({ status: 'ok' }), {});
    expect(await subject.isAvailable()).toBe(false);
    expect(await subject.endpoint()).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test('is available when /health answers ok, with a 2 s timeout and no redirects', async () => {
    const { subject, calls } = availability(() => jsonResponse({ status: 'ok' }));
    expect(await subject.endpoint()).toBe(BASE);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BASE}/health`);
    expect(calls[0]!.init?.redirect).toBe('error');
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    expect(LOCAL_STT_HEALTH_TIMEOUT_MS).toBe(2_000);
  });

  test.each([
    ['HTTP 503', () => jsonResponse({ status: 'loading' }, 503)],
    ['a body that is not ok', () => jsonResponse({ status: 'loading' })],
    ['a non-JSON body', () => new Response('ok')],
    [
      'a connection error',
      () => {
        throw new TypeError('fetch failed');
      },
    ],
  ])('is unavailable on %s', async (_label, respond) => {
    const { subject } = availability(respond);
    expect(await subject.isAvailable()).toBe(false);
  });

  test('caches both answers for 30 s per process', async () => {
    let healthy = true;
    const { subject, calls, advance } = availability(() =>
      healthy ? jsonResponse({ status: 'ok' }) : jsonResponse({}, 503),
    );
    expect(await subject.isAvailable()).toBe(true);
    healthy = false;
    advance(LOCAL_STT_CACHE_MS - 1);
    expect(await subject.isAvailable()).toBe(true);
    expect(calls).toHaveLength(1);
    advance(1);
    expect(await subject.isAvailable()).toBe(false);
    healthy = true;
    advance(LOCAL_STT_CACHE_MS - 1);
    expect(await subject.isAvailable()).toBe(false);
    expect(calls).toHaveLength(2);
    advance(1);
    expect(await subject.isAvailable()).toBe(true);
    expect(calls).toHaveLength(3);
  });

  test('concurrent callers share one health check', async () => {
    const { subject, calls } = availability(() => jsonResponse({ status: 'ok' }));
    const answers = await Promise.all([subject.isAvailable(), subject.isAvailable()]);
    expect(answers).toEqual([true, true]);
    expect(calls).toHaveLength(1);
  });
});

describe('local entries in the STT chain', () => {
  test('are skipped, not removed, while the sidecar is unavailable', async () => {
    const roles: ModelRoles = { stt: [{ ...LOCAL }, { ...OPENAI }] };
    const snapshot = JSON.stringify(roles);
    const down = client(roles, { endpoint: null });
    const chain = await down.resolveRoleChain(USER, 'stt');
    expect(chain.map((entry) => entry.provider)).toEqual(['openai']);
    expect(JSON.stringify(roles)).toBe(snapshot);

    const up = client(roles);
    const resolved = await up.resolveRoleChain(USER, 'stt');
    expect(resolved.map((entry) => entry.provider)).toEqual(['local', 'openai']);
    expect(resolved[0]).toMatchObject({ apiKey: '', baseUrl: BASE });
  });

  test('a chain of only unavailable local entries is not configured', async () => {
    const ai = client({ stt: [{ ...LOCAL }] }, { endpoint: null });
    await expect(ai.resolveRoleChain(USER, 'stt')).rejects.toMatchObject({
      code: 'STT_NOT_CONFIGURED',
    });
  });

  test('a stored local entry outside stt is ignored', async () => {
    const ai = client({ standard: [{ ...LOCAL }] });
    await expect(ai.resolveRoleChain(USER, 'standard')).rejects.toMatchObject({
      code: 'AI_NOT_CONFIGURED',
    });
  });
});

describe('local STT transport', () => {
  test('posts WAV multipart to the sidecar and offsets segments by chunk start', async () => {
    const { calls, fetchImpl } = sidecar((call) => jsonResponse(verbose(`parte ${call}`)));
    const ai = client({ stt: [{ ...LOCAL }] }, { fetch: fetchImpl });
    const result = await ai.transcribeAudio({
      userId: USER,
      chunks: [wav(480), wav(0)],
      language: 'pt',
    });

    expect(calls).toHaveLength(2);
    for (const { url, init } of calls) {
      expect(url).toBe(`${BASE}/v1/audio/transcriptions`);
      expect(init?.method).toBe('POST');
      expect(init?.redirect).toBe('error');
      const form = init?.body as FormData;
      expect(form).toBeInstanceOf(FormData);
      const file = form.get('file') as File;
      expect(file.type).toBe('audio/wav');
      expect(file.name).toBe('chunk.wav');
      expect(form.get('language')).toBe('pt');
      expect(form.get('response_format')).toBe('verbose_json');
      expect(form.get('model')).toBe('parakeet-tdt-0.6b-v3');
      // No credential of any kind goes to the sidecar.
      expect(JSON.stringify(init?.headers ?? {})).not.toMatch(/authorization|api-key/i);
    }
    expect(result.model).toBe('local:parakeet-tdt-0.6b-v3');
    expect(result.costUsd).toBe(0);
    expect(result.language).toBe('pt');
    expect(result.text).toBe('parte 1 um. parte 1 dois.\nparte 2 um. parte 2 dois.');
    expect(result.segments).toEqual([
      { startSec: 1.5, endSec: 4, text: 'parte 1 um.' },
      { startSec: 4.2, endSec: 9, text: 'parte 1 dois.' },
      { startSec: 481.5, endSec: 484, text: 'parte 2 um.' },
      { startSec: 484.2, endSec: 489, text: 'parte 2 dois.' },
    ]);
  });

  test('omits language when it is unknown', async () => {
    const { calls, fetchImpl } = sidecar(() => jsonResponse(verbose('x')));
    await client({ stt: [{ ...LOCAL }] }, { fetch: fetchImpl }).transcribeAudio({
      userId: USER,
      chunks: [wav(0)],
    });
    expect((calls[0]!.init?.body as FormData).has('language')).toBe(false);
  });

  test('an MP3 chunk fails the local entry without a call and the chain falls back', async () => {
    const { calls, fetchImpl } = sidecar(() => jsonResponse(verbose('local')));
    const cloud = cloudModel();
    const ai = client({ stt: [{ ...LOCAL }, { ...OPENAI }] }, { fetch: fetchImpl, cloud });
    const result = await ai.transcribeAudio({ userId: USER, chunks: [wav(0), mp3(480)] });
    expect(calls).toHaveLength(0);
    expect(cloud.counter.calls).toBe(2);
    expect(result.model).toBe('openai:gpt-transcribe');

    const only = client({ stt: [{ ...LOCAL }] }, { fetch: fetchImpl });
    await expect(only.transcribeAudio({ userId: USER, chunks: [mp3(0)] })).rejects.toMatchObject({
      code: 'LLM_FAILED',
      provider: 'local',
    });
    expect(calls).toHaveLength(0);
  });

  test('the transport itself refuses non-WAV audio', async () => {
    const { calls, fetchImpl } = sidecar(() => jsonResponse(verbose('x')));
    await expect(
      transcribeWithLocal(BASE, mp3(0), undefined, new AbortController().signal, fetchImpl),
    ).rejects.toMatchObject({ code: 'LLM_FAILED', provider: 'local' });
    expect(calls).toHaveLength(0);
  });

  test.each([
    ['HTTP 503', () => jsonResponse({ error: { message: 'busy' } }, 503)],
    [
      'a connection error',
      () => {
        throw new TypeError('fetch failed');
      },
    ],
  ])('%s is a retryable failure and the next entry answers', async (_label, respond) => {
    const { calls, fetchImpl } = sidecar(respond);
    const cloud = cloudModel();
    const ai = client({ stt: [{ ...LOCAL }, { ...OPENAI }] }, { fetch: fetchImpl, cloud });
    const result = await ai.transcribeAudio({ userId: USER, chunks: [wav(0)] });
    expect(calls).toHaveLength(1);
    expect(result.model).toBe('openai:gpt-transcribe');

    const only = client({ stt: [{ ...LOCAL }] }, { fetch: fetchImpl });
    const error = (await only
      .transcribeAudio({ userId: USER, chunks: [wav(0)] })
      .catch((caught: unknown) => caught)) as AiError;
    expect(error).toMatchObject({ code: 'LLM_FAILED', provider: 'local', retryable: true });
    expect(error.message).not.toContain('stt-local');
  });

  test('HTTP 400 is a non-retryable failure of the entry', async () => {
    const { fetchImpl } = sidecar(() => jsonResponse({ error: { message: 'bad' } }, 400));
    const error = (await client({ stt: [{ ...LOCAL }] }, { fetch: fetchImpl })
      .transcribeAudio({ userId: USER, chunks: [wav(0)] })
      .catch((caught: unknown) => caught)) as AiError;
    expect(error).toMatchObject({ code: 'LLM_FAILED', status: 400, retryable: false });
  });

  test('the per-entry timeout is a retryable TIMEOUT', async () => {
    const hanging = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      })) as typeof fetch;
    await expect(
      transcribeWithLocal(BASE, wav(0), 'pt', AbortSignal.timeout(5), hanging),
    ).rejects.toMatchObject({ code: 'TIMEOUT', provider: 'local', retryable: true });
  });

  test('a caller abort stops the chain: no further entry is tried', async () => {
    const controller = new AbortController();
    const hanging = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        controller.abort();
      })) as typeof fetch;
    const cloud = cloudModel();
    const ai = client({ stt: [{ ...LOCAL }, { ...OPENAI }] }, { fetch: hanging, cloud });
    await expect(
      ai.transcribeAudio({ userId: USER, chunks: [wav(0)], signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'TIMEOUT', provider: 'local', retryable: false });
    expect(cloud.counter.calls).toBe(0);
  });
});

describe('sttPrefersWav', () => {
  test.each([
    ['local first and available', { stt: [{ ...LOCAL }, { ...OPENAI }] }, BASE, true],
    ['local first but unavailable', { stt: [{ ...LOCAL }, { ...OPENAI }] }, null, false],
    ['cloud first', { stt: [{ ...OPENAI }, { ...LOCAL }] }, BASE, false],
    ['only unavailable local', { stt: [{ ...LOCAL }] }, null, false],
    ['no STT chain', {}, BASE, false],
  ] as const)('%s → %p', async (_label, roles, endpoint, expected) => {
    const ai = client(roles as ModelRoles, { endpoint });
    expect(await ai.sttPrefersWav(USER)).toBe(expected);
  });

  test('is exported from the AI client module', async () => {
    const module = await import('./client');
    expect(typeof module.sttPrefersWav).toBe('function');
  });
});

describe('stored local entries', () => {
  test('are kept in stt and dropped from any other role', () => {
    const raw = JSON.stringify({
      chains: { stt: [LOCAL, OPENAI], standard: [LOCAL], vision: [LOCAL] },
    });
    expect(parseModelRoles(raw)).toEqual({ stt: [LOCAL, OPENAI] });
  });

  test('cost 0 even when the duration is unknown', () => {
    expect(estimateSttCostUsd(findCatalogModel('local', LOCAL.model)!, null)).toBe(0);
    expect(findCatalogModel('local', 'whisper-1')).toBeNull();
  });
});
