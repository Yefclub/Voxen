// ============================================================================
// Capture runtime dependencies: worker client + AI client adapter (spec 220)
// ============================================================================

import { generateStructured, resolveRoleChain, sttPrefersWav, transcribeAudio } from '../ai/client';
import type { AiRole, CaptureAi, CaptureDeps } from './ports';
import { createCaptureWorkerClient } from './worker-client';

const NOT_CONFIGURED = new Set(['AI_NOT_CONFIGURED', 'STT_NOT_CONFIGURED']);

async function chainLength(userId: string, role: AiRole): Promise<number> {
  try {
    return (await resolveRoleChain(userId, role)).length;
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === 'string' && NOT_CONFIGURED.has(code)) return 0;
    throw error;
  }
}

export const cloudCaptureAi: CaptureAi = {
  isRoleConfigured: async (userId, role) => (await chainLength(userId, role)) > 0,
  chainLength,
  // WAV only when the first available STT entry is the local sidecar (spec 221).
  sttAudioFormat: async (userId) => ((await sttPrefersWav(userId)) ? 'wav' : 'mp3'),
  generateStructured: (input) => generateStructured(input),
  transcribeAudio: (input) => transcribeAudio(input),
};

let override: CaptureDeps | null = null;
let cached: CaptureDeps | null = null;

export function getCaptureDeps(): CaptureDeps {
  if (override) return override;
  cached ??= { worker: createCaptureWorkerClient(), ai: cloudCaptureAi };
  return cached;
}

/** Test seam: replace the worker and AI clients. Pass null to restore. */
export function setCaptureDepsForTests(deps: CaptureDeps | null): void {
  override = deps;
}
