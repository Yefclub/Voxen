import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const webRoot = join(import.meta.dir, '..');
const repositoryRoot = join(webRoot, '../..');

describe('contrato de atualização do PWA', () => {
  test('navega pela rede antes do cache e não precacheia index.html', () => {
    const config = readFileSync(join(webRoot, 'vite.config.ts'), 'utf8');

    expect(config).toContain('navigateFallback: null');
    expect(config).toContain('navigationPreload: true');
    expect(config).toContain("globPatterns: ['**/*.{js,css,ico,png,svg,woff2}']");
    expect(config).toContain("handler: 'NetworkFirst'");
    expect(config).toContain("request.mode === 'navigate'");
    expect(config).toContain("!url.pathname.startsWith('/api/')");
    expect(config).not.toContain('js,css,html,ico');
  });

  test('prepara uma única atualização por build detectado', () => {
    const monitor = readFileSync(join(webRoot, 'src/client/lib/use-version-monitor.ts'), 'utf8');

    expect(monitor).toContain('const preparedBuildRef = useRef<string | null>(null)');
    expect(monitor).toContain('preparedBuildRef.current !== serverBuild');
    expect(monitor).toContain('void prepareUpdate()');
  });

  test('imagem Easypanel usa o resolvedor de versão canônica', () => {
    const workflow = readFileSync(
      join(repositoryRoot, '.github/workflows/easypanel-image.yml'),
      'utf8',
    );

    expect(workflow).toContain('package_version="$(node -p');
    expect(workflow).toContain('node scripts/resolve-dev-image-version.mjs');
  });

  test.each([
    ['0.13.0-dev.1785372519', '0.13.0-dev.1785372519'],
    ['0.13.0-rc.1', '0.13.0-rc.1'],
    ['0.13.0-beta.preview-2', '0.13.0-beta.preview-2'],
    ['0.13.0-rc.1+image.7', '0.13.0-rc.1+image.7'],
    ['0.13.0', '0.14.1-dev.1785372519'],
  ])('resolve a identidade de imagem para %s', (packageVersion, expected) => {
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        join(repositoryRoot, 'scripts/resolve-dev-image-version.mjs'),
        packageVersion,
        '0.14.0',
        '1785372519',
      ],
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe(expected);
  });

  test.skipIf(!existsSync(join(webRoot, 'dist/sw.js.map')))(
    'service worker gerado usa NetworkFirst e exclui o app shell do precache',
    () => {
      const sourceMap = JSON.parse(readFileSync(join(webRoot, 'dist/sw.js.map'), 'utf8')) as {
        sourcesContent?: string[];
      };
      const serviceWorkerSource = sourceMap.sourcesContent?.join('\n') ?? '';

      expect(serviceWorkerSource).toContain('workbox_navigation_preload_enable()');
      expect(serviceWorkerSource).toContain('new workbox_strategies_NetworkFirst');
      expect(serviceWorkerSource).toContain('"cacheName":"voxen-navigation-v1"');
      expect(serviceWorkerSource).not.toContain('"url": "index.html"');
      expect(serviceWorkerSource).not.toContain('createHandlerBoundToURL("/index.html")');
    },
  );
});
