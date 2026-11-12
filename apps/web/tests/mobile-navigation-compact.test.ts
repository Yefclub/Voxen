import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function readClientSource(relativePath: string): string {
  return readFileSync(new URL(`../src/client/${relativePath}`, import.meta.url), 'utf8');
}

describe('chrome de navegação mobile compacto', () => {
  test('topbar é uma fileira persistente com seção, aparência e conta separadas', () => {
    const source = readClientSource('components/layout/topbar.tsx');

    expect(source).toContain('data-app-header');
    expect(source).toContain('md:h-14');
    expect(source).toContain("aria-label={t('shell.currentSection')}");
    expect(source).toContain('data-sidebar-toggle');
    expect(source).toContain('aria-controls="desktop-sidebar"');
    expect(source).toContain('<AppearanceMenu />');
    expect(source).toContain('theme.appearance');
    expect(source).not.toContain('toggleAppearance()');
    expect(source).toContain('h-10 w-10');
    expect(source).toContain('md:h-8 md:w-8');
  });

  test('mobile navigation controls occupy the header flow and keep touch targets', () => {
    for (const file of ['mobile-menu-button.tsx', 'mobile-back-button.tsx']) {
      const source = readClientSource(`components/layout/${file}`);
      expect(source).toContain('h-11 w-11');
      expect(source).not.toContain('className="fixed');
      expect(source).not.toContain('backdrop-blur');
    }
  });

  test('the persistent header owns its space without duplicate mobile clearance', () => {
    const layout = readClientSource('components/layout/app-layout.tsx');
    const shell = readClientSource('components/ui/page-shell.tsx');
    expect(layout).not.toContain('pt-[calc(env(safe-area-inset-top)+4rem)]');
    expect(layout).toContain('<Topbar');
    expect(shell).not.toContain('autoAlpha: 0');
    expect(shell).not.toContain('opacity: 0');
  });
});
