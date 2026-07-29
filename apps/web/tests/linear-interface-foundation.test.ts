import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ANIMATED_ICON_FALLBACKS,
  ANIMATED_ICON_FRAME_CLASS,
  PAGE_SHELL_WIDTHS,
  resetAnimationStyles,
  safelyRunAnimation,
  shouldAnimateDecoration,
} from '../src/client/lib/interface-foundation';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));

function read(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

describe('fundação visual Linear', () => {
  test('faz bootstrap no tema principal sem flash do tema legado', () => {
    const html = read('index.html');
    const theme = read('src/client/lib/theme.ts');
    const vite = read('vite.config.ts');

    expect(html).toContain('data-theme="linear"');
    expect(html).toContain("t === 'linear'");
    expect(html).toContain('content="#111113"');
    expect(theme).toContain("export const DEFAULT_THEME = 'linear'");
    expect(vite).toContain("theme_color: '#111113'");
    expect(vite).toContain("background_color: '#111113'");
  });

  test('centraliza ícones animados, dimensões e movimento reduzido sem Lucide direto', async () => {
    const icons = read('src/client/components/ui/icons.ts');
    const packageJson = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>;
    };
    const glob = new Bun.Glob('**/*.{ts,tsx}');
    const directImports: string[] = [];

    for await (const relativePath of glob.scan({
      cwd: `${WEB_ROOT}/src/client`,
      onlyFiles: true,
    })) {
      if (read(`src/client/${relativePath}`).includes('lucide-react')) {
        directImports.push(relativePath);
      }
    }

    expect(directImports).toEqual([]);
    expect(packageJson.dependencies?.['lucide-react']).toBeUndefined();
    expect(icons).toContain("from '@animateicons/react/lucide'");
    expect(icons).toContain('const reduceMotion = useReducedMotion()');
    expect(icons).toContain('shouldAnimateDecoration(reduceMotion, isAnimated)');
    expect(shouldAnimateDecoration(false)).toBe(true);
    expect(shouldAnimateDecoration(true)).toBe(false);
    expect(shouldAnimateDecoration(false, false)).toBe(false);
    expect(ANIMATED_ICON_FRAME_CLASS).toContain('[&_svg]:h-full [&_svg]:w-full');
    expect(ANIMATED_ICON_FRAME_CLASS).not.toContain('pointer-events');
    expect(ANIMATED_ICON_FALLBACKS.BrainCircuit).toBe('Brain');
    const aliasSection = icons.slice(icons.indexOf('export const AlertCircle'));
    const aliases = Object.fromEntries(
      [...aliasSection.matchAll(/export const (\w+) = accessibleIcon\((\w+)Icon\);/g)].map(
        ([, alias, component]) => [alias, component],
      ),
    );
    expect(aliases).toEqual(ANIMATED_ICON_FALLBACKS);
  });

  test('desliga timelines e springs decorativos quando movimento reduzido está ativo', () => {
    const pageShell = read('src/client/components/ui/page-shell.tsx');
    const sidebar = read('src/client/components/layout/sidebar.tsx');
    const drawer = read('src/client/components/layout/mobile-nav-drawer.tsx');

    expect(pageShell).toContain('shouldAnimateDecoration(reduceMotion, animate)');
    expect(sidebar.match(/useReducedMotion\(\)/g)?.length).toBeGreaterThanOrEqual(5);
    expect(sidebar).toContain("reduceMotion ? { duration: 0 } : { type: 'spring'");
    expect(sidebar).toContain("layoutId={reduceMotion ? undefined : 'sidebar-pill'}");
    expect(drawer).toContain('duration: reduceMotion ? 0 : 0.22');
  });

  test('mantém painel, spacer e drawer mobile coerentes e sem árvore fora de tela', () => {
    const sidebar = read('src/client/components/layout/sidebar.tsx');
    const drawer = read('src/client/components/layout/mobile-nav-drawer.tsx');

    expect(sidebar).toContain('const SIDEBAR_WIDTH = 288');
    expect(sidebar).toContain('style={{ width: SIDEBAR_WIDTH }}');
    expect(sidebar).toContain('SIDEBAR_WIDTH + 32');
    expect(drawer).toContain('fica preparada fora da tela');
    expect(drawer).toContain("open ? 'pointer-events-auto' : 'pointer-events-none'");
    expect(drawer).toContain('inert={open ? undefined : true}');
    expect(drawer).toContain('<SidebarModeBody user={user} hideHome />');
  });

  test('adota os primitives de página e dados nas telas administrativas', () => {
    const dataSurface = read('src/client/components/ui/data-surface.tsx');
    const integrations = read('src/client/pages/admin-integracoes.tsx');
    const users = read('src/client/pages/admin-usuarios.tsx');
    const costs = read('src/client/pages/admin-custos.tsx');

    expect(PAGE_SHELL_WIDTHS.wide).toBe('max-w-[1600px]');
    expect(PAGE_SHELL_WIDTHS.reading).toBe('max-w-4xl');
    expect(Object.values(PAGE_SHELL_WIDTHS).every((value) => value.startsWith('max-w-'))).toBe(
      true,
    );
    expect(dataSurface).toContain('export const DataSurface');
    expect(integrations).toContain('<PageHeader');
    expect(integrations).toContain('<PageShell width="workspace">');
    expect(users).toContain('<DataSurface>');
    expect(users).toContain('<PageShell width="wide">');
    expect(costs).toContain('<PageShell width="wide">');
  });

  test('mantém os controles utilizáveis quando a timeline não pode iniciar', () => {
    const removed: string[] = [];
    const targets = [
      {
        style: {
          removeProperty(property: string): string {
            removed.push(property);
            return '';
          },
        },
      },
    ];

    expect(
      safelyRunAnimation(
        () => {
          throw new Error('GSAP indisponível');
        },
        () => resetAnimationStyles(targets),
      ),
    ).toBe(false);
    expect(removed).toEqual(['opacity', 'visibility', 'transform']);
  });
});
