// ============================================================================
// Transport of the keyless `local` STT provider (spec 221)
// ============================================================================
// OpenAI-compatible multipart call to the `stt-local` sidecar
// (apps/stt-local). The sidecar decodes WAV only, so any other chunk fails the
// entry before a request is made and the chain moves on.
// ============================================================================

import { z } from 'zod';
import { LOCAL_STT_MODEL } from './catalog';
import type { AudioChunk } from './client';
import { AiError } from './errors';
import { sentenceSegments, wholeChunkSegment, type ChunkTranscript } from './transcription';

const WAV_MIMES = new Set(['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave']);

/** True when the chunk is WAV, the only format the sidecar decodes. */
export function isWavChunk(chunk: Pick<AudioChunk, 'mime'>): boolean {
  return WAV_MIMES.has(chunk.mime.split(';')[0]!.trim().toLowerCase());
}

const LocalSttResponse = z.object({
  text: z.string(),
  language: z.string().nullish(),
  duration: z.number().nullish(),
  segments: z.array(z.object({ start: z.number(), end: z.number(), text: z.string() })).nullish(),
});

function isAbortLike(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * Transcribes one WAV chunk on the sidecar (OpenAI-compatible multipart).
 * 5xx, connection errors and the per-entry timeout are retryable failures of
 * the entry; the caller's own abort propagates unchanged.
 */
export async function transcribeWithLocal(
  baseUrl: string,
  chunk: AudioChunk,
  language: string | undefined,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<ChunkTranscript> {
  if (!isWavChunk(chunk)) {
    throw new AiError('LLM_FAILED', 'The local speech-to-text model accepts WAV audio only.', {
      provider: 'local',
    });
  }
  const url = `${baseUrl}/v1/audio/transcriptions`;
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(chunk.data)], { type: 'audio/wav' }), 'chunk.wav');
  form.set('model', LOCAL_STT_MODEL.id);
  if (language) form.set('language', language);
  form.set('response_format', 'verbose_json');

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { accept: 'application/json' },
      body: form,
      redirect: 'error',
      signal,
    });
  } catch (error) {
    if (isAbortLike(error) || signal.aborted) {
      const timedOut = (signal.reason as { name?: unknown } | undefined)?.name === 'TimeoutError';
      if (!timedOut) throw error;
      throw new AiError('TIMEOUT', 'The local speech-to-text call timed out.', {
        provider: 'local',
        retryable: true,
      });
    }
    throw new AiError('LLM_FAILED', 'The local speech-to-text service is unreachable.', {
      provider: 'local',
      retryable: true,
    });
  }
  if (!response.ok) {
    // The body is not read: the error message stays fixed and free of the URL.
    await response.body?.cancel().catch(() => undefined);
    const status = response.status;
    throw new AiError('LLM_FAILED', `The local speech-to-text call failed (HTTP ${status}).`, {
      provider: 'local',
      status,
      retryable: status >= 500,
    });
  }
  const parsed = LocalSttResponse.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new AiError('LLM_FAILED', 'Unexpected transcription response.', { provider: 'local' });
  }
  const segments = sentenceSegments(
    (parsed.data.segments ?? []).map((segment) => ({
      startSec: segment.start,
      endSec: segment.end,
      text: segment.text,
    })),
  );
  const durationSec = parsed.data.duration ?? segments.at(-1)?.endSec ?? null;
  return {
    text: parsed.data.text,
    segments: segments.length > 0 ? segments : wholeChunkSegment(parsed.data.text, durationSec),
    language: parsed.data.language ?? null,
    durationSec,
    usage: null,
  };
}
