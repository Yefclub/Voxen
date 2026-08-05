import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function source(relativePath: string): string {
  return readFileSync(new URL(`../src/client/${relativePath}`, import.meta.url), 'utf8');
}

describe('desktop shell sources panel contract', () => {
  test('centers the focus rail across its complete visual gutter', () => {
    const sidebar = source('components/layout/sidebar.tsx');

    expect(sidebar).toContain('const FOCUS_SURFACE_GAP = 8');
    expect(sidebar).toContain('width: focusInterface ? RAIL_WIDTH + FOCUS_SURFACE_GAP : RAIL_WIDTH');
  });

  test('animates the chat surface and sources as background content', () => {
    const chat = source('pages/chat.tsx');

    expect(chat).toContain("sourceCitations && 'md:pr-[22rem]'");
    expect(chat).toContain('transition-[padding]');
    expect(chat).toContain('<AnimatePresence initial={false}>');
    expect(chat).toContain("initial={reduceMotion ? false : { x: '100%', opacity: 0 }}");
    expect(chat).toContain("exit={reduceMotion ? { opacity: 0 } : { x: '100%', opacity: 0 }}");
    expect(chat).toContain('bg-[var(--color-app-bg)]');
    expect(chat).not.toContain('w-[22rem] flex-col border-l');
  });

  test('publishes source visibility so the floating header retracts with the page', () => {
    const chat = source('pages/chat.tsx');
    const state = source('lib/chat-shell-state.ts');
    const topbar = source('components/layout/topbar.tsx');

    expect(state).toContain('sourcesOpen: boolean;');
    expect(state).toContain('export function setChatSourcesOpen(next: boolean): void');
    expect(chat).toContain('setChatSourcesOpen(sourceCitations !== null);');
    expect(topbar).toContain('sourcesOpen');
    expect(topbar).toContain("inChat && sourcesOpen && 'md:-translate-x-[22rem]'");
    expect(topbar).toContain('transition-transform');
    expect(topbar).toContain('motion-reduce:transition-none');
  });
});
