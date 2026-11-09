// Capture artifact storage (spec 220): the worker result for a job lives at
// workspaces/<userId>/captures/<jobId>/capture.json so retries skip downloads.

import { storageGet, storagePut } from '../storage';
import type { ClaimedCaptureJob } from './lease';
import type { CaptureArtifact, CaptureImageRef, CapturePlatformName } from './types';
import type { WorkerExtraction } from './worker-client';

export const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 1_500_000;

export function captureArtifactPrefix(userId: string, jobId: string): string {
  return `workspaces/${userId}/captures/${jobId}/`;
}

export function captureArtifactKey(userId: string, jobId: string): string {
  return `workspaces/${userId}/captures/${jobId}/capture.json`;
}

const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export async function loadArtifact(userId: string, jobId: string): Promise<CaptureArtifact | null> {
  try {
    const object = await storageGet(captureArtifactKey(userId, jobId));
    const parsed = JSON.parse(await new Response(object.body).text()) as CaptureArtifact;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveArtifact(
  userId: string,
  jobId: string,
  artifact: CaptureArtifact,
): Promise<void> {
  await storagePut({
    key: captureArtifactKey(userId, jobId),
    body: JSON.stringify(artifact),
    contentType: 'application/json',
  });
}

export async function readImage(ref: CaptureImageRef): Promise<Uint8Array | null> {
  try {
    const object = await storageGet(ref.key);
    return new Uint8Array(await new Response(object.body).arrayBuffer());
  } catch {
    return null;
  }
}

const PLATFORMS = new Set<CapturePlatformName>([
  'youtube',
  'tiktok',
  'instagram',
  'x',
  'web',
  'other',
  'upload',
]);

export async function artifactFromWorker(
  job: ClaimedCaptureJob,
  result: WorkerExtraction,
  upload: CaptureArtifact['upload'],
): Promise<CaptureArtifact> {
  const images: CaptureImageRef[] = [];
  for (const [index, image] of result.images.slice(0, MAX_IMAGES).entries()) {
    const ext = IMAGE_EXT[image.mime];
    if (!ext) continue;
    const bytes = Buffer.from(image.dataBase64, 'base64');
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) continue;
    const key = `workspaces/${job.userId}/captures/${job.id}/image-${index}.${ext}`;
    await storagePut({ key, body: new Uint8Array(bytes), contentType: image.mime });
    images.push({ kind: image.kind, mime: image.mime, key, bytes: bytes.byteLength });
  }
  const platform = upload ? 'upload' : (result.platform as CapturePlatformName);
  return {
    version: 1,
    platform: PLATFORMS.has(platform) ? platform : 'other',
    submittedUrl: upload ? null : job.sourceUrl,
    canonicalUrl: result.canonicalUrl,
    platformId: result.platformId,
    title: result.title,
    author: result.author,
    channel: result.channel,
    publishedAt: result.publishedAt,
    durationSec: result.durationSec,
    language: result.language,
    description: result.description,
    text: result.text,
    textKind: result.textKind,
    segments: Array.isArray(result.segments) ? result.segments : [],
    hasAudio: Boolean(result.hasAudio),
    images,
    extractor: result.extractor,
    upload: upload ?? null,
  };
}
