// ============================================================================
// Upload de mídia para transcrição
// ============================================================================

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Bucket, s3Client } from './s3';

export const MAX_MEDIA_UPLOAD_BYTES = 500 * 1024 * 1024;
export const MAX_MEDIA_UPLOAD_REQUEST_BYTES = MAX_MEDIA_UPLOAD_BYTES + 10 * 1024 * 1024;

const MEDIA_EXTENSIONS = new Set([
  'aac',
  'aiff',
  'avi',
  'flac',
  'm4a',
  'm4v',
  'mkv',
  'mov',
  'mp3',
  'mp4',
  'mpeg',
  'mpga',
  'ogg',
  'opus',
  'wav',
  'webm',
  'wma',
]);

export function sanitizeUploadFilename(raw: string): string {
  const name = raw.split(/[\\/]/).pop()?.trim() || 'arquivo';
  const normalized = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 160);
  return normalized || 'arquivo';
}

export function uploadExtension(filename: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename);
  return match?.[1]?.toLowerCase() ?? '';
}

export function isSupportedMediaFile(filename: string, contentType: string): boolean {
  const type = contentType.toLowerCase();
  if (type.startsWith('audio/') || type.startsWith('video/')) return true;
  return MEDIA_EXTENSIONS.has(uploadExtension(filename));
}

export function uploadSourceUrl(uploadId: string, filename: string): string {
  return `upload://${uploadId}/${encodeURIComponent(filename)}`;
}

export function parseUploadSourceUrl(
  sourceUrl: string,
): { uploadId: string; filename: string } | null {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'upload:' || !url.hostname) return null;
  const rawFilename = url.pathname.replace(/^\//, '');
  if (!rawFilename) return null;
  const filename = sanitizeUploadFilename(decodeURIComponent(rawFilename));
  if (!/^[0-9a-f-]{36}$/i.test(url.hostname)) return null;
  return { uploadId: url.hostname, filename };
}

export function uploadObjectKey(userId: string, uploadId: string, filename: string): string {
  return `workspaces/${userId}/uploads/${uploadId}/${sanitizeUploadFilename(filename)}`;
}

export async function putUploadFile({
  userId,
  uploadId,
  filename,
  body,
  contentType,
}: {
  userId: string;
  uploadId: string;
  filename: string;
  body: Uint8Array;
  contentType: string;
}): Promise<string> {
  const key = uploadObjectKey(userId, uploadId, filename);
  await s3Client().send(
    new PutObjectCommand({
      Bucket: s3Bucket(),
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
    }),
  );
  return key;
}
