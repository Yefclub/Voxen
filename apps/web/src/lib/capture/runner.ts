// ============================================================================
// Capture runner (spec 220) — durable capture jobs in the web process
// ============================================================================
// Same lease model as knowledge-deletion-executor: FOR UPDATE SKIP LOCKED
// claim, 90 s lease with 20 s heartbeat, fencing on workerId + status, 3
// attempts. One capture at a time (the reference host has 4 cores). Each step
// persists a progress event; the worker artifact is stored so a retry skips
// the download. Cancellation flips the row to CANCELLED, which breaks the
// fence; the runner notices on heartbeat or at the next step boundary.
// ============================================================================

import { randomUUID } from 'node:crypto';

import type { Prisma } from '../../../prisma-generated/client';
import { db } from '../db';
import { publishJobEvent } from '../job-events';
import { storageDeletePrefix } from '../storage';
import { artifactFromWorker, captureArtifactPrefix, loadArtifact, saveArtifact } from './artifact';
import { CaptureError, captureErrorMessage, type CaptureErrorCode } from './errors';
import {
  InterpretationSchema,
  InterpretationWithAudienceSchema,
  clampText,
  interpretInstructions,
  normalizeInterpretation,
  sourceBlock,
  type InterpretationOutput,
} from './interpret';
import {
  CAPTURE_MAX_ATTEMPTS,
  LeaseLostError,
  claimCaptureJob,
  ensureLease,
  fence,
  mapUnknownError,
  progress,
  startHeartbeat,
  withTimeout,
  type ClaimedCaptureJob,
} from './lease';
import {
  aiSignal,
  billFailure,
  type CaptureCost,
  type CaptureDeps,
  type StepContext,
} from './ports';
import { publishCapturedDocument } from './publish';
import { pickMethod, uploadBlob, usableText } from './steps';
import { speechStep } from './stt-step';
import type { CaptureArtifact, CaptureInterpretation, CaptureWarning } from './types';
import { framesStep, visionStep } from './vision-step';
import type { AudioFormat, WorkerAudio } from './worker-client';

export { needsSpeechToText } from './steps';
export type { AiRole, CaptureAi, CaptureDeps, UntrustedPart } from './ports';
export { CAPTURE_LEASE_TTL_MS, CAPTURE_MAX_ATTEMPTS, claimCaptureJob } from './lease';
export type { ClaimedCaptureJob } from './lease';
export { captureArtifactKey, purgeStaleCaptureArtifacts } from './artifact';
export { normalizeInterpretation } from './interpret';

const EXTRACT_TIMEOUT_MS = 15 * 60_000;
/** Per chain entry: two 3-minute calls (the schema retry included). */
const MODEL_ENTRY_TIMEOUT_MS = 2 * 3 * 60_000;

// ---------------------------------------------------------------------------
// Job execution
// ---------------------------------------------------------------------------

type RunOutcome = {
  status: 'DONE' | 'COMPLETED_WITH_WARNINGS';
  transcriptId: string;
  costUsd: number;
  warnings: CaptureWarning[];
};

/** Extracts the source, or reuses the artifact a previous attempt stored. */
async function extractStep(
  ctx: StepContext,
  format: () => Promise<AudioFormat>,
): Promise<{ artifact: CaptureArtifact; audioFromFile: WorkerAudio | null }> {
  const { job, deps, signal } = ctx;
  await ensureLease(job, ctx.controller);
  const stored = await loadArtifact(job.userId, job.id);
  if (stored) {
    // STT and vision done by an earlier attempt are reused, and still billed.
    ctx.cost.usd += (stored.stt?.costUsd ?? 0) + (stored.visionCostUsd ?? 0);
    return { artifact: stored, audioFromFile: null };
  }
  const upload = (job.captureMeta.upload ?? null) as CaptureArtifact['upload'];
  await progress(job, 'extracting', 10);
  let artifact: CaptureArtifact;
  let audioFromFile: WorkerAudio | null = null;
  try {
    if (job.type === 'CAPTURE_UPLOAD') {
      if (!upload)
        throw new CaptureError('UNSUPPORTED', 'upload metadata missing', { retryable: false });
      const result = await deps.worker.file(
        {
          body: await uploadBlob(upload),
          filename: upload.filename,
          contentType: upload.mimeType,
          // Uploads extract audio up front, so the STT format is chosen now.
          format: await format(),
        },
        withTimeout(signal, EXTRACT_TIMEOUT_MS),
      );
      audioFromFile = result.audio ?? null;
      artifact = await artifactFromWorker(job, result, upload);
    } else {
      const result = await deps.worker.extract(
        job.sourceUrl,
        withTimeout(signal, EXTRACT_TIMEOUT_MS),
      );
      artifact = await artifactFromWorker(job, result, null);
    }
  } catch (error) {
    throw mapUnknownError(error, signal);
  }
  await saveArtifact(job.userId, job.id, artifact);
  return { artifact, audioFromFile };
}

