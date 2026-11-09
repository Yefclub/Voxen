// ============================================================================
// Capture submission (spec 220): synchronous checks, dedupe and enqueue.
// Shared by /api/captures and the PWA share target.
// ============================================================================

import { randomUUID } from 'node:crypto';

import { Prisma } from '../../../prisma-generated/client';
import { db } from '../db';
import { notifyNewJob, publishJobEvent } from '../job-events';
import {
  MAX_MEDIA_UPLOAD_BYTES,
  putUploadFile,
  sanitizeUploadFilename,
  uploadSourceUrl,
} from '../media-upload';
import { findTranscriptBySourceIdentity } from '../transcript-source-identity';
import { getCaptureDeps } from './deps';
import type { CaptureErrorCode } from './errors';
import { isCaptureUrlError, parseCaptureUrl } from './url';

export const CAPTURE_TYPES = ['CAPTURE_LINK', 'CAPTURE_UPLOAD'] as const;
export const ACTIVE_STATUSES = ['QUEUED', 'RUNNING'] as const;
const ACTIVE = ACTIVE_STATUSES;
// Spec 220 upload types: audio, video, image, PDF, text and Markdown. The
// content type is derived from the extension (browsers often send
// application/octet-stream) so the worker routes the file correctly.
const UPLOAD_CONTENT_TYPES: Readonly<Record<string, string>> = {
  aac: 'audio/aac',
  aiff: 'audio/aiff',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  mpga: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  wma: 'audio/x-ms-wma',
  avi: 'video/x-msvideo',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  mpeg: 'video/mpeg',
  webm: 'video/webm',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
};

export function captureUploadContentType(filename: string): string | null {
  const ext = filename.includes('.') ? (filename.split('.').pop()?.toLowerCase() ?? '') : '';
  return UPLOAD_CONTENT_TYPES[ext] ?? null;
}

export async function textRoleConfigured(userId: string): Promise<boolean> {
  return getCaptureDeps().ai.isRoleConfigured(userId, 'standard');
}

export async function enqueueCapture(
  data: Prisma.JobUncheckedCreateInput,
): Promise<{ id: string; deduped: boolean }> {
  try {
    const job = await db.job.create({ data, select: { id: true } });
    await publishJobEvent(data.userId, { jobId: job.id, stage: 'queued', percent: 0 }).catch(
      () => {},
    );
    await notifyNewJob(job.id).catch(() => {});
    return { id: job.id, deduped: false };
  } catch (error) {
    // Job_user_url_active_unique: a concurrent submit won the race.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const active = await db.job.findFirst({
        where: { userId: data.userId, sourceUrl: data.sourceUrl, status: { in: [...ACTIVE] } },
        select: { id: true },
      });
      if (active) return { id: active.id, deduped: true };
    }
    throw error;
  }
}

export type SubmitOutcome =
  | { kind: 'error'; status: 400 | 409 | 413 | 415; code: CaptureErrorCode }
  | { kind: 'job'; jobId: string; deduped: boolean }
  | { kind: 'existing'; transcriptId: string; title: string };

/** Spec 220 submit order: validate → active job → library → text role → enqueue. */
export async function submitCaptureUrl(userId: string, input: unknown): Promise<SubmitOutcome> {
  const parsed = parseCaptureUrl(input);
  if (isCaptureUrlError(parsed)) return { kind: 'error', status: 400, code: parsed.code };
  const candidates = [...new Set([parsed.canonical, parsed.url])];
  const active = await db.job.findFirst({
    where: { userId, sourceUrl: { in: candidates }, status: { in: [...ACTIVE] } },
    select: { id: true },
    orderBy: { queuedAt: 'desc' },
  });
  if (active) return { kind: 'job', jobId: active.id, deduped: true };
  for (const candidate of candidates) {
    const existing = await findTranscriptBySourceIdentity(db, userId, candidate);
    if (existing) {
      const doc = await db.transcript.findFirst({
        where: { id: existing.id, userId },
        select: { title: true },
      });
      return { kind: 'existing', transcriptId: existing.id, title: doc?.title ?? '' };
    }
  }
  if (!(await textRoleConfigured(userId)))
    return { kind: 'error', status: 409, code: 'AI_NOT_CONFIGURED' };
  const job = await enqueueCapture({
    userId,
    type: 'CAPTURE_LINK',
    status: 'QUEUED',
    sourceUrl: parsed.canonical,
    captureMeta: { submittedUrl: parsed.url, platform: parsed.platform.toLowerCase() },
  });
  return { kind: 'job', jobId: job.id, deduped: job.deduped };
}

/** Spec 220 upload order: text role → type → size → store → enqueue. */
export async function submitCaptureUpload(userId: string, file: File): Promise<SubmitOutcome> {
  if (!(await textRoleConfigured(userId)))
    return { kind: 'error', status: 409, code: 'AI_NOT_CONFIGURED' };
  const filename = sanitizeUploadFilename(file.name || 'arquivo');
  const contentType = captureUploadContentType(filename);
  if (!contentType) return { kind: 'error', status: 415, code: 'UNSUPPORTED' };
  if (file.size === 0) return { kind: 'error', status: 415, code: 'UNSUPPORTED' };
  if (file.size > MAX_MEDIA_UPLOAD_BYTES) return { kind: 'error', status: 413, code: 'TOO_LARGE' };
  const uploadId = randomUUID();
  const objectKey = await putUploadFile({
    userId,
    uploadId,
    filename,
    body: new Uint8Array(await file.arrayBuffer()),
    contentType,
  });
  const job = await enqueueCapture({
    userId,
    type: 'CAPTURE_UPLOAD',
    status: 'QUEUED',
    sourceUrl: uploadSourceUrl(uploadId, filename),
    captureMeta: { platform: 'upload', upload: { objectKey, filename, mimeType: contentType } },
  });
  return { kind: 'job', jobId: job.id, deduped: job.deduped };
}
