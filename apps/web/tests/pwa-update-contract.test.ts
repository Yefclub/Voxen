import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const webRoot = join(import.meta.dir, '..');
const repositoryRoot = join(webRoot, '../..');

describe('contrato de atualização do PWA', () => {
  test('navega pela rede antes do cache e não precacheia index.html', () => {
    const config = readFileSync(join(webRoot, 'vite.config.ts'), 'utf8');

    expect(config).toContain("registerType: 'prompt'");
    expect(config).toContain('injectRegister: false');
    expect(config).toContain('navigateFallback: null');
    expect(config).toContain('navigationPreload: true');
    expect(config).toContain('cleanupOutdatedCaches: true');
    expect(config).toContain("importScripts: ['pwa-cache-cleanup.js']");
    expect(config).toContain("globPatterns: ['**/*.{js,css,ico,png,svg,woff2}']");
    expect(config).toContain("handler: 'NetworkFirst'");
    expect(config).toContain('cacheName: `voxen-navigation-${BUILD_ID}`');
    expect(config).toContain("request.mode === 'navigate'");
    expect(config).toContain("!url.pathname.startsWith('/api/')");
    expect(config).not.toContain('js,css,html,ico');
  });

  test('remove caches de navegação antigos ao ativar um novo build', () => {
    const cleanup = readFileSync(join(webRoot, 'public/pwa-cache-cleanup.js'), 'utf8');

    expect(cleanup).toContain("self.addEventListener('activate'");
    expect(cleanup).toContain("const VOXEN_NAVIGATION_CACHE_PREFIX = 'voxen-navigation-'");
    expect(cleanup).toContain('cacheName.startsWith(VOXEN_NAVIGATION_CACHE_PREFIX)');
    expect(cleanup).toContain('caches.delete(cacheName)');
    expect(cleanup).toContain("self.addEventListener('notificationclick'");
    expect(cleanup).toContain('event.notification?.data?.url');
  });

  test('prepara uma única atualização por build detectado', () => {
    const monitor = readFileSync(join(webRoot, 'src/client/lib/use-version-monitor.ts'), 'utf8');

    expect(monitor).toContain('registerSW({');
    expect(monitor).toContain('onNeedRefresh: () =>');
    expect(monitor).toContain('updateServiceWorker(true)');
    expect(monitor).toContain('const preparedBuildRef = useRef<string | null>(null)');
    expect(monitor).toContain('preparedBuildRef.current !== serverBuild');
    expect(monitor).toContain('void prepareUpdate()');
    expect(monitor).toContain('waitingServiceWorkerListeners.add(onWake)');
    expect(monitor).toContain('waitingServiceWorkerListeners.delete(onWake)');
    expect(monitor).toContain('waitingServiceWorker,');
  });

  test('aplica atualização em silêncio quando o chat não está streaming', () => {
    const core = readFileSync(join(webRoot, 'src/client/lib/update-modal-core.ts'), 'utf8');
    const modal = readFileSync(join(webRoot, 'src/client/components/update-modal.tsx'), 'utf8');

    expect(core).toContain('export function shouldSilentApplyVersion');
    expect(core).toContain('return hasUpdate && !streaming');
    expect(modal).toContain('shouldSilentApplyVersion');
    expect(modal).toContain('silentAppliedBuildRef');
    expect(modal).toContain('apply()');
  });

  test('propaga identidades canônica e nativa do Easypanel ao build do front', () => {
    for (const dockerfile of ['Dockerfile', 'apps/web/Dockerfile']) {
      const source = readFileSync(join(repositoryRoot, dockerfile), 'utf8');
      const frontBuild = source.slice(0, source.indexOf('RUN cd apps/web'));
      for (const name of [
        'VOXEN_VERSION',
        'VOXEN_GIT_SHA',
        'VOXEN_BUILT_AT',
        'GIT_SHA',
        'DEPLOY_TIMESTAMP',
      ]) {
        expect(frontBuild, `${dockerfile}: ${name}`).toContain(`ARG ${name}`);
        expect(frontBuild, `${dockerfile}: ${name}`).toContain(`${name}=`);
      }
    }
  });

  test('injeta no HTML a identidade do bundle compilado', () => {
    const config = readFileSync(join(webRoot, 'vite.config.ts'), 'utf8');
    const server = readFileSync(join(webRoot, 'src/index.ts'), 'utf8');

    expect(config).toContain("name: 'voxen-build-metadata'");
    expect(config).toContain("'voxen-build'");
    expect(config).toContain("'voxen-version'");
    expect(config).toContain("'voxen-built-at'");
    expect(config).toContain('process.env.VOXEN_GIT_SHA?.trim() || process.env.GIT_SHA?.trim()');
    expect(config).toContain('deployTimestampToIso(process.env.DEPLOY_TIMESTAMP)');
    expect(server).toContain('raw.includes(\'name="voxen-build"\')');
  });

  test('imagem Easypanel usa o resolvedor de versão canônica', () => {
    const workflow = readFileSync(
      join(repositoryRoot, '.github/workflows/easypanel-image.yml'),
      'utf8',
    );

    expect(workflow).toContain('package_version="$(node -p');
    expect(workflow).toContain('resolve-dev-image-version.mjs version');
    expect(workflow).toContain('resolve-dev-image-version.mjs docker-tag');
  });

  test.each([
    ['0.13.0-dev.1785372519', '0.13.0-dev.1785372519', '0.13.0-dev.1785372519'],
    ['0.13.0-rc.1', '0.13.0-rc.1', '0.13.0-rc.1'],
    ['0.13.0-beta.preview-2', '0.13.0-beta.preview-2', '0.13.0-beta.preview-2'],
    ['0.13.0-rc.1+image.7', '0.13.0-rc.1+image.7', '0.13.0-rc.1_image.7'],
    ['0.13.0', '0.14.1-dev.1785372519', '0.14.1-dev.1785372519'],
  ])(
    'resolve a identidade e a tag Docker para %s',
    (packageVersion, expectedVersion, expectedDockerTag) => {
      const runResolver = (outputKind: 'version' | 'docker-tag') =>
        Bun.spawnSync({
          cmd: [
            process.execPath,
            join(repositoryRoot, 'scripts/resolve-dev-image-version.mjs'),
            outputKind,
            packageVersion,
            '0.14.0',
            '1785372519',
          ],
          stdout: 'pipe',
          stderr: 'pipe',
        });

      const versionResult = runResolver('version');
      const dockerTagResult = runResolver('docker-tag');

      expect(versionResult.exitCode).toBe(0);
      expect(versionResult.stdout.toString()).toBe(expectedVersion);
      expect(dockerTagResult.exitCode).toBe(0);
      expect(dockerTagResult.stdout.toString()).toBe(expectedDockerTag);
      expect(dockerTagResult.stdout.toString()).toMatch(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/);
    },
  );

  test.skipIf(!existsSync(join(webRoot, 'dist/sw.js.map')))(
    'service worker gerado usa NetworkFirst e exclui o app shell do precache',
    () => {
      const sourceMap = JSON.parse(readFileSync(join(webRoot, 'dist/sw.js.map'), 'utf8')) as {
        sourcesContent?: string[];
      };
      const serviceWorkerSource = sourceMap.sourcesContent?.join('\n') ?? '';

      expect(serviceWorkerSource).toContain('workbox_navigation_preload_enable()');
      expect(serviceWorkerSource).toContain('new workbox_strategies_NetworkFirst');
      expect(serviceWorkerSource).toContain('"cacheName":"voxen-navigation-');
      expect(serviceWorkerSource).toContain('SKIP_WAITING');
      expect(serviceWorkerSource).not.toContain('workbox_core_clientsClaim()');
      expect(serviceWorkerSource).not.toContain('"url": "index.html"');
      expect(serviceWorkerSource).not.toContain('createHandlerBoundToURL("/index.html")');
    },
  );
});
