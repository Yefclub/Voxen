import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
    expect(icons).toContain('isAnimated: isAnimated ?? !reduceMotion');
    expect(icons).toContain('[&_svg]:h-full [&_svg]:w-full');
  });

  test('desliga timelines e springs decorativos quando movimento reduzido está ativo', () => {
    const pageShell = read('src/client/components/ui/page-shell.tsx');
    const sidebar = read('src/client/components/layout/sidebar.tsx');
    const drawer = read('src/client/components/layout/mobile-nav-drawer.tsx');

    expect(pageShell).toContain('if (!animate || reduceMotion) return');
    expect(sidebar.match(/useReducedMotion\(\)/g)?.length).toBeGreaterThanOrEqual(5);
    expect(sidebar).toContain("reduceMotion ? { duration: 0 } : { type: 'spring'");
    expect(sidebar).toContain("layoutId={reduceMotion ? undefined : 'sidebar-pill'}");
    expect(drawer).toContain('transition={{ duration: reduceMotion ? 0 : 0.16 }}');
  });

  test('mantém painel, spacer e drawer mobile coerentes e sem árvore fora de tela', () => {
    const sidebar = read('src/client/components/layout/sidebar.tsx');
    const drawer = read('src/client/components/layout/mobile-nav-drawer.tsx');

    expect(sidebar).toContain('const SIDEBAR_WIDTH = 288');
    expect(sidebar).toContain('style={{ width: SIDEBAR_WIDTH }}');
    expect(sidebar).toContain('SIDEBAR_WIDTH + 32');
    expect(drawer.match(/\{open && \(/g)?.length).toBe(2);
    expect(drawer).toContain('<SidebarModeBody user={user} hideHome />');
  });

  test('adota os primitives de página e dados nas telas administrativas', () => {
    const pageShell = read('src/client/components/ui/page-shell.tsx');
    const dataSurface = read('src/client/components/ui/data-surface.tsx');
    const integrations = read('src/client/pages/admin-integracoes.tsx');
    const users = read('src/client/pages/admin-usuarios.tsx');
    const costs = read('src/client/pages/admin-custos.tsx');

    expect(pageShell).toContain("wide: 'max-w-[1600px]'");
    expect(pageShell).toContain("reading: 'max-w-4xl'");
    expect(dataSurface).toContain('export const DataSurface');
    expect(integrations).toContain('<PageHeader');
    expect(integrations).toContain('<PageShell width="workspace">');
    expect(users).toContain('<DataSurface>');
    expect(users).toContain('<PageShell width="wide">');
    expect(costs).toContain('<PageShell width="wide">');
  });
});
