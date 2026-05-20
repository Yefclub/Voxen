// ============================================================================
// Upload de arquivos para processamento assíncrono
// ============================================================================

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Bucket, s3Client } from './s3';

export const MAX_MEDIA_UPLOAD_BYTES = 500 * 1024 * 1024;
export const MAX_MEDIA_UPLOAD_REQUEST_BYTES = MAX_MEDIA_UPLOAD_BYTES + 10 * 1024 * 1024;
export const MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_DOCUMENT_UPLOAD_BYTES = 50 * 1024 * 1024;

export type UploadKind = 'media' | 'image' | 'document';

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

const IMAGE_EXTENSIONS = new Set(['gif', 'jpeg', 'jpg', 'png', 'webp']);

const DOCUMENT_EXTENSIONS = new Set([
  'csv',
  'docx',
  'epub',
  'htm',
  'html',
  'json',
  'md',
  'pdf',
  'pptx',
  'txt',
  'xls',
  'xlsx',
  'xml',
]);

const DOCUMENT_MIME_TYPES = new Set([
  'application/csv',
  'application/epub+zip',
  'application/json',
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/xml',
  'text/csv',
  'text/html',
  'text/markdown',
  'text/plain',
  'text/xml',
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

export function isSupportedImageFile(filename: string, contentType: string): boolean {
  const type = contentType.toLowerCase();
  if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type)) return true;
  return IMAGE_EXTENSIONS.has(uploadExtension(filename));
}

export function isSupportedDocumentFile(filename: string, contentType: string): boolean {
  const type = contentType.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  if (DOCUMENT_MIME_TYPES.has(type)) return true;
  return DOCUMENT_EXTENSIONS.has(uploadExtension(filename));
}

export function detectUploadKind(filename: string, contentType: string): UploadKind | null {
  if (isSupportedImageFile(filename, contentType)) return 'image';
  if (isSupportedMediaFile(filename, contentType)) return 'media';
  if (isSupportedDocumentFile(filename, contentType)) return 'document';
  return null;
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
