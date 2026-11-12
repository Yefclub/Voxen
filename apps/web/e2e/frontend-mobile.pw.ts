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
  });
});
