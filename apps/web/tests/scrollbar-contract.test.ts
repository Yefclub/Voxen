import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('desktop scrollbar contract', () => {
  test('keeps rounded tracks and exposes directional controls at both ends', () => {
    const css = readFileSync(new URL('../src/client/scrollbar.css', import.meta.url), 'utf8');
    const entry = readFileSync(new URL('../src/client/main.tsx', import.meta.url), 'utf8');
    expect(entry).toContain("import './scrollbar.css'");
    expect(css).toContain('@media (pointer: fine) and (hover: hover)');
    expect(css).toContain('*::-webkit-scrollbar-button');
    expect(css).toContain(':vertical:decrement');
    expect(css).toContain(':vertical:increment');
    expect(css).toContain(':horizontal:decrement');
    expect(css).toContain(':horizontal:increment');
    expect(css).toMatch(
      /\*::-webkit-scrollbar-track\s*{[^}]*border-radius: 999px;[^}]*margin-block: 3px;[^}]*margin-inline: 3px;/s,
    );
    expect(css).toMatch(
      /\*::-webkit-scrollbar-button\s*{[^}]*appearance: none;[^}]*width: 12px;[^}]*height: 12px;[^}]*border: 0;[^}]*background-color: transparent !important;[^}]*background-size: 4px 4px !important;[^}]*opacity: 0.55;/s,
    );
    expect(css.match(/background-image:/g)).toHaveLength(8);
    expect(css).toContain("[data-theme='light'] *::-webkit-scrollbar-button:vertical:decrement");
  });
});
