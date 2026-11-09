// ============================================================================
// Capture UI state helpers (spec 220) — pure, testable without DOM or router
// ============================================================================

import type { CaptureAction, CaptureJob, CaptureProgressEvent, CaptureStatus } from './capture-api';

/** File picker filter: audio, video, image, PDF, text and Markdown. */
export const CAPTURE_FILE_ACCEPT =
  'audio/*,video/*,image/*,application/pdf,text/plain,text/markdown,.pdf,.txt,.md,.markdown';

const ACTIVE: ReadonlySet<CaptureStatus> = new Set(['QUEUED', 'RUNNING']);

export function isActiveCapture(job: Pick<CaptureJob, 'status'>): boolean {
  return ACTIVE.has(job.status);
}

export function isTerminalStage(stage: string): boolean {
  return (
    stage === 'done' ||
    stage === 'completed_with_warnings' ||
    stage === 'failed' ||
    stage === 'cancelled'
  );
}

function statusForStage(stage: string): CaptureStatus {
  switch (stage) {
    case 'queued':
      return 'QUEUED';
    case 'done':
      return 'DONE';
    case 'completed_with_warnings':
      return 'COMPLETED_WITH_WARNINGS';
    case 'failed':
      return 'FAILED';
    case 'cancelled':
      return 'CANCELLED';
    default:
      // A progress stage after a terminal one means the job was retried.
      return 'RUNNING';
  }
}

/** Folds one SSE payload into the job; a snapshot replaces it outright. */
export function applyCaptureEvent(job: CaptureJob, event: CaptureProgressEvent): CaptureJob {
  if ('snapshot' in event) return event.snapshot;
  if (event.jobId !== job.id) return job;
  return {
    ...job,
    stage: event.stage,
    status: statusForStage(event.stage),
    percent:
      typeof event.percent === 'number'
        ? event.percent
        : event.stage === 'queued'
          ? 0
          : job.percent,
  };
}

/** Newest first, one entry per id; `incoming` wins over what is already listed. */
export function mergeCaptures(current: CaptureJob[], incoming: CaptureJob[]): CaptureJob[] {
  const byId = new Map(current.map((job) => [job.id, job]));
  for (const job of incoming) byId.set(job.id, job);
  return [...byId.values()].sort((a, b) =>
    a.queuedAt === b.queuedAt ? b.id.localeCompare(a.id) : b.queuedAt.localeCompare(a.queuedAt),
  );
}

/** Error codes the capture page accepts from `?error=` (anything else is ignored). */
export const CAPTURE_PAGE_ERROR_CODES = [
  'INVALID_URL',
  'BLOCKED_ADDRESS',
  'UNSUPPORTED',
  'LOGIN_REQUIRED',
  'IP_BLOCKED',
  'RATE_LIMITED',
  'REMOVED',
  'NO_TEXT',
  'TOO_LARGE',
  'STT_NOT_CONFIGURED',
  'AI_NOT_CONFIGURED',
  'LLM_AUTH',
  'LLM_QUOTA',
  'LLM_FAILED',
  'WORKER_UNAVAILABLE',
  'TIMEOUT',
  'CANCELLED',
  'UNKNOWN',
  'SHARE_EMPTY',
  'SHARE_REJECTED',
  'SHARE_TOO_LARGE',
  'SHARE_LOGIN_FILES',
  'SHARE_RATE_LIMITED',
] as const;

export type CapturePageErrorCode = (typeof CAPTURE_PAGE_ERROR_CODES)[number];

export function isCapturePageErrorCode(value: unknown): value is CapturePageErrorCode {
  return (
    typeof value === 'string' && (CAPTURE_PAGE_ERROR_CODES as readonly string[]).includes(value)
  );
}

const CONFIGURE_CODES = new Set([
  'AI_NOT_CONFIGURED',
  'STT_NOT_CONFIGURED',
  'LLM_AUTH',
  'LLM_QUOTA',
]);
const UPLOAD_CODES = new Set([
  'UNSUPPORTED',
  'LOGIN_REQUIRED',
  'IP_BLOCKED',
  'NO_TEXT',
  'SHARE_LOGIN_FILES',
]);

/** Next step for a code that arrived without the server's description. */
export function actionForCode(code: string): CaptureAction {
  if (CONFIGURE_CODES.has(code)) return 'configure_ai';
  if (UPLOAD_CODES.has(code)) return 'upload';
  if (code === 'INVALID_URL' || code === 'BLOCKED_ADDRESS') return 'edit_url';
  if (code === 'RATE_LIMITED' || code === 'WORKER_UNAVAILABLE' || code === 'TIMEOUT')
    return 'retry';
  return 'none';
}

/** Whether a failed or cancelled job card should offer "try again". */
export function canRetry(job: Pick<CaptureJob, 'status' | 'error'>): boolean {
  if (job.status === 'CANCELLED') return true;
  if (job.status !== 'FAILED') return false;
  const action = job.error?.action ?? 'retry';
  return action === 'retry' || action === 'configure_ai' || action === 'upload';
}

/** What the capture page should do with its query string. */
export interface CapturePageIntent {
  focusJobId: string | null;
  existingTranscriptId: string | null;
  error: CapturePageErrorCode | null;
  sharedUrl: string | null;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function readCapturePageIntent(params: URLSearchParams): CapturePageIntent {
  const job = params.get('job');
  const existing = params.get('existing');
  const error = params.get('error');
  const shared = params.get('shared');
  let sharedUrl: string | null = null;
  if (shared && shared.length <= 4096) {
    try {
      const parsed = new URL(shared);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') sharedUrl = shared;
    } catch {
      sharedUrl = null;
    }
  }
  return {
    focusJobId: job && ID_PATTERN.test(job) ? job : null,
    existingTranscriptId: existing && ID_PATTERN.test(existing) ? existing : null,
    error: isCapturePageErrorCode(error) ? error : null,
    sharedUrl,
  };
}

/**
 * One-shot lock for the post-login auto submit of a shared URL. Returns true
 * only the first time a URL is claimed in this tab session.
 */
export function claimSharedSubmit(
  url: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
): boolean {
  const key = `voxen:capture:shared:${url}`;
  try {
    if (!storage) return true;
    if (storage.getItem(key)) return false;
    storage.setItem(key, String(Date.now()));
    return true;
  } catch {
    return true;
  }
}

/** Short human label for a job: document title, file name or the link itself. */
export function captureLabel(job: CaptureJob): string {
  if (job.transcript?.title) return job.transcript.title;
  if (job.filename) return job.filename;
  if (job.sourceUrl) {
    try {
      const url = new URL(job.sourceUrl);
      const path = `${url.pathname}${url.search}`.replace(/\/$/, '');
      return `${url.hostname.replace(/^www\./i, '')}${path}`;
    } catch {
      return job.sourceUrl;
    }
  }
  return job.id;
}

const PLATFORM_NAMES: Record<string, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  x: 'X',
  web: 'Web',
};

export function platformLabel(platform: string | null): string | null {
  if (!platform || platform === 'upload' || platform === 'other') return null;
  return PLATFORM_NAMES[platform] ?? platform;
}
