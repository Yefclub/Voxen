import { expect, test } from '@playwright/test';
import { cleanupWorkspace, seedWorkspace } from './workspace-seed';

test.describe('workspace motion and fallback rendering (spec 219)', () => {
  test.skip(process.env.VOXEN_E2E !== '1', 'Run against an isolated Voxen test database.');

  test('renders with reduced motion active', async ({ page }, testInfo) => {
    const seed = await seedWorkspace(page, 'motion');
    try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`/transcricoes/${seed.transcriptId}`);
      expect(
        await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
      ).toBe(true);
      const graphSection = page.getByTestId('transcript-knowledge-graph');
      await expect(graphSection.getByText('Grafo deste conteúdo')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('matrix-reduced-motion.png') });
    } finally {
      await cleanupWorkspace(seed.userId);
    }
  });

  test('keeps an interactive SVG map when WebGL is unavailable', async ({ page }, testInfo) => {
    const seed = await seedWorkspace(page, 'fallback');
    try {
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function getContext(
          this: HTMLCanvasElement,
          contextId: string,
          ...args: Array<unknown>
        ) {
          if (typeof contextId === 'string' && contextId.includes('webgl')) return null;
          return original.apply(this, [contextId, ...(args as [])]);
        };
      });
      await page.goto(`/transcricoes/${seed.transcriptId}`);
      const graphSection = page.getByTestId('transcript-knowledge-graph');
      await expect(graphSection.getByText('Grafo deste conteúdo')).toBeVisible();
      const svgMap = graphSection.getByRole('group', { name: 'Brain' });
      await expect(svgMap).toBeVisible();
      const topicNode = svgMap.getByRole('button', { name: new RegExp(seed.topicLabel) });
      await expect(topicNode.first()).toBeVisible();
      await topicNode.first().focus();
      await page.keyboard.press('Enter');
      const inspector = graphSection.getByRole('region', { name: 'Detalhes do nó' });
      await expect(inspector.getByText(`${seed.topicLabel} appears in this source.`)).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('matrix-webgl-fallback.png') });
    } finally {
      await cleanupWorkspace(seed.userId);
    }
  });
});
