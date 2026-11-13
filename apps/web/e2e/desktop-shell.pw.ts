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
      await expect(
        page.locator('[data-app-header]').getByRole('button', { name: /Workspace Matrix E2E/ }),
      ).toMatchAriaSnapshot(
        `- 'button "Menu do usuário: WM Workspace Matrix E2E"': Workspace Matrix E2E`,
      );
      for (const mode of ['light', 'dark']) {
        await page
          .getByRole('radio', {
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

  test('uses native account-menu keyboard navigation and clears search without losing focus', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/transcricoes');
    const search = page
      .getByRole('region', { name: 'Explore sua base de conhecimento' })
      .getByRole('searchbox', { name: 'Explore sua base de conhecimento' });
    const control = page.locator('.astryx-text-input');
    await expect(control).toBeVisible();
    await search.fill('Matrix');
    await expect(page).toHaveURL(/q=Matrix/);
    await control.getByRole('button', { name: /^Limpar/ }).click();
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('');
    await expect(page).not.toHaveURL(/q=Matrix/);
    await page.evaluate(() => {
      document.body.dataset.menuNavigationProof = 'retained';
    });
    const trigger = page.getByRole('button', { name: /^Menu do usuário:/ });
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    const menu = page.getByRole('menu');
    await expect(menu).toHaveClass(/astryx-dropdown-menu/);
    await page.keyboard.press('Home');
    await expect(page.getByRole('menuitem', { name: 'Perfil', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Perfil', exact: true }).click();
    await expect(page).toHaveURL(/\/conta$/);
    await expect(page.locator('#name')).toBeVisible();
    expect(await page.evaluate(() => document.body.dataset.menuNavigationProof)).toBe('retained');
    await page.goto('/transcricoes');
    await page.route('**/api/me', async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      // Language is instance-owned; keep the real authenticated owner unchanged.
      await route.fulfill({ response, json: { ...body, language: 'en' } });
    });
    await page.reload();
    const english = page
      .getByRole('region', { name: 'Explore your knowledge base' })
      .getByRole('searchbox', { name: 'Explore your knowledge base' });
    await english.fill('Matrix');
    await page
      .getByRole('button', { name: 'Clear Explore your knowledge base', exact: true })
      .click();
    await expect(english).toHaveValue('');
    await expect(english).toBeFocused();
  });

  test('uses native theme keyboard selection and restores focus from appearance settings', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/transcricoes');
    const modes = page.getByRole('radiogroup', { name: 'Tema', exact: true });
    const light = modes.getByRole('radio', { name: 'Mudar para tema claro' });
    const dark = modes.getByRole('radio', { name: 'Mudar para tema escuro' });
    await light.click();
    await light.focus();
    await page.keyboard.press('ArrowRight');
    await expect(dark).toBeFocused();
    await expect(dark).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const trigger = page.getByRole('button', { name: 'Aparência', exact: true });
    await trigger.click();
    const appearance = page.getByRole('dialog', { name: 'Aparência', exact: true });
    await expect(appearance).toBeVisible();
    await appearance.getByText('Mudar para tema claro', { exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.keyboard.press('Escape');
    await expect(appearance).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('preserves capture input refs, pending submission and accessible errors in the native field', async ({
    page,
  }) => {
    await page.goto('/capturar');
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let submissions = 0;
    await page.route('**/api/captures', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      submissions += 1;
      expect(route.request().postDataJSON()).toEqual({ url: 'invalid capture' });
      await gate;
      await route.fulfill({
        status: 400,
        json: { error: { code: 'INVALID_URL', action: 'edit_url' } },
      });
    });
    const input = page.getByRole('textbox', { name: 'Link para capturar' });
    const submit = page.getByRole('button', { name: 'Capturar', exact: true });
    try {
      await expect(input).toHaveAttribute('maxlength', '4096');
      await expect(input).toHaveAttribute('inputmode', 'url');
      await input.fill('invalid capture');
      await input.press('Enter');
      await expect.poll(() => submissions).toBe(1);
      await expect(submit).toHaveAttribute('aria-disabled', 'true');
      await input.press('Enter');
      release();
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      await expect(input).toBeFocused();
      await expect(input).toHaveValue('invalid capture');
      const description = await input.getAttribute('aria-describedby');
      expect(description).toBeTruthy();
      await expect(page.locator(`[id="${description}"]`)).toBeVisible();
      await expect(submit).not.toHaveAttribute('aria-disabled', 'true');
      expect(submissions).toBe(1);
    } finally {
      release();
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
      await page.keyboard.press('Escape');
      await expect(guard).toBeVisible();
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

    test('covers an open native appearance popup when rotated and keeps focus contained', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        const orientation = Object.assign(new EventTarget(), { type: 'portrait-primary' });
        Object.defineProperty(screen, 'orientation', { configurable: true, value: orientation });
      });
      await page.goto('/capturar');
      await page.getByRole('button', { name: 'Aparência', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Aparência', exact: true })).toBeVisible();
      await page.evaluate(() => {
        Object.assign(screen.orientation, { type: 'landscape-primary' });
        screen.orientation.dispatchEvent(new Event('change'));
      });
      const guard = page.getByRole('alertdialog', { name: 'Use a Voxen na vertical' });
      await expect(guard).toBeVisible();
      await expect(guard).toBeFocused();
      const centerIsGuard = await guard.evaluate((element) => {
        const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
        return element === top || element.contains(top);
      });
      expect(centerIsGuard).toBe(true);
      await page.keyboard.press('Escape');
      await expect(guard).toBeVisible();
      await expect(guard).toBeFocused();
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