async function interpretStep(
  ctx: StepContext,
  artifact: CaptureArtifact,
): Promise<{ interpretation: CaptureInterpretation; modelRef: string }> {
  const { job, deps } = ctx;
  await ensureLease(job, ctx.controller);
  if (!(await deps.ai.isRoleConfigured(job.userId, 'standard')))
    throw new CaptureError('AI_NOT_CONFIGURED');
  await progress(job, 'interpreting', 75);
  const finalText = usableText(artifact).trim();
  const clamped = clampText(
    artifact.segments.length > 0 ? finalText : (artifact.text ?? finalText),
  );
  const withComments = (artifact.comments?.length ?? 0) > 0;
  try {
    const result = await deps.ai.generateStructured<InterpretationOutput>({
      userId: job.userId,
      role: 'standard',
      instructions: interpretInstructions(withComments),
      untrusted: [{ text: sourceBlock(artifact, clamped.text, clamped.truncated) }],
      schema: withComments ? InterpretationWithAudienceSchema : InterpretationSchema,
      maxOutputTokens: 2_000,
      signal: await aiSignal(ctx, 'standard', MODEL_ENTRY_TIMEOUT_MS),
    });
    ctx.cost.usd += result.costUsd ?? 0;
    return {
      modelRef: result.modelRef,
      interpretation: normalizeInterpretation(result.output, artifact.title ?? job.sourceUrl),
    };
  } catch (error) {
    billFailure(ctx, error);
    throw mapUnknownError(error, ctx.signal);
  }
}

async function executeCapture(
  job: ClaimedCaptureJob,
  deps: CaptureDeps,
  controller: AbortController,
  cost: CaptureCost,
): Promise<RunOutcome> {
  const ctx: StepContext = {
    job,
    deps,
    controller,
    signal: controller.signal,
    warnings: new Set(),
    cost,
  };

  // Fail before paying for downloads or STT when no text model is configured.
  if (!(await deps.ai.isRoleConfigured(job.userId, 'standard'))) {
    throw new CaptureError('AI_NOT_CONFIGURED');
  }

  // The STT audio format is chosen once, before any audio is fetched.
  let format: AudioFormat | null = null;
  const sttFormat = async () => (format ??= await deps.ai.sttAudioFormat(job.userId));

  // 1. Extract → 2. speech → 3. keyframes → 4. vision.
  const extracted = await extractStep(ctx, sttFormat);
  let artifact = extracted.artifact;
  artifact = await speechStep(ctx, artifact, extracted.audioFromFile, sttFormat);
  artifact = await framesStep(ctx, artifact);
  artifact = await visionStep(ctx, artifact);

  const described =
    (artifact.imageDescriptions?.length ?? 0) + (artifact.frameDescriptions?.length ?? 0);
  if (!usableText(artifact).trim() && !artifact.description?.trim() && described === 0) {
    throw new CaptureError('NO_TEXT', 'nothing usable', { retryable: false });
  }

  // 5. Interpretation, 6. publish.
  const { interpretation, modelRef } = await interpretStep(ctx, artifact);
  await ensureLease(job, controller);
  await progress(job, 'publishing', 90);
  const total = ctx.cost.usd;
  const published = await publishCapturedDocument({
    jobId: job.id,
    userId: job.userId,
    refreshTranscriptId: job.refreshTranscriptId,
    sourceUrl: job.sourceUrl,
    artifact,
    interpretation,
    method: pickMethod(artifact),
    model: modelRef,
    costUsd: Math.round(total * 1e6) / 1e6,
  });
  const warnings = [...ctx.warnings];
  return {
    status: warnings.length > 0 ? 'COMPLETED_WITH_WARNINGS' : 'DONE',
    transcriptId: published.transcriptId,
    costUsd: total,
    warnings,
  };
}

export function captureBackoffMs(attempt: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 10 * 60_000);
}

