import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function readClientSource(relativePath: string): string {
  return readFileSync(new URL(`../src/client/${relativePath}`, import.meta.url), 'utf8');
}

describe('chrome de navegação mobile compacto', () => {
  test('topbar é uma fileira persistente com seção, aparência e conta separadas', () => {
    const source = readClientSource('components/layout/topbar.tsx');

    expect(source).toContain('data-app-header');
    expect(source).toContain('h-[calc(3.5rem+env(safe-area-inset-top))]');
    expect(source).toContain("aria-label={t('shell.currentSection')}");
    const sidebar = readClientSource('components/layout/desktop-sidebar-navigation.tsx');
    expect(sidebar).toContain('data-sidebar-toggle');
    expect(sidebar).toContain('aria-controls="desktop-sidebar-navigation"');
    expect(source).toContain('<AppearanceMenu />');
    const appearance = readClientSource('components/layout/appearance-menu.tsx');
    expect(appearance).toContain('theme.appearance');
    expect(source).not.toContain('toggleAppearance()');
    expect(appearance).toContain('h-10 w-10');
    expect(appearance).toContain('md:h-8 md:w-8');
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
