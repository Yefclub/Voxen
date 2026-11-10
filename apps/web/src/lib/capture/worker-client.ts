// ============================================================================
// Capture worker client (spec 220) — the only path from web to source content
// ============================================================================
// The web process never fetches a user-supplied URL. It asks the isolated
// `capture-worker` container (bearer CAPTURE_WORKER_TOKEN, internal network)
// to extract text, audio, and images, and maps worker errors to capture codes.
// ============================================================================

import { normalizeComments } from './comments';
import { CaptureError, isCaptureErrorCode } from './errors';
import type { CaptureComment, CaptureSegment, CaptureTextKind } from './types';

export type WorkerImage = {
  kind: string;
  mime: string;
  dataBase64: string;
  /** Keyframes only: position in the video, in seconds. */
  timeSec?: number | null;
};

export type WorkerComment = CaptureComment;

/** `wav` is for the local STT sidecar; the worker answers MP3 when it cannot honor it. */
export type AudioFormat = 'mp3' | 'wav';

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
  hasVideo: boolean;
  images: WorkerImage[];
  comments: WorkerComment[];
  extractor: string | null;
};

export type WorkerFrames = { durationSec: number | null; images: WorkerImage[] };

export type WorkerAudio = {
  durationSec: number;
  chunks: Array<{ startSec: number; mime: string; dataBase64: string }>;
};

export type WorkerFileResult = WorkerExtraction & { audio?: WorkerAudio | null };

export interface CaptureWorkerClient {
  extract(url: string, signal: AbortSignal): Promise<WorkerExtraction>;
  audio(url: string, signal: AbortSignal, format?: AudioFormat): Promise<WorkerAudio>;
  /** Up to 4 keyframes of the source video (spec 221). */
  frames(url: string, signal: AbortSignal): Promise<WorkerFrames>;
  file(
    input: { body: Blob; filename: string; contentType: string; format?: AudioFormat },
    signal: AbortSignal,
  ): Promise<WorkerFileResult>;
}

const MAX_RESPONSE_BYTES = 400 * 1024 * 1024;
const MAX_WORKER_IMAGES = 4;
/** Base64 of the worker's 1.5 MiB image cap, plus padding slack. */
const MAX_IMAGE_BASE64_CHARS = Math.ceil((1.5 * 1024 * 1024 * 4) / 3) + 16;
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// ---------------------------------------------------------------------------
// Defensive response normalization: the worker is trusted for transport, but
// what it relays comes from the open web, so limits are enforced here too.
// ---------------------------------------------------------------------------

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeImages(value: unknown): WorkerImage[] {
  if (!Array.isArray(value)) return [];
  const images: WorkerImage[] = [];
  for (const item of value) {
    if (images.length >= MAX_WORKER_IMAGES) break;
    const image = item as Partial<WorkerImage> | null;
    if (!image || typeof image.dataBase64 !== 'string' || typeof image.mime !== 'string') continue;
    if (!IMAGE_MIMES.has(image.mime)) continue;
    if (image.dataBase64.length === 0 || image.dataBase64.length > MAX_IMAGE_BASE64_CHARS) continue;
    const timeSec = finiteOrNull(image.timeSec);
    images.push({
      kind: typeof image.kind === 'string' ? image.kind.slice(0, 40) : 'image',
      mime: image.mime,
      dataBase64: image.dataBase64,
      ...(timeSec !== null && timeSec >= 0 ? { timeSec } : {}),
    });
  }
  return images;
}

function normalizeExtraction<T extends WorkerExtraction>(body: T): T {
  return {
    ...body,
    hasAudio: body.hasAudio === true,
    hasVideo: body.hasVideo === true,
    images: normalizeImages(body.images),
    comments: normalizeComments(body.comments),
  };
}

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

function json(body: Record<string, unknown>): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
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
    extract: async (url, signal) =>
      normalizeExtraction(await call<WorkerExtraction>('/v1/extract', json({ url }), signal)),
    audio: (url, signal, format = 'mp3') =>
      call<WorkerAudio>('/v1/audio', json({ url, format }), signal),
    frames: async (url, signal) => {
      const body = await call<Partial<WorkerFrames>>('/v1/frames', json({ url }), signal);
      return {
        durationSec: finiteOrNull(body.durationSec),
        images: normalizeImages(body.images).map((image) => ({ ...image, kind: 'frame' })),
      };
    },
    file: async (input, signal) => {
      const form = new FormData();
      form.set('file', input.body, input.filename);
      form.set('filename', input.filename);
      form.set('contentType', input.contentType);
      form.set('format', input.format ?? 'mp3');
      return normalizeExtraction(
        await call<WorkerFileResult>('/v1/file', { method: 'POST', body: form }, signal),
      );
    },
  };
}
