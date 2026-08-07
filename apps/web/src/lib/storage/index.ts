import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { presignClient, s3Bucket, s3Client } from '../s3';

export type StorageDriver = 'local' | 's3';

export interface StoragePutInput {
  key: string;
  body:
    | string
    | Uint8Array
    | ArrayBuffer
    | Blob
    | ReadableStream<Uint8Array>
    | NodeJS.ReadableStream;
  contentType?: string;
  signal?: AbortSignal;
  maxBytes?: number;
}

export interface StorageObject {
  body: ReadableStream<Uint8Array>;
  contentLength: number;
  totalSize: number;
  contentType: string | null;
  contentRange: string | null;
}

export interface StorageHead {
  contentLength: number;
  contentType: string | null;
}

export interface StorageRange {
  start: number;
  end: number;
}

const STORAGE_KEYS = [
  'S3_ENDPOINT',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_BUCKET',
  'S3_REGION',
  'S3_FORCE_PATH_STYLE',
  'S3_PUBLIC_ENDPOINT',
  'S3_CREDS_PATH',
  'GARAGE_ENDPOINT',
  'GARAGE_ACCESS_KEY',
  'GARAGE_SECRET_KEY',
  'GARAGE_BUCKET',
  'GARAGE_REGION',
  'GARAGE_CREDS_PATH',
] as const;

export function resolveStorageDriver(env: NodeJS.ProcessEnv = process.env): StorageDriver {
  const explicit = env.STORAGE_DRIVER?.trim().toLowerCase();
  if (explicit) {
    if (explicit !== 'local' && explicit !== 's3') {
      throw new Error('STORAGE_DRIVER must be either local or s3');
    }
    return explicit;
  }
  return STORAGE_KEYS.some((key) => Boolean(env[key]?.trim())) ? 's3' : 'local';
}

export function storageLocalPath(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.STORAGE_LOCAL_PATH?.trim() || '/data/storage';
  if (!isAbsolute(value)) throw new Error('STORAGE_LOCAL_PATH must be an absolute path');
  const normalized = resolve(value);
  const cwd = resolve(process.cwd());
  if (
    normalized === sep ||
    normalized === cwd ||
    cwd.startsWith(`${normalized}${sep}`) ||
    normalized.startsWith(`${cwd}${sep}`)
  ) {
    throw new Error('STORAGE_LOCAL_PATH points to an unsafe application or root directory');
  }
  return normalized;
}

export function normalizeStorageKey(key: string): string {
  if (!key || key.includes('\0') || key.includes('\\') || isAbsolute(key)) {
    throw new Error('Invalid storage key');
  }
  const parts = key.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Invalid storage key');
  }
  return parts.join('/');
}

function localTarget(key: string): { root: string; target: string } {
  const root = storageLocalPath();
  const target = resolve(root, normalizeStorageKey(key));
  const rel = relative(root, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Storage key escaped root');
  return { root, target };
}

async function rejectSymlinks(root: string, target: string, includeTarget: boolean): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o750 });
  const rootReal = await realpath(root);
  const rel = relative(root, target);
  const segments = rel.split(sep).filter(Boolean);
  let current = root;
  const limit = includeTarget ? segments.length : Math.max(0, segments.length - 1);
  for (let index = 0; index < limit; index += 1) {
    current = resolve(current, segments[index]!);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink())
        throw new Error('Symbolic links are not allowed in storage paths');
      if (!entry.isDirectory() && index < limit - 1)
        throw new Error('Storage parent is not a directory');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      break;
    }
  }
  const resolvedParent = await realpath(dirname(target)).catch(() => rootReal);
  if (resolvedParent !== rootReal && !resolvedParent.startsWith(`${rootReal}${sep}`)) {
    throw new Error('Storage path escaped root through a symbolic link');
  }
}

function toNodeReadable(body: StoragePutInput['body']): NodeJS.ReadableStream {
  if (typeof body === 'string') return Readable.from([Buffer.from(body)]);
  if (body instanceof Uint8Array) return Readable.from([body]);
  if (body instanceof ArrayBuffer) return Readable.from([new Uint8Array(body)]);
  if (body instanceof Blob) return Readable.fromWeb(body.stream() as never);
  if (typeof (body as ReadableStream<Uint8Array>).getReader === 'function') {
    return Readable.fromWeb(body as never);
  }
  return body as NodeJS.ReadableStream;
}

