import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string): string => readFileSync(join(import.meta.dir, '..', path), 'utf8');

describe('navegação mobile', () => {
  test('a rota raiz é Chat e não existe uma aba Início redundante', () => {
    const bottomNav = read('src/client/components/layout/mobile-bottom-nav.tsx');
    expect(bottomNav).toContain("{ to: '/', labelKey: 'shell.nav.chat', Icon: MessageCircle }");
    expect(bottomNav).not.toContain("labelKey: 'shell.nav.home'");
    expect(bottomNav).not.toContain('Icon: House');
  });

  test('drawer parcial permanece preparado, acessível e ligado ao progresso do gesto', () => {
    const drawer = read('src/client/components/layout/mobile-nav-drawer.tsx');
    const layout = read('src/client/components/layout/app-layout.tsx');
    expect(drawer).toContain('w-[88vw] max-w-[22rem]');
    expect(drawer).toContain('role="dialog"');
    expect(drawer).toContain('inert={open ? undefined : true}');
    expect(drawer).toContain("event.key === 'Escape'");
    expect(layout).toContain('onProgress: (progress) => mobileNavProgress.set(progress)');
    expect(layout).toContain('inert={mobileNavOpen ? true : undefined}');
  });

  test('regiões horizontais reservam o gesto e o drawer fechado não mantém sombra', () => {
    const markdown = read('src/client/components/ui/markdown.tsx');
    const gesture = read('src/client/lib/use-edge-swipe.ts');
    const drawer = read('src/client/components/layout/mobile-nav-drawer.tsx');

    expect(markdown).toContain('data-horizontal-scroll="true"');
    expect(markdown).toContain('data-drawer-gesture-ignore');
    expect(gesture).toContain("'[data-horizontal-scroll]'");
    expect(drawer).not.toContain('shadow-2xl');
    expect(drawer).toContain('boxShadow: panelShadow');
    expect(drawer).toContain('visibility: panelVisibility');
  });
});
