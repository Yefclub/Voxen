import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function readClientSource(relativePath: string): string {
  return readFileSync(new URL(`../src/client/${relativePath}`, import.meta.url), 'utf8');
}

describe('chrome de navegação mobile compacto', () => {
  test('topbar preserva alvos móveis de 40 px e compacta o chrome desktop para 32 px', () => {
    const source = readClientSource('components/layout/topbar.tsx');

    expect(source).toContain('right-2');
    expect(source).toContain('md:right-7');
    expect(source).toContain('md:right-9');
    expect(source).not.toContain('md:right-4');
    expect(source).not.toContain('md:right-5');
    expect(source).toContain('bg-transparent');
    expect(source).toContain('md:bg-[var(--color-app-bg-elevated)]/85');
    expect(source).toContain('top-[calc(env(safe-area-inset-top)+0.5rem)]');
    expect(source).toContain('md:top-[calc(env(safe-area-inset-top)+1rem)]');
    expect(source).toContain('h-10 w-10');
    expect(source).toContain('md:h-8 md:w-8');
    expect(source).toContain('md:gap-2');
    expect(source).toContain('md:px-2 md:py-1.5');
    expect(source).toContain('bg-[var(--color-app-bg)]/75');
    expect(source).toContain('md:inline-flex');
    expect(source).not.toContain('sm:inline-flex');
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
