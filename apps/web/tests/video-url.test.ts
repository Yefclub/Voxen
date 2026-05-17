import { describe, test, expect } from 'bun:test';
import { parseVideoUrl } from '../src/lib/video-url';

describe('parseVideoUrl - YouTube', () => {
  test.each([
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=42', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('canonicaliza %s', (input, expectedId) => {
    const r = parseVideoUrl(input);
    expect(r?.source).toBe('YOUTUBE');
    expect(r?.videoId).toBe(expectedId);
    expect(r?.canonical).toBe(`https://youtu.be/${expectedId}`);
  });
});

describe('parseVideoUrl - Instagram', () => {
  test.each([
    'https://www.instagram.com/reel/Abc123_XYZ/',
    'https://instagram.com/reel/Abc123_XYZ/',
    'https://www.instagram.com/p/Abc123_XYZ/',
    'https://www.instagram.com/tv/Abc123_XYZ/',
    'https://www.instagram.com/reels/Abc123_XYZ/',
  ])('aceita %s', (input) => {
    const r = parseVideoUrl(input);
    expect(r?.source).toBe('INSTAGRAM');
    expect(r?.videoId).toBe('Abc123_XYZ');
    expect(r?.canonical).toBe('https://www.instagram.com/reel/Abc123_XYZ/');
  });

  test('com username no path', () => {
    const r = parseVideoUrl('https://www.instagram.com/someuser/reel/Abc123_XYZ/');
    expect(r?.source).toBe('INSTAGRAM');
    expect(r?.videoId).toBe('Abc123_XYZ');
  });
});

describe('parseVideoUrl - TikTok', () => {
  test('formato @user/video/id', () => {
    const r = parseVideoUrl('https://www.tiktok.com/@someuser/video/7123456789012345678');
    expect(r?.source).toBe('TIKTOK');
    expect(r?.videoId).toBe('7123456789012345678');
    expect(r?.canonical).toBe('https://www.tiktok.com/@someuser/video/7123456789012345678');
  });

  test('short link vm.tiktok.com', () => {
    const r = parseVideoUrl('https://vm.tiktok.com/ZMabCdEf/');
    expect(r?.source).toBe('TIKTOK');
    expect(r?.canonical).toBe('https://vm.tiktok.com/ZMabCdEf');
  });

  test('short link vt.tiktok.com', () => {
    const r = parseVideoUrl('https://vt.tiktok.com/XyZ123/');
    expect(r?.source).toBe('TIKTOK');
  });
});

describe('parseVideoUrl - rejeições', () => {
  test.each([
    'https://vimeo.com/12345',
    'https://twitter.com/user/status/123',
    'https://facebook.com/watch/?v=123',
    'https://example.com/video',
    'ftp://youtube.com/watch?v=abc',
    '',
    'not a url',
    'https://youtu.be/short',
    'https://youtu.be/too_long_id_xx',
    'https://www.instagram.com/notreel/',
    'https://www.tiktok.com/just/path',
  ])('rejeita %s', (input) => {
    expect(parseVideoUrl(input)).toBeNull();
  });
});
