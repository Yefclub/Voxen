// ============================================================================
// Capture API client (spec 220) — shapes mirror src/routes/captures.ts
// ============================================================================

export type CaptureStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'DONE'
  | 'COMPLETED_WITH_WARNINGS'
  | 'FAILED'
  | 'CANCELLED';

export type CaptureAction = 'retry' | 'upload' | 'configure_ai' | 'edit_url' | 'none';

export interface CaptureErrorInfo {
  code: string;
  message: string;
  action: CaptureAction;
  retryable?: boolean;
  settingsUrl?: string;
}

export interface CaptureJob {
  id: string;
  kind: 'link' | 'upload';
  status: CaptureStatus;
  sourceUrl: string | null;
  filename: string | null;
  platform: string | null;
  /** Non-fatal problems of a capture that still published (spec 221). */
  warnings: string[];
  stage: string | null;
  percent: number | null;
  attempt: number;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  retryAt: string | null;
  costUsd: number | null;
  reprocessOf: string | null;
  transcript: {
    id: string;
    title: string | null;
    method: string | null;
    model: string | null;
  } | null;
  error: CaptureErrorInfo | null;
}

export interface CaptureListResponse {
  captures: CaptureJob[];
  nextCursor: string | null;
}

export type CaptureSubmitResult =
  | { kind: 'job'; job: CaptureJob; deduped: boolean }
  | { kind: 'existing'; transcript: { id: string; title: string } }
  | { kind: 'error'; status: number; error: CaptureErrorInfo | null; message: string | null };

/** Progress event as sent by GET /api/captures/:id/events (`event: progress`). */
export type CaptureProgressEvent =
  | {
      id: string;
      jobId: string;
      stage: string;
      percent?: number;
      transcriptId?: string;
      errorMsg?: string;
      ts: string;
    }
  | { snapshot: CaptureJob };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Normalizes every POST /api/captures* answer into one discriminated result. */
export function parseCaptureSubmit(status: number, body: unknown): CaptureSubmitResult {
  if (status >= 200 && status < 300 && isRecord(body)) {
    if (body.existing === true && isRecord(body.transcript)) {
      return {
        kind: 'existing',
        transcript: {
          id: String(body.transcript.id ?? ''),
          title: typeof body.transcript.title === 'string' ? body.transcript.title : '',
        },
      };
    }
    if (isRecord(body.job) && typeof body.job.id === 'string') {
      return {
        kind: 'job',
        job: body.job as unknown as CaptureJob,
        deduped: body.deduped === true,
      };
    }
  }
  const raw = isRecord(body) ? body.error : null;
  if (isRecord(raw) && typeof raw.code === 'string') {
    return {
      kind: 'error',
      status,
      error: {
        code: raw.code,
        message: typeof raw.message === 'string' ? raw.message : '',
        action: (typeof raw.action === 'string' ? raw.action : 'none') as CaptureAction,
        retryable: raw.retryable === true,
        settingsUrl: typeof raw.settingsUrl === 'string' ? raw.settingsUrl : undefined,
      },
      message: typeof raw.message === 'string' ? raw.message : null,
    };
  }
  return { kind: 'error', status, error: null, message: typeof raw === 'string' ? raw : null };
}

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

async function postJson(path: string, body?: unknown): Promise<CaptureSubmitResult> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parseCaptureSubmit(res.status, await readJson(res));
}

export function submitCaptureLink(url: string): Promise<CaptureSubmitResult> {
  return postJson('/api/captures', { url });
}

export function reprocessDocument(transcriptId: string): Promise<CaptureSubmitResult> {
  return postJson(`/api/captures/reprocess/${encodeURIComponent(transcriptId)}`);
}

/** Multipart upload with progress (fetch has no upload progress events). */
export function uploadCaptureFile(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<CaptureSubmitResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/captures/upload');
    xhr.withCredentials = true;
    xhr.responseType = 'text';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      resolve(parseCaptureSubmit(xhr.status, body));
    };
    xhr.onerror = () => resolve({ kind: 'error', status: 0, error: null, message: null });
    const form = new FormData();
    form.set('file', file);
    xhr.send(form);
  });
}

export async function fetchCapture(id: string): Promise<CaptureJob | null> {
  const res = await fetch(`/api/captures/${encodeURIComponent(id)}`, { credentials: 'include' });
  if (!res.ok) return null;
  const body = await readJson(res);
  return isRecord(body) && isRecord(body.capture) ? (body.capture as unknown as CaptureJob) : null;
}

export async function fetchCaptures(cursor?: string | null): Promise<CaptureListResponse> {
  const query = new URLSearchParams({ limit: '20' });
  if (cursor) query.set('cursor', cursor);
  const res = await fetch(`/api/captures?${query.toString()}`, { credentials: 'include' });
  const body = await readJson(res);
  if (!res.ok || !isRecord(body) || !Array.isArray(body.captures)) {
    throw new Error(isRecord(body) && typeof body.error === 'string' ? body.error : res.statusText);
  }
  return body as unknown as CaptureListResponse;
}

/** Cancel or retry; answers the updated job or the server's message. */
export async function captureCommand(
  id: string,
  command: 'cancel' | 'retry',
): Promise<{ job: CaptureJob | null; result: CaptureSubmitResult | null }> {
  const res = await fetch(`/api/captures/${encodeURIComponent(id)}/${command}`, {
    method: 'POST',
    credentials: 'include',
  });
  const body = await readJson(res);
  if (res.ok && isRecord(body) && isRecord(body.capture)) {
    return { job: body.capture as unknown as CaptureJob, result: null };
  }
  return { job: null, result: parseCaptureSubmit(res.status, body) };
}
