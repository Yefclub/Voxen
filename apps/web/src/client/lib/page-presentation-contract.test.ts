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