/** Failed-attempt cost of earlier runs of this job (spec 221: every attempt is billed). */
function carriedFailedCost(job: ClaimedCaptureJob): number {
  const value = job.captureMeta.failedCostUsd;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

async function finishFailure(
  job: ClaimedCaptureJob,
  error: CaptureError,
  now: Date,
  failedCostUsd: number,
): Promise<void> {
  const retry = error.retryable && job.attempt < CAPTURE_MAX_ATTEMPTS;
  const code: CaptureErrorCode = error.code;
  const captureMeta = {
    ...job.captureMeta,
    failedCostUsd: Math.round(failedCostUsd * 1e8) / 1e8,
  } as Prisma.InputJsonValue;
  const updated = await db.job.updateMany({
    where: fence(job),
    data: retry
      ? {
          captureMeta,
          status: 'QUEUED',
          workerId: null,
          heartbeatAt: null,
          leaseExpiresAt: null,
          notBefore: new Date(now.getTime() + captureBackoffMs(job.attempt)),
          captureErrorCode: code,
          errorMsg: captureErrorMessage(code),
          progressStage: 'queued',
          progressedAt: now,
        }
      : {
          captureMeta,
          status: 'FAILED',
          workerId: null,
          heartbeatAt: null,
          leaseExpiresAt: null,
          finishedAt: now,
          captureErrorCode: code,
          errorMsg: captureErrorMessage(code),
          progressStage: 'failed',
          progressedAt: now,
        },
  });
  if (updated.count === 1) {
    await publishJobEvent(job.userId, {
      jobId: job.id,
      stage: retry ? 'queued' : 'failed',
      errorMsg: captureErrorMessage(code),
    }).catch(() => {});
  }
}

/** Runs one claimed job to a terminal or requeued state. Never throws. */
export async function runCaptureJob(job: ClaimedCaptureJob, deps: CaptureDeps): Promise<void> {
  const controller = new AbortController();
  const stopHeartbeat = startHeartbeat(job, controller);
  const now = deps.now ?? (() => new Date());
  const carried = carriedFailedCost(job);
  const cost: CaptureCost = { usd: carried, failedUsd: carried };
  try {
    const outcome = await executeCapture(job, deps, controller, cost);
    const finishedAt = now();
    const updated = await db.job.updateMany({
      where: fence(job),
      data: {
        status: outcome.status,
        workerId: null,
        heartbeatAt: null,
        leaseExpiresAt: null,
        finishedAt,
        captureCostUsd: Math.round(outcome.costUsd * 1e6) / 1e6,
        captureMeta: { ...job.captureMeta, warnings: outcome.warnings } as Prisma.InputJsonValue,
        progressStage: outcome.status === 'DONE' ? 'done' : 'completed_with_warnings',
        progressPercent: 100,
        progressedAt: finishedAt,
      },
    });
    if (updated.count === 1) {
      await publishJobEvent(job.userId, {
        jobId: job.id,
        stage: outcome.status === 'DONE' ? 'done' : 'completed_with_warnings',
        percent: 100,
        transcriptId: outcome.transcriptId,
      }).catch(() => {});
      // The published document owns its text and thumbnail now; the capture
      // artifact (full captured text and images) must not outlive it.
      await storageDeletePrefix(captureArtifactPrefix(job.userId, job.id)).catch(() => {});
    }
  } catch (error) {
    if (error instanceof LeaseLostError || controller.signal.reason instanceof LeaseLostError)
      return;
    const mapped =
      error instanceof CaptureError
        ? error
        : new CaptureError('UNKNOWN', error instanceof Error ? error.name : 'unknown');
    if (mapped.code === 'UNKNOWN') {
      console.error('[capture] unexpected failure', {
        jobId: job.id,
        error: error instanceof Error ? error.message.slice(0, 300) : 'unknown',
      });
    }
    await finishFailure(job, mapped, now(), cost.failedUsd).catch(() => {});
  } finally {
    stopHeartbeat();
  }
}

// ---------------------------------------------------------------------------
// Drain loop
// ---------------------------------------------------------------------------

let draining: Promise<void> | null = null;

export async function listRunnableCaptureJobs(now = new Date(), limit = 10): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Job"
    WHERE type IN ('CAPTURE_LINK', 'CAPTURE_UPLOAD')
      AND (
        (status = 'QUEUED' AND ("notBefore" IS NULL OR "notBefore" <= ${now}))
        OR (status = 'RUNNING' AND "leaseExpiresAt" < ${now})
      )
    ORDER BY "queuedAt" ASC
    LIMIT ${limit}
  `;
  return rows.map((row) => row.id);
}

/** Claims and runs runnable captures one at a time until none are left. */
export function drainCaptureJobs(deps: CaptureDeps): Promise<void> {
  if (draining) return draining;
  const owner = `web-capture-${randomUUID()}`;
  draining = (async () => {
    try {
      for (let guard = 0; guard < 1_000; guard += 1) {
        const ids = await listRunnableCaptureJobs();
        if (ids.length === 0) return;
        let ran = false;
        for (const id of ids) {
          const job = await claimCaptureJob(id, owner);
          if (!job) continue;
          ran = true;
          await runCaptureJob(job, deps);
          break;
        }
        if (!ran) return;
      }
    } finally {
      draining = null;
    }
  })();
  return draining;
}
