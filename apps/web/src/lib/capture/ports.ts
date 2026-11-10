// ============================================================================
// Capture runner ports (specs 220/221): what the runner needs from lib/ai and
// the worker, plus the mutable context its steps share during one run.
// ============================================================================

import type { z } from 'zod';

import { ensureLease, withTimeout, type ClaimedCaptureJob } from './lease';
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
   * Audio format the STT chain wants (spec 221): `wav` when its first usable
   * entry is the local sidecar. Asked before any audio is fetched.
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
