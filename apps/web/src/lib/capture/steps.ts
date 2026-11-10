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
 * Spec 221 (G4): speech is always transcribed when the source has audio,
 * unless captions exist (they stay the preferred transcript) or this job
 * already ran STT.
 */
export function needsSpeechToText(artifact: CaptureArtifact): boolean {
  if (!artifact.hasAudio || artifact.stt || artifact.textKind === 'stt') return false;
  return artifact.textKind !== 'captions';
}

/**
 * Length of the text that is not a speech transcript (description, post or
 * page text): what a capture can still publish when STT is unavailable.
 */
export function contextTextLength(artifact: CaptureArtifact): number {
  const own = artifact.textKind === 'stt' ? '' : usableText(artifact);
  return Math.max(own.trim().length, (artifact.description ?? '').trim().length);
}

/** The post text or description kept next to a transcript (spec 221). */
export function preservedDescription(artifact: CaptureArtifact): string | null {
  if (artifact.description?.trim()) return artifact.description;
  const ownText = ['post', 'description', 'page'].includes(artifact.textKind);
  return ownText && artifact.text?.trim() ? artifact.text : null;
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
  const described =
    (artifact.imageDescriptions?.length ?? 0) + (artifact.frameDescriptions?.length ?? 0);
  if (artifact.textKind === 'none' && described > 0) return 'VISION';
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
