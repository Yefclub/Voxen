// Speech-to-text transport for the AI client (spec 220/221): OpenAI, xAI and
// Gemini via the AI SDK transcription API, OpenRouter via its transcription
// endpoint.

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import { APICallError, transcribe, type JSONValue, type TranscriptionModel } from 'ai';
import { z } from 'zod';
import {
  PROVIDER_BASE_URLS,
  type AudioChunk,
  type ResolvedRole,
  type TranscriptSegment,
} from './client';
import { AiError } from './errors';

export function roundSec(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Speech-to-text
// ---------------------------------------------------------------------------

export interface ChunkTranscript {
  text: string;
  segments: TranscriptSegment[];
  language: string | null;
  durationSec: number | null;
  /** Token usage, when the provider reports it (Gemini). */
  usage: { inputTokens: number; outputTokens: number } | null;
}

export function providerTranscriptionModel(
  resolved: ResolvedRole,
  fetchImpl: typeof fetch,
): TranscriptionModel {
  const baseURL = PROVIDER_BASE_URLS[resolved.provider];
  const options = { apiKey: resolved.apiKey, baseURL, fetch: fetchImpl };
  switch (resolved.provider) {
    case 'openai':
      return createOpenAI(options).transcription(resolved.model);
    case 'xai':
      return createXai(options).transcription(resolved.model);
    case 'google':
      return createGoogleGenerativeAI(options).transcription(resolved.model);
    default:
      throw new AiError('LLM_FAILED', 'This provider has no SDK transcription model.', {
        provider: resolved.provider,
      });
  }
}

export async function transcribeWithSdk(
  model: TranscriptionModel,
  resolved: ResolvedRole,
  chunk: AudioChunk,
  language: string | undefined,
  signal: AbortSignal,
): Promise<ChunkTranscript> {
  const result = await transcribe({
    model,
    audio: chunk.data,
    timestampGranularities: ['segment'],
    maxRetries: 1,
    abortSignal: signal,
    providerOptions: sttProviderOptions(resolved.provider, language),
  });
  const segments = sentenceSegments(
    result.segments.map((segment) => ({
      startSec: segment.startSecond,
      endSec: segment.endSecond,
      text: segment.text,
    })),
  );
  const durationSec = result.durationInSeconds ?? segments.at(-1)?.endSec ?? null;
  return {
    text: result.text,
    segments: segments.length > 0 ? segments : wholeChunkSegment(result.text, durationSec),
    language: result.language ?? null,
    durationSec,
    usage: googleUsage(result.providerMetadata),
  };
}

function sttProviderOptions(
  provider: ResolvedRole['provider'],
  language: string | undefined,
): Record<string, Record<string, JSONValue>> | undefined {
  if (provider === 'google') {
    // Gemini returns timings only as word annotations (verbatim mode); the
    // words are merged into sentences below. Chunks are at most 20 minutes,
    // under the 30-minute limit for word timestamps.
    return {
      google: { wordTimestamp: true, ...(language ? { languageCodes: [language] } : {}) },
    };
  }
  return language ? { [provider]: { language } } : undefined;
}

const GoogleUsage = z.object({
  total_input_tokens: z.number().nonnegative(),
  total_output_tokens: z.number().nonnegative(),
});

function googleUsage(metadata: Record<string, unknown> | undefined): ChunkTranscript['usage'] {
  const google = metadata?.google as { usage?: unknown } | undefined;
  const parsed = GoogleUsage.safeParse(google?.usage);
  return parsed.success
    ? { inputTokens: parsed.data.total_input_tokens, outputTokens: parsed.data.total_output_tokens }
    : null;
}

const OPENROUTER_MIME_FORMATS: Readonly<Record<string, string>> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
};

const OpenRouterSttResponse = z.object({
  text: z.string(),
  language: z.string().nullish(),
  duration: z.number().nullish(),
  segments: z.array(z.object({ start: z.number(), end: z.number(), text: z.string() })).nullish(),
  usage: z.object({ seconds: z.number().nullish() }).nullish(),
});

export function openRouterAudioFormat(mime: string): string {
  const base = mime.split(';')[0]!.trim().toLowerCase();
  return OPENROUTER_MIME_FORMATS[base] ?? (base.startsWith('audio/') ? base.slice(6) : 'mp3');
}

/** OpenRouter STT: JSON body with base64 audio (no AI SDK transcription model). */
export async function transcribeWithOpenRouter(
  resolved: ResolvedRole,
  chunk: AudioChunk,
  language: string | undefined,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<ChunkTranscript> {
  const url = `${PROVIDER_BASE_URLS.openrouter}/audio/transcriptions`;
  const body = {
    model: resolved.model,
    input_audio: {
      data: Buffer.from(chunk.data).toString('base64'),
      format: openRouterAudioFormat(chunk.mime),
    },
    ...(language ? { language } : {}),
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
    provider: { data_collection: 'deny' },
  };
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${resolved.apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
    redirect: 'error',
    signal,
  });
  if (!response.ok) {
    const responseBody = await response.text().catch(() => '');
    throw new APICallError({
      message: `OpenRouter transcription failed with HTTP ${response.status}`,
      url,
      requestBodyValues: {},
      statusCode: response.status,
      responseBody,
      isRetryable: response.status >= 500,
    });
  }
  const parsed = OpenRouterSttResponse.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new AiError('LLM_FAILED', 'Unexpected transcription response.', {
      provider: 'openrouter',
    });
  }
  const segments = sentenceSegments(
    (parsed.data.segments ?? []).map((segment) => ({
      startSec: segment.start,
      endSec: segment.end,
      text: segment.text,
    })),
  );
  const durationSec =
    parsed.data.duration ?? parsed.data.usage?.seconds ?? segments.at(-1)?.endSec ?? null;
  return {
    text: parsed.data.text,
    segments: segments.length > 0 ? segments : wholeChunkSegment(parsed.data.text, durationSec),
    language: parsed.data.language ?? null,
    durationSec,
    usage: null,
  };
}

function wholeChunkSegment(text: string, durationSec: number | null): TranscriptSegment[] {
  const trimmed = text.trim();
  return trimmed ? [{ startSec: 0, endSec: durationSec ?? 0, text: trimmed }] : [];
}

const MAX_MERGED_SEGMENT_SEC = 15;

/**
 * Some providers (xAI, OpenAI word fallback) return word-level timings in
 * `segments`. Word-level input is merged into sentence-sized segments; real
 * segments pass through trimmed.
 */
export function sentenceSegments(segments: readonly TranscriptSegment[]): TranscriptSegment[] {
  const cleaned = segments
    .map((segment) => ({ ...segment, text: segment.text.trim() }))
    .filter((segment) => segment.text.length > 0);
  if (cleaned.length < 2) return cleaned;
  const averageWords =
    cleaned.reduce((sum, segment) => sum + segment.text.split(/\s+/).length, 0) / cleaned.length;
  if (averageWords > 1.5) return cleaned;

  const merged: TranscriptSegment[] = [];
  let current: TranscriptSegment | null = null;
  for (const word of cleaned) {
    if (!current) {
      current = { ...word };
    } else {
      current.text = `${current.text} ${word.text}`;
      current.endSec = word.endSec;
    }
    const sentenceEnd = /[.!?…]["')\]]?$/.test(word.text);
    if (sentenceEnd || current.endSec - current.startSec >= MAX_MERGED_SEGMENT_SEC) {
      merged.push(current);
      current = null;
    }
  }
  if (current) merged.push(current);
  return merged;
}
