// ============================================================================
// Speech-to-text step (spec 221 G4): sources with audio are transcribed even
// when a description exists; captions stay the preferred transcript.
// ============================================================================

import { saveArtifact } from './artifact';
import { CaptureError } from './errors';
import { CAPTURE_MAX_ATTEMPTS, ensureLease, mapUnknownError, progress, withTimeout } from './lease';
import { aiSignal, billFailure, stopIfLeaseLost, type StepContext } from './ports';
import {
  MIN_USABLE_TEXT,
  contextTextLength,
  decodeAudio,
  needsSpeechToText,
  preservedDescription,
  uploadBlob,
} from './steps';
import type { CaptureArtifact } from './types';
import type { AudioFormat, WorkerAudio } from './worker-client';

const AUDIO_TIMEOUT_MS = 15 * 60_000;
/** Per chain entry: the whole audio, all chunks included (spec 221). */
const STT_ENTRY_TIMEOUT_MS = 20 * 60_000;
const MAX_AUDIO_SEC = 3 * 3600;
/** The worker serves WAV only for audio of known duration up to 1 h. */
const MAX_WAV_SEC = 3600;

async function fetchAudio(
  ctx: StepContext,
  artifact: CaptureArtifact,
  audioFromFile: WorkerAudio | null,
  sttFormat: () => Promise<AudioFormat>,
): Promise<WorkerAudio> {
  if (audioFromFile) return audioFromFile;
  const format = await sttFormat();
  if (artifact.upload) {
    // Uploads have no URL to re-download: re-run the stored file (retry,
    // lease reclaim, or a user retry after adding an STT key).
    const result = await ctx.deps.worker.file(
      {
        body: await uploadBlob(artifact.upload),
        filename: artifact.upload.filename,
        contentType: artifact.upload.mimeType,
        format,
      },
      withTimeout(ctx.signal, AUDIO_TIMEOUT_MS),
    );
    if (!result.audio)
      throw new CaptureError('NO_TEXT', 'upload has no audio', { retryable: false });
    return result.audio;
  }
  const known = artifact.durationSec;
  const linkFormat = format === 'wav' && known !== null && known <= MAX_WAV_SEC ? 'wav' : 'mp3';
  // A WAV request the worker cannot honor comes back as MP3; chunk mimes say which.
  return ctx.deps.worker.audio(
    artifact.canonicalUrl ?? ctx.job.sourceUrl,
    withTimeout(ctx.signal, AUDIO_TIMEOUT_MS),
    linkFormat,
  );
}

/**
 * Transcribes the source's speech when it has audio and no captions. When
 * STT cannot produce a transcript but at least 200 chars of other text exist,
 * the capture continues with a `speech_not_transcribed` warning; transient
 * failures still requeue the job while attempts remain.
 */
export async function speechStep(
  ctx: StepContext,
  artifact: CaptureArtifact,
  audioFromFile: WorkerAudio | null,
  sttFormat: () => Promise<AudioFormat>,
): Promise<CaptureArtifact> {
  if (!needsSpeechToText(artifact)) return artifact;
  const { job, deps } = ctx;
  const canDegrade = contextTextLength(artifact) >= MIN_USABLE_TEXT;
  if (!(await deps.ai.isRoleConfigured(job.userId, 'stt'))) {
    if (canDegrade) return artifact;
    throw new CaptureError('STT_NOT_CONFIGURED');
  }
  await ensureLease(job, ctx.controller);
  await progress(job, 'transcribing', 35);
  let next: CaptureArtifact;
  try {
    // Known to be too long: no download at all.
    if ((artifact.durationSec ?? 0) > MAX_AUDIO_SEC) throw new CaptureError('TOO_LARGE');
    const audio = await fetchAudio(ctx, artifact, audioFromFile, sttFormat);
    if (audio.durationSec > MAX_AUDIO_SEC) throw new CaptureError('TOO_LARGE');
    if (audio.chunks.length === 0) throw new CaptureError('NO_TEXT');
    const stt = await deps.ai.transcribeAudio({
      userId: job.userId,
      chunks: decodeAudio(audio),
      language: artifact.language ?? undefined,
      signal: await aiSignal(ctx, 'stt', STT_ENTRY_TIMEOUT_MS),
    });
    ctx.cost.usd += stt.costUsd ?? 0;
    const sttInfo = { model: stt.model, costUsd: stt.costUsd, language: stt.language };
    const spoken = stt.text.trim().length > 0 || stt.segments.length > 0;
    next = spoken
      ? {
          ...artifact,
          description: preservedDescription(artifact),
          text: stt.text,
          textKind: 'stt',
          segments: stt.segments,
          durationSec: artifact.durationSec ?? audio.durationSec,
          language: stt.language ?? artifact.language,
          stt: sttInfo,
        }
      : // No speech (music, silence): keep the text the source already had.
        { ...artifact, durationSec: artifact.durationSec ?? audio.durationSec, stt: sttInfo };
  } catch (error) {
    billFailure(ctx, error);
    await stopIfLeaseLost(ctx);
    const mapped = mapUnknownError(error, ctx.signal);
    if (!canDegrade) throw mapped;
    if (mapped.retryable && job.attempt < CAPTURE_MAX_ATTEMPTS) throw mapped;
    ctx.warnings.add('speech_not_transcribed');
    return artifact;
  }
  await saveArtifact(job.userId, job.id, next);
  return next;
}
