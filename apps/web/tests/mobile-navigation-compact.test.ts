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

  test('reduz o botão que abre a sidebar e mantém o alvo acessível de 32 px', () => {
    const source = readClientSource('components/layout/mobile-menu-button.tsx');

    expect(source).toContain('left-2');
    expect(source).toContain('h-10 w-10');
    expect(source).toContain('shadow-sm shadow-black/10');
    expect(source).toContain('top-[calc(env(safe-area-inset-top)+0.5rem)]');
    expect(source).toContain('<PanelLeftOpen className="h-4 w-4" />');
  });

  test('chat mobile reserva safe-area, demais rotas mantêm 4rem e desktop não reserva faixa', () => {
    const source = readClientSource('components/layout/app-layout.tsx');

    expect(source).toContain('pt-[env(safe-area-inset-top)] md:pt-0');
    expect(source).toContain('pt-[calc(env(safe-area-inset-top)+4rem)]');
    expect(source).not.toContain('md:pt-[calc(env(safe-area-inset-top)+5rem)]');
  });

  test('page shell gives desktop pages a compact 20 px top clearance', () => {
    const source = readClientSource('components/ui/page-shell.tsx');
    const appLayout = readClientSource('components/layout/app-layout.tsx');

    expect(source).toContain('md:pt-5');
    expect(appLayout).toContain('sm:px-7 sm:pb-9 sm:pt-0 md:pt-5 xl:px-10');
    expect(appLayout).not.toContain('md:pt-[calc(env(safe-area-inset-top)+5rem)]');
  });
});
