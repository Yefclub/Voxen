import { describe, expect, it } from 'bun:test';
import { buildOriginalResponseInit, parseSingleByteRange } from '../lib/transcript-media-range';

describe('transcript original byte ranges', () => {
  it('parses explicit, open-ended, and suffix ranges', () => {
    expect(parseSingleByteRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 });
    expect(parseSingleByteRange('bytes=7-', 10)).toEqual({ start: 7, end: 9 });
    expect(parseSingleByteRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(parseSingleByteRange('bytes=7-99', 10)).toEqual({ start: 7, end: 9 });
  });

  it('rejects unsatisfiable and multipart ranges', () => {
    expect(parseSingleByteRange('bytes=10-', 10)).toBeNull();
    expect(parseSingleByteRange('bytes=5-2', 10)).toBeNull();
    expect(parseSingleByteRange('bytes=0-1,4-5', 10)).toBeNull();
    expect(parseSingleByteRange('items=0-1', 10)).toBeNull();
  });

  it('builds provider-neutral 200 and 206 response headers', () => {
    expect(
      buildOriginalResponseInit({
        storageContentType: 'video/mp4',
        storageContentLength: 10,
        fallbackMime: null,
        filename: 'video.mp4',
      }),
    ).toMatchObject({ status: 200, headers: { 'accept-ranges': 'bytes', 'content-length': '10' } });
    expect(
      buildOriginalResponseInit({
        rangeHeader: 'bytes=2-5',
        storageContentType: 'video/mp4',
        storageContentLength: 4,
        storageContentRange: 'bytes 2-5/10',
        fallbackMime: null,
        filename: 'video.mp4',
      }),
    ).toMatchObject({
      status: 206,
      headers: { 'accept-ranges': 'bytes', 'content-range': 'bytes 2-5/10' },
    });
  });
});
