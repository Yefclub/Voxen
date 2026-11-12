import { expect, test } from '@playwright/test';
import { db } from '../src/lib/db';
import { cleanupWorkspace, seedWorkspace, type WorkspaceSeed } from './workspace-seed';

// These flows create and delete their own users in an isolated test database.
test.describe('mobile knowledge workspace (spec 225)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  let workspace: WorkspaceSeed | undefined;

  test.beforeEach(async ({ page }) => {
    const database = new URL(process.env.DATABASE_URL ?? '');
    expect(database.pathname).toMatch(/test|e2e/i);
    workspace = await seedWorkspace(page, 'frontend-mobile');
  });
  test.afterEach(async () => {
    if (workspace) await cleanupWorkspace(workspace.userId);
    workspace = undefined;
  });

  test('shows content above the fold and dismisses filter sheets without losing the search', async ({
    page,
  }) => {
    await page.goto('/transcricoes');
    const source = page
      .getByRole('link')
      .filter({ has: page.getByRole('heading', { name: 'Matrix source', exact: true }) });
    await expect(source).toBeVisible();
    const sourceBox = (await source.boundingBox())!;
    expect(sourceBox.y + sourceBox.height).toBeLessThan(764);
    await expect(page.getByRole('link', { name: 'Capturar', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Conversar', exact: true })).toHaveCount(0);
    const search = page.getByRole('searchbox');
    await search.fill('Matrix');
    await expect(page).toHaveURL(/q=Matrix/);
    for (const width of [390, 700]) {
      await page.setViewportSize({ width, height: 844 });
      const filters = page.getByRole('button', { name: /^Filtros/ });
      await filters.click();
      const sheet = page.getByRole('dialog');
      await expect(sheet).toBeVisible();
      const box = (await sheet.boundingBox())!;
      expect(box.width).toBeCloseTo(width, 0);
      expect(box.y + box.height).toBeCloseTo(844, 0);
      await page.goBack();
      await expect(sheet).toBeHidden();
      await expect(search).toHaveValue('Matrix');
      await expect(page).toHaveURL(/\/transcricoes\?q=Matrix/);
      await expect(filters).toBeFocused();
    }
  });

  test('keeps capture submission visible when the visual viewport shrinks for a keyboard', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const viewport = Object.assign(new EventTarget(), {
        height: 844,
        width: 390,
        offsetTop: 0,
        offsetLeft: 0,
        scale: 1,
      });
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    });
    await page.goto('/capturar');
    await page.getByRole('textbox', { name: 'Link para capturar' }).focus();
    await page.evaluate(() => {
      // The fixture simulates browser viewport events, not a physical OS keyboard.
      Object.assign(window.visualViewport!, { height: 500 });
      window.visualViewport!.dispatchEvent(new Event('resize'));
    });
    await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'open');
    await expect(page.locator('[data-mobile-bottom-nav]')).toBeHidden();
    const submit = (await page
      .getByRole('button', { name: 'Capturar', exact: true })
      .boundingBox())!;
    expect(submit.y + submit.height).toBeLessThanOrEqual(500);
    await page.getByRole('textbox', { name: 'Link para capturar' }).blur();
    await page.evaluate(() => {
      Object.assign(window.visualViewport!, { height: 844 });
      window.visualViewport!.dispatchEvent(new Event('resize'));
    });
    await expect(page.locator('[data-mobile-bottom-nav]')).toBeVisible();
  });

  test('opens a completed foreground document while preserving background history navigation', async ({
    page,
  }) => {
    const job = await db.job.create({
      data: {
        userId: workspace!.userId,
        type: 'CAPTURE_LINK',
        status: 'COMPLETED_WITH_WARNINGS',
        sourceUrl: 'https://example.test/matrix',
        transcriptId: workspace!.transcriptId,
        finishedAt: new Date(),
        progressStage: 'done',
        progressPercent: 100,
        captureMeta: { platform: 'web', warnings: ['images_not_described'] },
      },
    });
    await page.goto('/capturar');
    await expect(page.getByRole('link', { name: 'Abrir documento' })).toBeVisible();
    await expect(page).toHaveURL(/\/capturar$/);
    await page.goto(`/capturar?job=${job.id}`);
    await expect(page).toHaveURL(`/transcricoes/${workspace!.transcriptId}`);
    await expect(page.getByRole('heading', { name: 'Matrix source', exact: true })).toBeVisible();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'As imagens e quadros do vídeo não foram descritos.' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Opções do conteúdo', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(
      page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }),
    ).toBeInViewport();
    await page.goBack();
    await expect(page.getByRole('dialog')).toBeHidden();
    let submissions = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/captures')
        submissions += 1;
    });
    await page.goto('/capturar?shared=' + encodeURIComponent('https://example.test/matrix'));
    await expect(page.getByRole('textbox', { name: 'Link para capturar' })).toHaveValue(
      'https://example.test/matrix',
    );
    expect(submissions).toBe(0);
    await page.getByRole('button', { name: 'Capturar', exact: true }).click();
    await expect(page).toHaveURL(`/transcricoes/${workspace!.transcriptId}`);
    expect(submissions).toBe(1);
    await page.goto('/capturar?job=capture-that-does-not-exist');
    await expect(
      page.getByText('Esta captura não está disponível. Abra outra captura ou comece uma nova.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Nova captura' }).click();
    await expect(page.getByRole('textbox', { name: 'Link para capturar' })).toBeVisible();
    await page.route('**/api/captures/network-unavailable', (route) => route.abort('failed'));
    await page.goto('/capturar?job=network-unavailable');
    await expect(
      page.getByText('Esta captura não está disponível. Abra outra captura ou comece uma nova.'),
    ).toBeVisible();
  });
  test.describe('network response fixtures', () => {
    // Worker-owned fetches bypass Playwright routing, so these fixtures block registration.
    // Offline behavior is verified separately with an active production service worker.
    test.use({ serviceWorkers: 'block' });
    test('recovers account pages from network failures without inventing settings', async ({
      page,
    }) => {
      for (const { path, endpoint, ready } of [
        { path: '/conta', endpoint: '/api/account', ready: '#name' },
        { path: '/conta/mcp', endpoint: '/api/mcp/tokens', ready: '#mcp-token-label' },
        { path: '/conta/ia', endpoint: '/api/account/ai', ready: '#ai-key-openai' },
      ]) {
        let unavailable = true;
        await page.route(`**${endpoint}`, async (route) => {
          if (unavailable && route.request().method() === 'GET') {
            await route.fulfill({ status: 503, json: { error: 'Temporary connection failure' } });
          } else await route.continue();
        });
        await page.goto(path);
        const error = page
          .getByRole('alert')
          .filter({ has: page.getByRole('button', { name: 'Tentar novamente' }) });
        await expect(error).toBeVisible();
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(
          page.getByText('O OAuth MCP está desativado pelo administrador da instância.'),
        ).toHaveCount(0);
        unavailable = false;
        await error.getByRole('button', { name: 'Tentar novamente' }).click();
        await expect(error).toBeHidden();
        // Account controls return after the real response, without a full reload.
        if (path === '/conta/mcp')
          await expect(page.getByRole('heading', { name: 'Seus tokens' })).toBeVisible();
        else await expect(page.locator(ready)).toBeVisible();
        await expect(page.locator('main')).not.toHaveCSS('overflow-x', 'scroll');
      }
    });
    test('keeps a compact switch with a full touch target', async ({ page }) => {
      await page.route('**/api/mcp/tokens', (route) =>
        route.fulfill({ json: { tokens: [], allowCreate: true } }),
      );
      await page.goto('/conta/mcp');
      const control = page.locator('#mcp-write-access');
      await expect(control).toHaveAttribute('aria-checked', 'false');
      await control.scrollIntoViewIfNeeded();
      const box = (await control.boundingBox())!;
      expect(box.width).toBe(44);
      expect(box.height).toBe(24);
      // The hit region extends 10px above/below the visual track.
      await page.mouse.click(box.x + box.width / 2, box.y - 6);
      await expect(control).toHaveAttribute('aria-checked', 'true');
      await control.focus();
      await page.keyboard.press('Space');
      await expect(control).toHaveAttribute('aria-checked', 'false');
    });
    test('recovers administrative configuration failures without inventing empty policies', async ({
      page,
    }) => {
      await db.user.update({ where: { id: workspace!.userId }, data: { role: 'ADMIN' } });
      for (const { path, endpoint } of [
        { path: '/admin/usuarios', endpoint: '/api/admin/instance' },
        { path: '/admin/integracoes', endpoint: '/api/admin/config-revisions' },
        { path: '/admin/integracoes', endpoint: '/api/admin/mcp' },
        { path: '/admin/autenticacao', endpoint: '/api/admin/authentication/providers' },
      ]) {
        let unavailable = true;
        await page.route(`**${endpoint}`, async (route) => {
          if (unavailable && route.request().method() === 'GET')
            await route.fulfill({ status: 503, json: { error: 'Temporary connection failure' } });
          else await route.continue();
        });
        await page.goto(path);
        const error = page
          .getByRole('alert')
          .filter({ has: page.getByRole('button', { name: 'Tentar novamente' }) });
        await expect(error).toBeVisible();
        unavailable = false;
        await error.getByRole('button', { name: 'Tentar novamente' }).click();
        await expect(error).toBeHidden();
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      }
    });
  });
  test('defers installation during a capture and respects dismissal across navigation', async ({
    page,
  }) => {
    await page.goto('/capturar');
    await page
      .getByRole('textbox', { name: 'Link para capturar' })
      .fill('https://example.test/unsent');
    await page.evaluate(() => {
      const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt: async () => {},
        userChoice: Promise.resolve({ outcome: 'dismissed' }),
      });
      window.dispatchEvent(event);
    });
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Link para capturar' })).toHaveValue(
      'https://example.test/unsent',
    );
    await page.getByRole('link', { name: 'Biblioteca', exact: true }).click();
    const install = page.getByRole('dialog');
    await expect(install).toBeVisible();
    await install.getByRole('button', { name: 'Agora não', exact: true }).click();
    await expect(install).toBeHidden();
    await page.getByRole('link', { name: 'Capturar', exact: true }).click();
    await page.getByRole('link', { name: 'Biblioteca', exact: true }).click();
    await expect(install).toBeHidden();
  });
  test('keeps a pending update away from an unsent capture and applies it on the library', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.assign(window, { frontendDocumentInstance: Math.random().toString(36) });
    });
    await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === '/api/version'),
      page.goto('/capturar'),
    ]);
    const capture = page.getByRole('textbox', { name: 'Link para capturar' });
    await capture.fill('https://example.test/keep-this-draft');
    const original = await page.evaluate(
      () => (window as unknown as { frontendDocumentInstance: string }).frontendDocumentInstance,
    );
    let checks = 0;
    await page.route('**/api/version', (route) => {
      checks += 1;
      return route.fulfill({ json: { version: 'frontend-preview-225', gitSha: 'f'.repeat(40) } });
    });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => checks).toBeGreaterThan(0);
    // Wait beyond the real update fallback (3.5s), rather than mocking apply().
    await page.waitForTimeout(4300);
    await expect(capture).toHaveValue('https://example.test/keep-this-draft');
    expect(
      await page.evaluate(
        () => (window as unknown as { frontendDocumentInstance: string }).frontendDocumentInstance,
      ),
    ).toBe(original);
    await page.getByRole('link', { name: 'Biblioteca', exact: true }).click();
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as unknown as { frontendDocumentInstance: string }).frontendDocumentInstance,
          ),
        { timeout: 10000 },
      )
      .not.toBe(original);
  });
});
