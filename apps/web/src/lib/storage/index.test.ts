import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import {
  normalizeStorageKey,
  resolveStorageDriver,
  storageDelete,
  storageDeletePrefix,
  storageGet,
  storageHead,
  storagePut,
  storageReadText,
} from './index';

const originalDriver = process.env.STORAGE_DRIVER;
const originalPath = process.env.STORAGE_LOCAL_PATH;
const tempRoots: string[] = [];

afterEach(async () => {
  if (originalDriver === undefined) delete process.env.STORAGE_DRIVER;
  else process.env.STORAGE_DRIVER = originalDriver;
  if (originalPath === undefined) delete process.env.STORAGE_LOCAL_PATH;
  else process.env.STORAGE_LOCAL_PATH = originalPath;
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function useLocalStorage(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'voxen-storage-'));
  tempRoots.push(root);
  process.env.STORAGE_DRIVER = 'local';
  process.env.STORAGE_LOCAL_PATH = root;
  return root;
}

describe('storage driver selection', () => {
  it('defaults to local and preserves legacy S3 inference', () => {
    expect(resolveStorageDriver({})).toBe('local');
    expect(resolveStorageDriver({ S3_BUCKET: 'legacy' })).toBe('s3');
    expect(resolveStorageDriver({ S3_REGION: 'us-east-1' })).toBe('s3');
    expect(resolveStorageDriver({ STORAGE_DRIVER: 'local', S3_BUCKET: 'legacy' })).toBe('local');
    expect(() => resolveStorageDriver({ STORAGE_DRIVER: 'disk' })).toThrow();
  });

  it('rejects traversal, absolute paths, and empty segments', () => {
    for (const key of ['', '../secret', '/etc/passwd', 'workspaces//file', 'a/./b', 'a\\b']) {
      expect(() => normalizeStorageKey(key)).toThrow();
    }
  });
});

describe('local storage contract', () => {
  it('atomically puts, reads, ranges, heads, and deletes objects', async () => {
    await useLocalStorage();
    const key = 'workspaces/user-a/transcripts/item.md';
    expect(await storagePut({ key, body: '0123456789', contentType: 'text/plain' })).toBe(10);
    expect(await storageReadText(key)).toBe('0123456789');
    expect(await storageHead(key)).toEqual({ contentLength: 10, contentType: null });
    const range = await storageGet(key, { start: 2, end: 5 });
    expect(await new Response(range.body).text()).toBe('2345');
    expect(range).toMatchObject({ contentLength: 4, totalSize: 10, contentRange: 'bytes 2-5/10' });
    await storageDelete(key);
    await expect(storageHead(key)).rejects.toThrow();
  });

  it('removes only an explicit workspace prefix', async () => {
    await useLocalStorage();
    await storagePut({ key: 'workspaces/user-a/a.txt', body: 'a' });
    await storagePut({ key: 'workspaces/user-b/b.txt', body: 'b' });
    await storageDeletePrefix('workspaces/user-a/');
    await expect(storageHead('workspaces/user-a/a.txt')).rejects.toThrow();
    expect(await storageReadText('workspaces/user-b/b.txt')).toBe('b');
    await expect(storageDeletePrefix('system/')).rejects.toThrow();
  });

  it('rejects symbolic links inside the storage root', async () => {
    const root = await useLocalStorage();
    const outside = await mkdtemp(join(tmpdir(), 'voxen-storage-outside-'));
    tempRoots.push(outside);
    await symlink(outside, join(root, 'workspaces'));
    await expect(
      storagePut({ key: 'workspaces/user-a/file.txt', body: 'blocked' }),
    ).rejects.toThrow('Symbolic links');
  });

  it('preserves the previous object and removes temporaries after a failed write', async () => {
    const root = await useLocalStorage();
    const key = 'workspaces/user-a/file.txt';
    await storagePut({ key, body: 'previous' });
    const failing = Readable.from(
      (async function* () {
        yield Buffer.from('replacement');
        throw new Error('stream failed');
      })(),
    );
    await expect(storagePut({ key, body: failing })).rejects.toThrow('stream failed');
    expect(await storageReadText(key)).toBe('previous');
    expect(
      (await readdir(join(root, 'workspaces/user-a'))).filter((name) => name.endsWith('.tmp')),
    ).toEqual([]);
  });

  it('enforces the real streamed size limit without replacing an existing object', async () => {
    await useLocalStorage();
    const key = 'workspaces/user-a/file.txt';
    await storagePut({ key, body: 'previous' });
    await expect(
      storagePut({ key, body: Readable.from(['1234', '5678']), maxBytes: 7 }),
    ).rejects.toMatchObject({ code: 'ETOOBIG' });
    expect(await storageReadText(key)).toBe('previous');
  });
});
