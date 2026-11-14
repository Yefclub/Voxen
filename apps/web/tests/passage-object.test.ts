import { describe, expect, test } from 'bun:test';
import { readPassageObject } from '../src/lib/passage-index/object';
import type { storageGet, StorageObject } from '../src/lib/storage';

const object = (bytes: Uint8Array, metadata = bytes.length, cancel = () => {}) =>
  ({
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
      cancel,
    }),
    contentLength: metadata,
    totalSize: metadata,
    contentType: 'text/markdown',
    contentRange: null,
  }) satisfies StorageObject;

describe('bounded passage object reads', () => {
  test('preserves literal UTF-8 across chunk boundaries', async () => {
    const text = '\uFEFF# Source\nUma organização 😀 mantém conteúdo.\n';
    const bytes = new TextEncoder().encode(text);
    const response = object(bytes);
    response.body = new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i++) controller.enqueue(bytes.slice(i, i + 1));
        controller.close();
      },
    });
    expect(await readPassageObject('canonical.md', async () => response)).toBe(text);
  });
  test('rejects excessive metadata before consuming a body and caps a falsely advertised body', async () => {
    let cancelled = false;
    const response = object(new Uint8Array(), 16_000_001);
    response.body = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    await expect(readPassageObject('large.md', async () => response)).rejects.toThrow(
      'INDEX_CAPACITY',
    );
    expect(cancelled).toBe(true);
    await expect(
      readPassageObject('unreliable.md', async () => object(new Uint8Array(16_000_001), 1)),
    ).rejects.toThrow('INDEX_CAPACITY');
    await expect(
      readPassageObject('long-text.md', async () =>
        object(new TextEncoder().encode('a'.repeat(4_000_001))),
      ),
    ).rejects.toThrow('INDEX_CAPACITY');
  });
  test('rejects malformed UTF-8 rather than publishing replacement characters', async () => {
    await expect(
      readPassageObject('invalid.md', async () => object(new Uint8Array([0xff]))),
    ).rejects.toThrow('INVALID_SOURCE');
  });
  test('aborts stalled headers and body reads within the bounded deadline', async () => {
    let aborted = false;
    const stalled: typeof storageGet = async (_key, _range, signal) =>
      new Promise((_resolve, reject) => {
        signal!.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(signal!.reason);
          },
          { once: true },
        );
      });
    await expect(readPassageObject('stalled.md', stalled, 20)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(aborted).toBe(true);
    let cancelled = false;
    const response = object(new Uint8Array());
    response.body = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      readPassageObject('stalled-body.md', async () => response, 20),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled).toBe(true);
  });
});
