// ============================================================================
// Capture runtime dependencies: worker client + AI client adapter (spec 220)
// ============================================================================

import { generateStructured, resolveRole, transcribeAudio } from '../ai/client';
import type { CaptureAi, CaptureDeps } from './runner';
import { createCaptureWorkerClient } from './worker-client';

const NOT_CONFIGURED = new Set(['AI_NOT_CONFIGURED', 'STT_NOT_CONFIGURED']);

export const cloudCaptureAi: CaptureAi = {
  async isRoleConfigured(userId, role) {
    try {
      await resolveRole(userId, role);
      return true;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (typeof code === 'string' && NOT_CONFIGURED.has(code)) return false;
      throw error;
    }
  },
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