async function localPut(input: StoragePutInput): Promise<number> {
  const { root, target } = localTarget(input.key);
  await rejectSymlinks(root, target, false);
  await mkdir(dirname(target), { recursive: true, mode: 0o750 });
  await rejectSymlinks(root, target, false);
  const temporary = `${target}.${randomUUID()}.tmp`;
  let bytes = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += Buffer.byteLength(chunk);
      if (input.maxBytes !== undefined && bytes > input.maxBytes) {
        callback(
          Object.assign(new Error('Storage upload exceeds configured limit'), { code: 'ETOOBIG' }),
        );
        return;
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      toNodeReadable(input.body),
      counter,
      createWriteStream(temporary, { flags: 'wx', mode: 0o640 }),
      { signal: input.signal },
    );
    const handle = await open(temporary, 'r');
    await handle.sync();
    await handle.close();
    await rename(temporary, target);
    return bytes;
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function s3Put(input: StoragePutInput): Promise<number> {
  const key = normalizeStorageKey(input.key);
  const knownLength =
    typeof input.body === 'string'
      ? Buffer.byteLength(input.body)
      : input.body instanceof Uint8Array
        ? input.body.byteLength
        : input.body instanceof ArrayBuffer
          ? input.body.byteLength
          : input.body instanceof Blob
            ? input.body.size
            : undefined;
  if (input.maxBytes !== undefined && knownLength !== undefined && knownLength > input.maxBytes) {
    throw Object.assign(new Error('Storage upload exceeds configured limit'), { code: 'ETOOBIG' });
  }
  let bytes = 0;
  const countedBody = toNodeReadable(input.body).pipe(
    new Transform({
      transform(chunk, _encoding, callback) {
        bytes += Buffer.byteLength(chunk);
        if (input.maxBytes !== undefined && bytes > input.maxBytes) {
          callback(
            Object.assign(new Error('Storage upload exceeds configured limit'), {
              code: 'ETOOBIG',
            }),
          );
          return;
        }
        callback(null, chunk);
      },
    }),
  );
  await s3Client().send(
    new PutObjectCommand({
      Bucket: s3Bucket(),
      Key: key,
      Body: countedBody as never,
      ContentLength: knownLength,
      ContentType: input.contentType,
    }),
    input.signal ? { abortSignal: input.signal } : undefined,
  );
  return knownLength ?? bytes;
}

export async function storagePut(input: StoragePutInput): Promise<number> {
  return resolveStorageDriver() === 'local' ? localPut(input) : s3Put(input);
}

function toWebBody(body: unknown): ReadableStream<Uint8Array> {
  const candidate = body as {
    transformToWebStream?: () => ReadableStream<Uint8Array>;
    getReader?: () => ReadableStreamDefaultReader<Uint8Array>;
  };
  if (candidate?.transformToWebStream) return candidate.transformToWebStream();
  if (candidate?.getReader) return candidate as ReadableStream<Uint8Array>;
  return Readable.toWeb(body as never) as unknown as ReadableStream<Uint8Array>;
}

async function localGet(key: string, range?: StorageRange): Promise<StorageObject> {
  const { root, target } = localTarget(key);
  await rejectSymlinks(root, target, true);
  const metadata = await stat(target);
  if (!metadata.isFile())
    throw Object.assign(new Error('Storage object is not a file'), { code: 'ENOENT' });
  const start = range?.start ?? 0;
  const end = range?.end ?? metadata.size - 1;
  if (start < 0 || end < start || start >= metadata.size || end >= metadata.size) {
    throw Object.assign(new Error('Invalid storage range'), {
      code: 'ERANGE',
      totalSize: metadata.size,
    });
  }
  const stream = createReadStream(target, { start, end });
  return {
    body: Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>,
    contentLength: end - start + 1,
    totalSize: metadata.size,
    contentType: null,
    contentRange: range ? `bytes ${start}-${end}/${metadata.size}` : null,
  };
}

async function s3Get(key: string, range?: StorageRange): Promise<StorageObject> {
  const response = await s3Client().send(
    new GetObjectCommand({
      Bucket: s3Bucket(),
      Key: normalizeStorageKey(key),
      Range: range ? `bytes=${range.start}-${range.end}` : undefined,
    }),
  );
  if (!response.Body) throw new Error('Storage object has no body');
  const contentLength = Number(response.ContentLength ?? 0);
  const totalSize = response.ContentRange
    ? Number(response.ContentRange.split('/').at(-1) ?? contentLength)
    : contentLength;
  return {
    body: toWebBody(response.Body),
    contentLength,
    totalSize,
    contentType: response.ContentType ?? null,
    contentRange: response.ContentRange ?? null,
  };
}

export async function storageGet(key: string, range?: StorageRange): Promise<StorageObject> {
  return resolveStorageDriver() === 'local' ? localGet(key, range) : s3Get(key, range);
}

export async function storageReadText(key: string): Promise<string> {
  if (resolveStorageDriver() === 'local') {
    const { root, target } = localTarget(key);
    await rejectSymlinks(root, target, true);
    return readFile(target, 'utf8');
  }
  const object = await s3Get(key);
  return new Response(object.body).text();
}

export async function storageHead(key: string): Promise<StorageHead> {
  if (resolveStorageDriver() === 'local') {
    const { root, target } = localTarget(key);
    await rejectSymlinks(root, target, true);
    const metadata = await stat(target);
    if (!metadata.isFile())
      throw Object.assign(new Error('Storage object is not a file'), { code: 'ENOENT' });
    return { contentLength: metadata.size, contentType: null };
  }
  const response = await s3Client().send(
    new HeadObjectCommand({ Bucket: s3Bucket(), Key: normalizeStorageKey(key) }),
  );
  return {
    contentLength: Number(response.ContentLength ?? 0),
    contentType: response.ContentType ?? null,
  };
}

export async function storageDelete(key: string): Promise<void> {
  if (process.env.S3_DELETE_DISABLED === 'true') return;
  if (resolveStorageDriver() === 'local') {
    const { root, target } = localTarget(key);
    await rejectSymlinks(root, target, true);
    await unlink(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    return;
  }
  await s3Client().send(
    new DeleteObjectCommand({ Bucket: s3Bucket(), Key: normalizeStorageKey(key) }),
  );
}

export async function storageDeletePrefix(prefix: string): Promise<void> {
  if (process.env.S3_DELETE_DISABLED === 'true') return;
  const normalized = normalizeStorageKey(prefix.replace(/\/$/, ''));
  if (!normalized.startsWith('workspaces/'))
    throw new Error('Refusing unsafe storage prefix deletion');
  if (resolveStorageDriver() === 'local') {
    const { root, target } = localTarget(normalized);
    await rejectSymlinks(root, target, true);
    await rm(target, { recursive: true, force: true });
    return;
  }
  let continuationToken: string | undefined;
  do {
    const page = await s3Client().send(
      new ListObjectsV2Command({
        Bucket: s3Bucket(),
        Prefix: `${normalized}/`,
        ContinuationToken: continuationToken,
      }),
    );
    const objects = (page.Contents ?? []).flatMap((object) =>
      object.Key ? [{ Key: object.Key }] : [],
    );
    if (objects.length > 0) {
      await s3Client().send(
        new DeleteObjectsCommand({ Bucket: s3Bucket(), Delete: { Objects: objects, Quiet: true } }),
      );
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}

export function storageSupportsDirectUpload(): boolean {
  return resolveStorageDriver() === 's3' && Boolean(process.env.S3_PUBLIC_ENDPOINT);
}

export async function storageCreateDirectUpload(input: {
  key: string;
  contentType: string;
  expiresIn: number;
}): Promise<string | null> {
  if (!storageSupportsDirectUpload()) return null;
  return getSignedUrl(
    presignClient(),
    new PutObjectCommand({
      Bucket: s3Bucket(),
      Key: normalizeStorageKey(input.key),
      ContentType: input.contentType,
    }),
    { expiresIn: input.expiresIn },
  );
}

export async function storageHealthCheck(): Promise<{ driver: StorageDriver; ok: true }> {
  const driver = resolveStorageDriver();
  const key = `system/health/${randomUUID()}`;
  await storagePut({ key, body: 'voxen-storage-health', contentType: 'text/plain' });
  const value = await storageReadText(key);
  await storageDelete(key);
  if (value !== 'voxen-storage-health') throw new Error('Storage read/write verification failed');
  return { driver, ok: true };
}
