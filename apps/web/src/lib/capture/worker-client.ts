// ============================================================================
// Capture worker client (spec 220) — the only path from web to source content
// ============================================================================
// The web process never fetches a user-supplied URL. It asks the isolated
// `capture-worker` container (bearer CAPTURE_WORKER_TOKEN, internal network)
// to extract text, audio, and images, and maps worker errors to capture codes.
// ============================================================================

import { CaptureError, isCaptureErrorCode } from './errors';
import type { CaptureSegment, CaptureTextKind } from './types';

export type WorkerImage = { kind: string; mime: string; dataBase64: string };

export type WorkerExtraction = {
  platform: string;
  canonicalUrl: string | null;
  platformId: string | null;
  title: string | null;
  author: string | null;
  channel: string | null;
  publishedAt: string | null;
  durationSec: number | null;
  language: string | null;
  description: string | null;
  text: string | null;
  textKind: CaptureTextKind;
  segments: CaptureSegment[];
  hasAudio: boolean;
  images: WorkerImage[];
  extractor: string | null;
};

export type WorkerAudio = {
  durationSec: number;
  chunks: Array<{ startSec: number; mime: string; dataBase64: string }>;
};

export type WorkerFileResult = WorkerExtraction & { audio?: WorkerAudio | null };

export interface CaptureWorkerClient {
  extract(url: string, signal: AbortSignal): Promise<WorkerExtraction>;
  audio(url: string, signal: AbortSignal): Promise<WorkerAudio>;
  file(
    input: { body: Blob; filename: string; contentType: string },
    signal: AbortSignal,
  ): Promise<WorkerFileResult>;
}

const MAX_RESPONSE_BYTES = 400 * 1024 * 1024;

type WorkerConfig = { baseUrl: string; token: string };

export function workerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WorkerConfig | null {
  const baseUrl = env.CAPTURE_WORKER_URL?.trim();
  const token = env.CAPTURE_WORKER_TOKEN?.trim();
  if (!baseUrl || !token) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ''), token };
}

async function readJsonCapped(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_RESPONSE_BYTES)
    throw new CaptureError('TOO_LARGE', 'worker response too large');
  const reader = response.body?.getReader();
  if (!reader) return null;
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new CaptureError('TOO_LARGE', 'worker response too large');
    }
    parts.push(value);
  }
  const text = new TextDecoder().decode(Buffer.concat(parts));
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function errorFromBody(status: number, body: unknown): CaptureError {
  const error = (body as { error?: { code?: unknown; retryable?: unknown } } | null)?.error;
  if (error && isCaptureErrorCode(error.code)) {
    return new CaptureError(error.code, `worker:${error.code}`, {
      retryable: typeof error.retryable === 'boolean' ? error.retryable : undefined,
    });
  }
  if (status === 401 || status === 403)
    return new CaptureError('WORKER_UNAVAILABLE', 'worker rejected token', { retryable: false });
  if (status === 413) return new CaptureError('TOO_LARGE');
  if (status >= 500) return new CaptureError('WORKER_UNAVAILABLE', `worker status ${status}`);
  return new CaptureError('UNKNOWN', `worker status ${status}`);
}

export function createCaptureWorkerClient(
  config: WorkerConfig | null = workerConfigFromEnv(),
  fetchImpl: typeof fetch = fetch,
): CaptureWorkerClient {
  async function call<T>(path: string, init: RequestInit, signal: AbortSignal): Promise<T> {
    if (!config) throw new CaptureError('WORKER_UNAVAILABLE', 'capture worker not configured');
    let response: Response;
    try {
      response = await fetchImpl(`${config.baseUrl}${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), authorization: `Bearer ${config.token}` },
        redirect: 'error',
        signal,
      });
    } catch (error) {
      if (signal.aborted)
        throw signal.reason instanceof CaptureError ? signal.reason : new CaptureError('TIMEOUT');
      throw new CaptureError(
        'WORKER_UNAVAILABLE',
        error instanceof Error ? error.name : 'fetch failed',
      );
    }
    const body = await readJsonCapped(response);
    if (!response.ok) throw errorFromBody(response.status, body);
    if (body && typeof body === 'object' && 'error' in body) throw errorFromBody(422, body);
    if (!body || typeof body !== 'object')
      throw new CaptureError('WORKER_UNAVAILABLE', 'invalid worker response');
    return body as T;
  }

  return {
    extract: (url, signal) =>
      call<WorkerExtraction>(
        '/v1/extract',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url }),
        },
        signal,
      ),
    audio: (url, signal) =>
      call<WorkerAudio>(
        '/v1/audio',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url }),
        },
        signal,
      ),
    file: (input, signal) => {
      const form = new FormData();
      form.set('file', input.body, input.filename);
      form.set('filename', input.filename);
      form.set('contentType', input.contentType);
      return call<WorkerFileResult>('/v1/file', { method: 'POST', body: form }, signal);
    },
  };
}
