// Small pure helpers for the capture runner steps (specs 220/221).

import type { TranscriptionMethod } from '../../../prisma-generated/client';
import { storageGet } from '../storage';
import type { CaptureArtifact } from './types';
import type { WorkerAudio } from './worker-client';

/** Below this many chars, captions/description/page text is not usable text. */
export const MIN_USABLE_TEXT = 200;

export function usableText(artifact: CaptureArtifact): string {
  if (artifact.segments.length > 0) return artifact.segments.map((s) => s.text).join(' ');
  return artifact.text ?? '';
}

/**
 * Spec 220: text first (captions, description, post, page text); STT only
 * when no usable text exists and the source has audio.
 */
export function needsSpeechToText(artifact: CaptureArtifact): boolean {
  if (!artifact.hasAudio || artifact.textKind === 'stt' || artifact.textKind === 'captions') {
    return false;
  }
  return usableText(artifact).trim().length < MIN_USABLE_TEXT;
}

export async function uploadBlob(upload: NonNullable<CaptureArtifact['upload']>): Promise<Blob> {
  const object = await storageGet(upload.objectKey);
  return new Blob([await new Response(object.body).arrayBuffer()], { type: upload.mimeType });
}

export function pickMethod(artifact: CaptureArtifact): TranscriptionMethod {
  if (artifact.textKind === 'stt') return 'API';
  if (artifact.textKind === 'captions') return 'SUBTITLES';
  if (artifact.textKind === 'document') return 'DOCUMENT';
  if (artifact.platform === 'upload' && artifact.textKind === 'page') return 'DOCUMENT';
  if (artifact.textKind === 'none' && (artifact.imageDescriptions?.length ?? 0) > 0)
    return 'VISION';
  return 'SCRAPE';
}

export function decodeAudio(
  audio: WorkerAudio,
): Array<{ data: Uint8Array; mime: string; startSec: number }> {
  return audio.chunks.map((chunk) => ({
    data: new Uint8Array(Buffer.from(chunk.dataBase64, 'base64')),
    mime: chunk.mime,
    startSec: chunk.startSec,
  }));
}

/** Cost of billed attempts carried by a failed AI chain (spec 221). */
export function failedAttemptCost(error: unknown): number {
  const value = (error as { costUsd?: unknown } | null)?.costUsd;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
