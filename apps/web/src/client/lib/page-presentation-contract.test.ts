import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const clientRoot = join(import.meta.dir, '..');

function source(path: string): string {
  return readFileSync(join(clientRoot, path), 'utf8');
}

describe('page presentation contracts', () => {
  test('does not paint a focus frame around the update scroll region', () => {
    const modal = source('components/update-modal.tsx');
    const scrollRegion = modal.slice(
      modal.indexOf('data-update-scroll-region'),
      modal.indexOf('data-update-scroll-region') + 700,
    );

    expect(scrollRegion).not.toContain('focus-visible:ring');
    expect(scrollRegion).toContain('focus-visible:shadow');
  });

  test('headings carry the page identity without a duplicate eyebrow', () => {
    const pageShell = source('components/ui/page-shell.tsx');
    expect(pageShell).toContain('<h1');
    expect(pageShell).not.toContain('EyebrowIcon');
    expect(pageShell).not.toContain('uppercase tracking-[0.16em]');
  });

  test('page content is visible before any optional decoration runs', () => {
    const pageShell = source('components/ui/page-shell.tsx');
    expect(pageShell).not.toContain('autoAlpha: 0');
    expect(pageShell).not.toContain('opacity: 0');
  });
});
