import { describe, expect, test } from 'bun:test';
import { isBlockedHost, isCaptureUrlError, MAX_CAPTURE_URL_LENGTH, parseCaptureUrl } from './url';

function ok(input: string) {
  const parsed = parseCaptureUrl(input);
  if (isCaptureUrlError(parsed)) throw new Error(`expected ok for ${input}, got ${parsed.code}`);
  return parsed;
}

describe('parseCaptureUrl — rejections at submit time', () => {
  test.each([
    'http://127.0.0.1/',
    'http://10.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://192.168.1.10/admin',
    'http://172.16.5.4/',
    'http://100.64.0.1/',
    'http://0.0.0.0/',
    'http://2130706433/',
    'http://0x7f.0.0.1/',
    'http://0177.0.0.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:a9fe:a9fe]/',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
    'http://localhost:3000/',
    'http://api.localhost/',
    'http://metadata.google.internal/',
    'http://intranet/',
    'http://printer.local/',
    'https://example.com:8443/',
  ])('blocks %s', (input) => {
    expect(parseCaptureUrl(input)).toEqual({ code: 'BLOCKED_ADDRESS' });
  });

  test.each([
    '',
    '   ',
    'not a url',
    'ftp://example.com/file',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:pass@example.com/',
    `https://example.com/${'a'.repeat(MAX_CAPTURE_URL_LENGTH)}`,
  ])('rejects %p as invalid', (input) => {
    expect(parseCaptureUrl(input)).toEqual({ code: 'INVALID_URL' });
  });

  test('rejects non-string input', () => {
    expect(parseCaptureUrl(42)).toEqual({ code: 'INVALID_URL' });
    expect(parseCaptureUrl(null)).toEqual({ code: 'INVALID_URL' });
  });
});

describe('parseCaptureUrl — canonical identity', () => {
  test('YouTube variants collapse to the stored canonical form', () => {
    for (const input of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc&t=30',
      'https://youtu.be/dQw4w9WgXcQ?si=tracking',
      'https://m.youtube.com/shorts/dQw4w9WgXcQ',
    ]) {
      const parsed = ok(input);
      expect(parsed.platform).toBe('YOUTUBE');
      expect(parsed.canonical).toBe('https://youtu.be/dQw4w9WgXcQ');
      expect(parsed.platformId).toBe('dQw4w9WgXcQ');
    }
  });

  test('X and Twitter status links collapse to x.com/i/status', () => {
    expect(ok('https://twitter.com/someone/status/2087524884410736840?s=20').canonical).toBe(
      'https://x.com/i/status/2087524884410736840',
    );
    expect(ok('https://mobile.x.com/a/status/2087524884410736840').platform).toBe('X');
  });

  test('TikTok short links and Instagram reels keep their platform identity', () => {
    expect(ok('https://vt.tiktok.com/ZS4enEV8X/').canonical).toBe('https://vt.tiktok.com/ZS4enEV8X');
    expect(ok('https://www.instagram.com/reel/DWhWkoWgZ1D/?igsh=xyz').canonical).toBe(
      'https://www.instagram.com/reel/DWhWkoWgZ1D/',
    );
  });

  test('web URLs drop fragments and tracking params and sort the rest', () => {
    const parsed = ok('https://Example.com:443/post?b=2&utm_source=x&a=1&fbclid=z#section');
    expect(parsed.platform).toBe('WEB');
    expect(parsed.canonical).toBe('https://example.com/post?a=1&b=2');
    expect(parsed.url).toBe('https://example.com/post?b=2&utm_source=x&a=1&fbclid=z');
  });
});

describe('isBlockedHost', () => {
  test('allows public names and addresses', () => {
    expect(isBlockedHost('github.com')).toBe(false);
    expect(isBlockedHost('8.8.8.8')).toBe(false);
    expect(isBlockedHost('[2606:4700::1111]')).toBe(false);
  });
});
