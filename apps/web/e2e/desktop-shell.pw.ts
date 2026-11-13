import { expect, test } from '@playwright/test';
import { cleanupWorkspace, seedWorkspace, type WorkspaceSeed } from './workspace-seed';

test.describe('desktop chrome and portrait phone use (spec 226)', () => {
  let workspace: WorkspaceSeed | undefined;

  test.beforeEach(async ({ page }) => {
    expect(new URL(process.env.DATABASE_URL ?? '').pathname).toMatch(/test|e2e/i);
    workspace = await seedWorkspace(page, 'desktop-shell');
  });

  test.afterEach(async () => {
    if (workspace) await cleanupWorkspace(workspace.userId);
    workspace = undefined;
  });

  test('separates desktop chrome and gives hovered rows room without moving their content', async ({
    page,
  }, testInfo) => {
    for (const width of [1280, 2000]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/transcricoes');
      const sidebar = page.locator('#desktop-sidebar');
      await expect(sidebar.locator('.astryx-side-nav')).toBeVisible();
      await expect(page.locator('[data-app-header] .astryx-top-nav')).toBeVisible();
      expect((await page.locator('[data-app-header]').boundingBox())!.height).toBe(64);
      await expect(
        sidebar.getByRole('link', { name: /Voxen.*Base de conhecimento/i }),
      ).toBeVisible();
      await expect(
        page.locator('[data-app-header]').getByRole('button', { name: /Workspace Matrix E2E/ }),
      ).toBeVisible();
      for (const mode of ['light', 'dark']) {
        await page
          .getByRole('button', {
            name: mode === 'light' ? 'Mudar para tema claro' : 'Mudar para tema escuro',
            exact: true,
          })
          .click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
        const row = page.getByRole('link').filter({
          has: page.getByRole('heading', { name: 'Matrix source', exact: true }),
        });
        await expect(row).toBeVisible();
        const before = await row.locator('img').boundingBox();
        await row.hover();
        const geometry = await row.evaluate((element) => {
          const style = getComputedStyle(element);
          const surface = document.querySelector('[data-app-surface]')!;
          return {
            left: parseFloat(style.paddingLeft),
            right: parseFloat(style.paddingRight),
            radius: parseFloat(style.borderRadius),
            border: parseFloat(getComputedStyle(surface).borderLeftWidth),
            main: getComputedStyle(surface).backgroundColor,
            chrome: getComputedStyle(document.querySelector('#desktop-sidebar')!).backgroundColor,
          };
        });
        expect(geometry.left).toBeGreaterThanOrEqual(12);
        expect(geometry.right).toBeGreaterThanOrEqual(12);
        expect(geometry.radius).toBeGreaterThanOrEqual(10);
        expect(geometry.border).toBeGreaterThanOrEqual(1);
        expect(geometry.chrome).not.toBe(geometry.main);
        expect((await row.locator('img').boundingBox())!.x).toBeCloseTo(before!.x, 0);
        await row.focus();
        await expect(row).toBeFocused();
        await page.screenshot({ path: testInfo.outputPath(`desktop-${mode}-${width}.png`) });
      }
      const search = page.getByRole('searchbox');
      await search.fill('Matrix');
      await page.locator('#desktop-sidebar-close').click();
      await expect(sidebar).toHaveAttribute('inert', '');
      await expect(page.locator('[data-sidebar-toggle]')).toBeFocused();
      await expect(search).toHaveValue('Matrix');
      await page.locator('[data-sidebar-toggle]').click();
      await expect(page.locator('#desktop-sidebar-close')).toBeFocused();
      await expect(search).toHaveValue('Matrix');
      await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
    }
  });

  test('keeps an unsaved note editor mounted while the desktop sidebar moves', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const response = await page.request.post('/api/notes', {
      data: { kind: 'NOTE', title: 'Sidebar draft', content: 'Original body' },
    });
    expect(response.status()).toBe(201);
    const { note } = (await response.json()) as { note: { id: string } };
    let releaseSave = (): void => {};
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    let saving = false;
    await page.route(`**/api/notes/${note.id}`, async (route) => {
      if (route.request().method() === 'PATCH') {
        saving = true;
        await saveGate;
      }
      await route.continue();
    });
    try {
      await page.goto(`/notas/${note.id}`);
      await page.getByRole('button', { name: 'Editar', exact: true }).click();
      const editor = page.locator('.cm-content[contenteditable=true]');
      const original = await editor.elementHandle();
      const draft = 'This pending draft survives the desktop sidebar.';
      await editor.fill(draft);
      await expect.poll(() => saving).toBe(true);
      await page.locator('#desktop-sidebar-close').click();
      await expect(page.locator('[data-sidebar-toggle]')).toBeFocused();
      await expect(editor).toContainText(draft);
      expect(await editor.evaluate((element, previous) => element === previous, original)).toBe(
        true,
      );
      await page.locator('[data-sidebar-toggle]').click();
      await expect(page.locator('#desktop-sidebar-close')).toBeFocused();
      await expect(editor).toContainText(draft);
      expect(await editor.evaluate((element, previous) => element === previous, original)).toBe(
        true,
      );
      releaseSave();
      await expect
        .poll(async () => {
          const current = await page.request.get(`/api/notes/${note.id}`);
          return ((await current.json()) as { note: { content: string } }).note.content;
        })
        .toBe(draft);
    } finally {
      releaseSave();
    }
  });

  test.describe('phones', () => {
    test.use({
      viewport: { width: 390, height: 844 },
      screen: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });

    test('blocks actual landscape, preserves input, and ignores portrait keyboard resizing', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        const orientation = Object.assign(new EventTarget(), { type: 'portrait-primary' });
        Object.defineProperty(screen, 'orientation', { configurable: true, value: orientation });
      });
      await page.goto('/capturar');
      const input = page.getByRole('textbox', { name: 'Link para capturar' });
      await input.fill('https://example.test/unsent-draft');
      await input.focus();
      await page.setViewportSize({ width: 390, height: 300 });
      await expect(page.getByRole('alertdialog')).toBeHidden();
      await page.setViewportSize({ width: 844, height: 390 });
      await page.evaluate(() => {
        Object.assign(screen.orientation, { type: 'landscape-primary' });
        screen.orientation.dispatchEvent(new Event('change'));
      });
      const guard = page.getByRole('alertdialog', { name: 'Use a Voxen na vertical' });
      await expect(guard).toBeVisible();
      await expect(page.locator('[data-portrait-content]')).toHaveAttribute('inert', '');
      await expect(guard).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(guard).toBeFocused();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => {
        Object.assign(screen.orientation, { type: 'portrait-primary' });
        screen.orientation.dispatchEvent(new Event('change'));
      });
      await expect(guard).toBeHidden();
      await expect(input).toHaveValue('https://example.test/unsent-draft');
      await expect(input).toBeFocused();
      await expect(page.locator('[data-mobile-bottom-nav]')).toBeVisible();
      await page.getByRole('link', { name: 'Biblioteca', exact: true }).click();
      await page.getByRole('button', { name: /^Filtros/ }).click();
      const filters = page.getByRole('dialog', { name: 'Filtros da biblioteca' });
      await expect(filters).toBeVisible();
      await page.evaluate(() => {
        Object.assign(screen.orientation, { type: 'landscape-primary' });
        screen.orientation.dispatchEvent(new Event('change'));
      });
      await expect(guard).toBeVisible();
      await expect(guard).toBeFocused();
      await page.evaluate(() => {
        Object.assign(screen.orientation, { type: 'portrait-primary' });
        screen.orientation.dispatchEvent(new Event('change'));
      });
      await expect(guard).toBeHidden();
      await expect(filters).toBeVisible();
      await expect(filters).toContainText('Filtros da biblioteca');
      await page.goBack();
      await expect(filters).toBeHidden();
    });

    test('keeps the portrait fallback usable when installed native locking rejects', async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
        const orientation = Object.assign(new EventTarget(), {
          type: 'portrait-primary',
          lock: async () => {
            sessionStorage.setItem(
              'orientation-attempts',
              String(Number(sessionStorage.getItem('orientation-attempts')) + 1),
            );
            throw new DOMException('Fullscreen unavailable', 'NotSupportedError');
          },
        });
        Object.defineProperty(screen, 'orientation', { configurable: true, value: orientation });
      });
      await page.goto('/capturar');
      await expect
        .poll(() => page.evaluate(() => Number(sessionStorage.getItem('orientation-attempts'))))
        .toBeGreaterThan(0);
      await page.evaluate(() => {
        Object.assign(screen.orientation, { type: 'landscape-primary' });
        screen.orientation.dispatchEvent(new Event('change'));
      });
      await expect(
        page.getByRole('alertdialog', { name: 'Use a Voxen na vertical' }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('alertdialog')).toBeVisible();
      expect(errors).toEqual([]);
    });
  });

  test.describe('tablet browsers', () => {
    test.use({
      viewport: { width: 1024, height: 768 },
      screen: { width: 1024, height: 768 },
      hasTouch: true,
      isMobile: true,
    });

    test('allows landscape without displaying the phone instruction', async ({ page }) => {
      await page.goto('/capturar');
      await expect(page.getByRole('textbox', { name: 'Link para capturar' })).toBeVisible();
      await expect(page.getByRole('alertdialog')).toBeHidden();
    });
  });
});
