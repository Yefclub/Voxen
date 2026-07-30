import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const clientRoot = join(import.meta.dir, '..');

function source(path: string): string {
  return readFileSync(join(clientRoot, path), 'utf8');
}

describe('page presentation contracts', () => {
  test('keeps the chat history and both composers in the same column', () => {
    const chat = source('pages/chat.tsx');

    expect(chat).not.toContain('max-w-5xl');
    expect(chat.match(/max-w-3xl/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  test('uses an unambiguous send glyph in the chat composer', () => {
    const chat = source('pages/chat.tsx');

    expect(chat).toContain('<Send className="h-4 w-4" />');
    expect(chat).not.toContain('<ArrowUp className="h-4 w-4" />');
  });

  test('does not paint a focus frame around the update scroll region', () => {
    const modal = source('components/update-modal.tsx');
    const scrollRegion = modal.slice(
      modal.indexOf('data-update-scroll-region'),
      modal.indexOf('data-update-scroll-region') + 700,
    );

    expect(scrollRegion).not.toContain('focus-visible:ring');
  });

  test('uses the wide operational shell for the extension page', () => {
    expect(source('pages/extensao.tsx')).toContain('<PageShell width="wide"');
  });

  test('page headers own an animated colored eyebrow icon', () => {
    const pageShell = source('components/ui/page-shell.tsx');

    expect(pageShell).toContain('icon: AnimatedIcon');
    expect(pageShell).toContain('isAnimated');
    expect(pageShell).toContain('iconClassName');
  });

  test('does not duplicate the vertical reservation made by the floating topbar', () => {
    const pageShell = source('components/ui/page-shell.tsx');

    expect(pageShell).toContain('pt-0');
    expect(pageShell).not.toContain('sm:py-9');
  });
});
