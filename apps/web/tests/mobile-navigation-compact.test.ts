import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function readClientSource(relativePath: string): string {
  return readFileSync(new URL(`../src/client/${relativePath}`, import.meta.url), 'utf8');
}

describe('chrome de navegação mobile compacto', () => {
  test('compacta o topbar somente abaixo do breakpoint desktop', () => {
    const source = readClientSource('components/layout/topbar.tsx');

    expect(source).toContain('right-2');
    expect(source).toContain('md:right-4');
    expect(source).toContain('gap-1');
    expect(source).toContain('md:gap-3');
    expect(source).toContain('px-1.5 py-1.5');
    expect(source).toContain('md:px-2.5 md:py-2');
    expect(source).toContain('top-[calc(env(safe-area-inset-top)+0.5rem)]');
    expect(source).toContain('md:top-[calc(env(safe-area-inset-top)+1rem)]');
    expect(source.match(/h-8 w-8/g)).toHaveLength(4);
    expect(source.match(/md:h-9 md:w-9/g)).toHaveLength(4);
    expect(source).toContain('md:inline-flex');
    expect(source).not.toContain('sm:inline-flex');
  });

  test('reduz o botão que abre a sidebar e mantém o alvo acessível de 32 px', () => {
    const source = readClientSource('components/layout/mobile-menu-button.tsx');

    expect(source).toContain('left-2');
    expect(source).toContain('h-8 w-8');
    expect(source).toContain('shadow-sm shadow-black/10');
    expect(source).toContain('top-[calc(env(safe-area-inset-top)+0.5rem)]');
    expect(source).toContain('<PanelLeftOpen className="h-4 w-4" />');
  });

  test('reduz a reserva vertical mobile sem alterar os 5rem do desktop', () => {
    const source = readClientSource('components/layout/app-layout.tsx');

    expect(source).toContain('pt-[calc(env(safe-area-inset-top)+4rem)]');
    expect(source).toContain('md:pt-[calc(env(safe-area-inset-top)+5rem)]');
  });
});
