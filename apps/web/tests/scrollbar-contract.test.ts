import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('desktop scrollbar contract', () => {
  test('keeps rounded tracks and exposes directional controls at both ends', () => {
    const css = readFileSync(new URL('../src/client/index.css', import.meta.url), 'utf8');
    expect(css).toContain('*::-webkit-scrollbar-button:single-button');
    expect(css).toContain(':vertical:decrement');
    expect(css).toContain(':vertical:increment');
    expect(css).toContain(':horizontal:decrement');
    expect(css).toContain(':horizontal:increment');
    expect(css).toContain('margin-block: 3px');
    expect(css).toContain('border-radius: 999px');
  });
});
