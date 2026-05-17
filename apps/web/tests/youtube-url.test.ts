import { describe, expect, it } from 'bun:test';
import { parseYoutubeUrl } from '../src/lib/youtube-url';

describe('parseYoutubeUrl', () => {
  it.each([
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/abc_DEF-123', 'abc_DEF-123'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['  https://youtu.be/dQw4w9WgXcQ  ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'dQw4w9WgXcQ'],
  ])('parses %s → %s', (input, videoId) => {
    const result = parseYoutubeUrl(input);
    expect(result).not.toBeNull();
    expect(result!.videoId).toBe(videoId);
    expect(result!.canonical).toBe(`https://youtu.be/${videoId}`);
  });

  it.each([
    'not a url',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/',
    'https://youtu.be/',
    'https://youtu.be/short', // < 11 chars
    'https://youtu.be/too_long_id_xx', // > 11 chars
    'https://youtu.be/invalid!chars',
    'https://vimeo.com/12345',
    'ftp://youtu.be/dQw4w9WgXcQ',
    '',
  ])('rejects %s', (input) => {
    expect(parseYoutubeUrl(input)).toBeNull();
  });

  it('returns null for non-string input', () => {
    // @ts-expect-error testando contrato em runtime — input não-string deve ser rejeitado
    expect(parseYoutubeUrl(null)).toBeNull();
    // @ts-expect-error testando contrato em runtime — input não-string deve ser rejeitado
    expect(parseYoutubeUrl(undefined)).toBeNull();
  });
});
