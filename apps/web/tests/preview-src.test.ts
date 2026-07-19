import { describe, expect, test } from 'bun:test';
import { isRemoteThumbnailUrl, resolveTranscriptPreviewSrc } from '../src/client/lib/preview-src';

describe('resolveTranscriptPreviewSrc', () => {
  test('sempre usa endpoint interno para CDN remota', () => {
    const src = resolveTranscriptPreviewSrc(
      'tid1',
      'https://p16-common-sign.tiktokcdn.com/tos-foo/bar.image',
    );
    expect(src).toBe('/api/transcripts/tid1/preview');
  });

  test('mantém preview interno já estável', () => {
    expect(resolveTranscriptPreviewSrc('tid1', '/api/transcripts/tid1/preview')).toBe(
      '/api/transcripts/tid1/preview',
    );
  });

  test('null/vazio cai no preview interno', () => {
    expect(resolveTranscriptPreviewSrc('tid1', null)).toBe('/api/transcripts/tid1/preview');
    expect(resolveTranscriptPreviewSrc('tid1', '')).toBe('/api/transcripts/tid1/preview');
  });
});

describe('isRemoteThumbnailUrl', () => {
  test('detecta http(s)', () => {
    expect(isRemoteThumbnailUrl('https://x.com/a.jpg')).toBe(true);
    expect(isRemoteThumbnailUrl('/api/transcripts/x/preview')).toBe(false);
  });
});
