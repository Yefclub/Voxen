import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function rule(css: string, selector: string): string {
  const matches = rules(css, selector);
  expect(matches).not.toHaveLength(0);
  return matches[0] ?? '';
}

function rules(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 'gs'))].map((match) =>
    (match[1] ?? '').replace(/\s+/g, ' ').trim(),
  );
}

describe('desktop scrollbar contract', () => {
  test('keeps an 8 px rounded track with only the logical directional controls', () => {
    const css = readFileSync(new URL('../src/client/scrollbar.css', import.meta.url), 'utf8');
    const entry = readFileSync(new URL('../src/client/main.tsx', import.meta.url), 'utf8');
    expect(entry).toContain("import './scrollbar.css'");
    expect(css).toContain('@media (pointer: fine) and (hover: hover)');
    expect(css).toContain('*::-webkit-scrollbar-button');
    expect(rule(css, '*::-webkit-scrollbar')).toContain('width: 8px; height: 8px;');
    expect(css).toMatch(
      /\*::-webkit-scrollbar-track\s*{[^}]*border-radius: 999px;[^}]*margin-block: 3px;[^}]*margin-inline: 3px;/s,
    );
    expect(css).toMatch(
      /\*::-webkit-scrollbar-button\s*{[^}]*appearance: none;[^}]*display: none;[^}]*width: 8px;[^}]*height: 8px;[^}]*border: 0;[^}]*background-color: transparent !important;[^}]*background-size: 3px 3px !important;[^}]*opacity: 0.85;/s,
    );
    expect(css).toMatch(
      /\*::-webkit-scrollbar-button:vertical:decrement:start,\s*\*::-webkit-scrollbar-button:vertical:increment:end,\s*\*::-webkit-scrollbar-button:horizontal:decrement:start,\s*\*::-webkit-scrollbar-button:horizontal:increment:end\s*{\s*display: block;/s,
    );
    expect(rule(css, '*::-webkit-scrollbar-button:hover')).toContain('opacity: 1;');
    expect(rules(css, '*::-webkit-scrollbar-button:vertical:decrement:start').join(' ')).toContain(
      'background-image: linear-gradient(135deg, transparent 50%, #fff 50%), linear-gradient(45deg, #fff 50%, transparent 50%) !important;',
    );
    expect(rules(css, '*::-webkit-scrollbar-button:vertical:increment:end').join(' ')).toContain(
      'background-image: linear-gradient(45deg, transparent 50%, #fff 50%), linear-gradient(135deg, #fff 50%, transparent 50%) !important;',
    );
    expect(
      rules(css, '*::-webkit-scrollbar-button:horizontal:decrement:start').join(' '),
    ).toContain(
      'background-image: linear-gradient(135deg, transparent 50%, #fff 50%), linear-gradient(45deg, transparent 50%, #fff 50%) !important;',
    );
    expect(rules(css, '*::-webkit-scrollbar-button:horizontal:increment:end').join(' ')).toContain(
      'background-image: linear-gradient(45deg, #fff 50%, transparent 50%), linear-gradient(135deg, #fff 50%, transparent 50%) !important;',
    );
    expect(
      rule(css, "[data-theme='light'] *::-webkit-scrollbar-button:vertical:decrement:start"),
    ).toContain(
      'background-image: linear-gradient(135deg, transparent 50%, #000 50%), linear-gradient(45deg, #000 50%, transparent 50%) !important;',
    );
    expect(
      rule(css, "[data-theme='light'] *::-webkit-scrollbar-button:vertical:increment:end"),
    ).toContain(
      'background-image: linear-gradient(45deg, transparent 50%, #000 50%), linear-gradient(135deg, #000 50%, transparent 50%) !important;',
    );
    expect(
      rule(css, "[data-theme='light'] *::-webkit-scrollbar-button:horizontal:decrement:start"),
    ).toContain(
      'background-image: linear-gradient(135deg, transparent 50%, #000 50%), linear-gradient(45deg, transparent 50%, #000 50%) !important;',
    );
    expect(
      rule(css, "[data-theme='light'] *::-webkit-scrollbar-button:horizontal:increment:end"),
    ).toContain(
      'background-image: linear-gradient(45deg, #000 50%, transparent 50%), linear-gradient(135deg, #000 50%, transparent 50%) !important;',
    );
  });
});
