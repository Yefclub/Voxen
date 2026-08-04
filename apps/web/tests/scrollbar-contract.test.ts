import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 's'));
  expect(match).not.toBeNull();
  return (match?.[1] ?? '').replace(/\s+/g, ' ').trim();
}

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
      /\*::-webkit-scrollbar-button\s*{[^}]*appearance: none;[^}]*width: 12px;[^}]*height: 12px;[^}]*border: 0;[^}]*background-color: transparent !important;[^}]*background-size: 4px 4px !important;[^}]*opacity: 0.85;/s,
    );
    expect(rule(css, '*::-webkit-scrollbar-button:hover')).toContain('opacity: 1;');
    expect(rule(css, '*::-webkit-scrollbar-button:vertical:decrement')).toContain(
      'background-image: linear-gradient(135deg, transparent 50%, #fff 50%), linear-gradient(45deg, #fff 50%, transparent 50%) !important;',
    );
    expect(rule(css, '*::-webkit-scrollbar-button:vertical:increment')).toContain(
      'background-image: linear-gradient(45deg, transparent 50%, #fff 50%), linear-gradient(135deg, #fff 50%, transparent 50%) !important;',
    );
    expect(rule(css, '*::-webkit-scrollbar-button:horizontal:decrement')).toContain(
      'background-image: linear-gradient(135deg, transparent 50%, #fff 50%), linear-gradient(45deg, transparent 50%, #fff 50%) !important;',
    );
    expect(rule(css, '*::-webkit-scrollbar-button:horizontal:increment')).toContain(
      'background-image: linear-gradient(45deg, #fff 50%, transparent 50%), linear-gradient(135deg, #fff 50%, transparent 50%) !important;',
    );
    expect(
      rule(css, "[data-theme='light'] *::-webkit-scrollbar-button:vertical:decrement"),
    ).toContain(
      'background-image: linear-gradient(135deg, transparent 50%, #000 50%), linear-gradient(45deg, #000 50%, transparent 50%) !important;',
    );
    expect(
      rule(css, "[data-theme='light'] *::-webkit-scrollbar-button:vertical:increment"),
    ).toContain(
      'background-image: linear-gradient(45deg, transparent 50%, #000 50%), linear-gradient(135deg, #000 50%, transparent 50%) !important;',
    );
    expect(
      rule(css, "[data-theme='light'] *::-webkit-scrollbar-button:horizontal:decrement"),
    ).toContain(
      'background-image: linear-gradient(135deg, transparent 50%, #000 50%), linear-gradient(45deg, transparent 50%, #000 50%) !important;',
    );
    expect(
      rule(css, "[data-theme='light'] *::-webkit-scrollbar-button:horizontal:increment"),
    ).toContain(
      'background-image: linear-gradient(45deg, #000 50%, transparent 50%), linear-gradient(135deg, #000 50%, transparent 50%) !important;',
    );
  });
});
