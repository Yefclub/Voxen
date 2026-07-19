import { describe, expect, test } from 'bun:test';
import {
  isExternalSourceUrl,
  sourceDisplayLine,
  sourceHostname,
  sourcePathLabel,
} from '../src/client/lib/source-url';

describe('source-url', () => {
  test('detecta URL externa', () => {
    expect(isExternalSourceUrl('https://www.tiktok.com/@u/video/1')).toBe(true);
    expect(isExternalSourceUrl('/api/transcripts/x/preview')).toBe(false);
    expect(isExternalSourceUrl(null)).toBe(false);
  });

  test('hostname sem www', () => {
    expect(sourceHostname('https://www.youtube.com/watch?v=abc')).toBe('youtube.com');
    expect(sourceHostname('https://tiktok.com/@x/video/1')).toBe('tiktok.com');
  });

  test('linha de exibição host+path', () => {
    const line = sourceDisplayLine('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(line).toContain('youtube.com');
    expect(line).toContain('watch');
  });

  test('path truncado', () => {
    const long = 'https://example.com/' + 'a'.repeat(80);
    const path = sourcePathLabel(long, 20);
    expect(path).not.toBeNull();
    expect(path!.length).toBeLessThanOrEqual(20);
  });
});
