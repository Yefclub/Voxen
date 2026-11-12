// ============================================================================
// Capture runner ports (specs 220/221): what the runner needs from lib/ai and
// the worker, plus the mutable context its steps share during one run.
// ============================================================================

import type { z } from 'zod';

import { CHAIN_PROVIDERS } from '../ai/catalog';
import { AiError } from '../ai/errors';
import { structuredLog } from '../structured-log';
import { ensureLease, mapUnknownError, withTimeout, type ClaimedCaptureJob } from './lease';
import { failedAttemptCost } from './steps';
import type { CaptureWarning } from './types';
import type { AudioFormat, CaptureWorkerClient } from './worker-client';

export type AiRole = 'fast' | 'standard' | 'vision' | 'stt';

export type UntrustedPart = { text: string } | { image: Uint8Array; mime: string };

/** The subset of the AI client (lib/ai) the runner depends on. */
export interface CaptureAi {
  isRoleConfigured(userId: string, role: AiRole): Promise<boolean>;
  /** Usable entries in the role's fallback chain; 0 when not configured. */
  chainLength(userId: string, role: AiRole): Promise<number>;
  /**
   * Audio format the STT chain wants (spec 223): `wav` when any usable entry
   * is the local sidecar. Asked before any audio is fetched.
   */
  sttAudioFormat(userId: string): Promise<AudioFormat>;
  generateStructured<T>(input: {
    userId: string;
    role: Exclude<AiRole, 'stt'>;
    instructions: string;
    untrusted: UntrustedPart[];
    schema: z.ZodType<T>;
    maxOutputTokens: number;
    signal: AbortSignal;
  }): Promise<{ output: T; modelRef: string; costUsd: number | null }>;
  transcribeAudio(input: {
    userId: string;
    chunks: Array<{ data: Uint8Array; mime: string; startSec: number }>;
    language?: string;
    signal: AbortSignal;
  }): Promise<{
    text: string;
    segments: Array<{ startSec: number; endSec: number; text: string }>;
    language: string | null;
    model: string;
    costUsd: number | null;
  }>;
}

export type CaptureDeps = {
  worker: CaptureWorkerClient;
  ai: CaptureAi;
  now?: () => Date;
};

/** State shared by the steps of one capture run. */
export type StepContext = {
  job: ClaimedCaptureJob;
  deps: CaptureDeps;
  controller: AbortController;
  signal: AbortSignal;
  warnings: Set<CaptureWarning>;
  cost: CaptureCost;
};

export type CaptureCost = {
  /** Job cost so far: every AI attempt, failed ones included. */
  usd: number;
  /** The failed-attempt part, carried in captureMeta across requeues. */
  failedUsd: number;
};

/** Adds the billed attempts carried by a failed AI call to the job cost. */
export function billFailure(ctx: StepContext, error: unknown): void {
  const usd = failedAttemptCost(error);
  ctx.cost.usd += usd;
  ctx.cost.failedUsd += usd;
}

/** Preserve the cause of partial publication without upstream text or credentials. */
export function recordCaptureWarning(
  ctx: StepContext,
  warning: CaptureWarning,
  error: unknown,
): void {
  ctx.warnings.add(warning);
  const mapped = mapUnknownError(error, ctx.signal);
  const typed = error instanceof AiError ? error : null;
  const provider = CHAIN_PROVIDERS.find((candidate) => candidate === typed?.provider);
  const status = typed?.status;
  const step = {
    speech_not_transcribed: 'speech',
    frames_unavailable: 'frames',
    images_not_described: 'vision',
  }[warning];
  structuredLog('warning', 'capture-step-warning', {
    job_id: ctx.job.id,
    actor_id: ctx.job.userId,
    step,
    warning,
    error_code: mapped.code,
    retryable: mapped.retryable,
    provider,
    http_status:
      typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
        ? status
        : undefined,
  });
}

/**
 * Before a step turns a failure into a warning: a cancel or lease loss must
 * stop the run instead. The worker client reports an aborted call as
 * TIMEOUT, so the fence is checked here rather than inferred from the error.
 */
export async function stopIfLeaseLost(ctx: StepContext): Promise<void> {
  await ensureLease(ctx.job, ctx.controller);
}

/**
 * Per-step signal for an AI chain (spec 221): every chain entry has its own
 * budget, so the step gets `perEntryMs` × usable entries.
 */
export async function aiSignal(
  ctx: StepContext,
  role: AiRole,
  perEntryMs: number,
): Promise<AbortSignal> {
  const entries = Math.max(1, await ctx.deps.ai.chainLength(ctx.job.userId, role));
  return withTimeout(ctx.signal, perEntryMs * entries);
}
