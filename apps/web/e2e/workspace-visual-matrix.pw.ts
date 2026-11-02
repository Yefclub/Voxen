import { expect, test } from '@playwright/test';
import { cleanupWorkspace, seedWorkspace } from './workspace-seed';

test.describe('workspace visual matrix (spec 219)', () => {
  test.skip(process.env.VOXEN_E2E !== '1', 'Run against an isolated Voxen test database.');

  test('renders the detail page across the viewport matrix', async ({ page }, testInfo) => {
    const seed = await seedWorkspace(page, 'matrix');
    try {
      await page.goto(`/transcricoes/${seed.transcriptId}`);
      const graphSection = page.getByTestId('transcript-knowledge-graph');
      await expect(graphSection.getByText('Grafo deste conteúdo')).toBeVisible();

      for (const width of [320, 390, 820, 1024, 1280, 1600, 2560]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(graphSection.getByText('Grafo deste conteúdo')).toBeVisible();
        await expect(page.locator('header[data-app-header]')).toBeVisible();
        await page.screenshot({
          path: testInfo.outputPath(`matrix-detail-${width}.png`),
        });
      }
    } finally {
      await cleanupWorkspace(seed.userId);
    }
  });

  test('cycles the four themes without losing the reading surface', async ({ page }, testInfo) => {
    const seed = await seedWorkspace(page, 'themes');
    try {
      await page.goto(`/transcricoes/${seed.transcriptId}`);
      const graphSection = page.getByTestId('transcript-knowledge-graph');
      await expect(graphSection.getByText('Grafo deste conteúdo')).toBeVisible();
      for (const theme of ['linear', 'zinc', 'emerald', 'light'] as const) {
        const patched = await page.request.patch('/api/account', { data: { theme } });
        expect(patched.ok()).toBeTruthy();
        await page.reload();
        await expect
          .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
          .toBe(theme);
        await expect(graphSection.getByText('Grafo deste conteúdo')).toBeVisible();
        await expect(page.getByText('Matrix source').first()).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`matrix-theme-${theme}.png`) });
      }
    } finally {
      await cleanupWorkspace(seed.userId);
    }
  });

  test('activates node selection from the keyboard', async ({ page }) => {
    const seed = await seedWorkspace(page, 'keyboard');
    try {
      await page.goto(`/transcricoes/${seed.transcriptId}`);
      const graphSection = page.getByTestId('transcript-knowledge-graph');
      const inspector = graphSection.getByRole('region', { name: 'Detalhes do nó' });
      const topicOption = inspector.getByRole('button', { name: new RegExp(seed.topicLabel) });
      await topicOption.focus();
      await page.keyboard.press('Enter');
      await expect(inspector.getByText(`${seed.topicLabel} appears in this source.`)).toBeVisible();
      await expect(inspector.getByRole('button', { name: 'Todos os nós' })).toBeVisible();
    } finally {
      await cleanupWorkspace(seed.userId);
    }
  });

  test('searches the full graph and focuses a server result', async ({ page }, testInfo) => {
    const seed = await seedWorkspace(page, 'search');
    try {
      await page.goto(`/grafo?focus=${seed.focusId}`);
      const search = page.getByRole('combobox', { name: 'Pesquisar em todo o grafo…' });
      await expect(search).toBeVisible();
      await search.fill('Matrix grounded');
      await expect(page.getByRole('option', { name: new RegExp(seed.topicLabel) })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('matrix-graph-search.png') });
      await page.keyboard.press('Enter');
      await expect(search).toHaveValue('');
    } finally {
      await cleanupWorkspace(seed.userId);
    }
  });
});
