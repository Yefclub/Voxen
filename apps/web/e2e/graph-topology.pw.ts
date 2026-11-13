import { expect, test } from '@playwright/test';
import { cleanupWorkspace, seedWorkspace } from './workspace-seed';

test.use({
  serviceWorkers: 'block',
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test('keeps 3D usable when search replaces a dense graph and opens a related source', async ({
  page,
}) => {
  test.skip(process.env.VOXEN_E2E !== '1', 'Requires the isolated browser workspace.');
  const workspace = await seedWorkspace(page, 'graph-topology');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const nodes = Array.from({ length: 500 }, (_, index) => ({
      id: `dense-${index}`,
      key: `topic:dense-${index}`,
      label: index === 0 ? 'Related source' : index === 50 ? 'Shared concept' : `Concept ${index}`,
      description: null,
      type: index === 0 ? 'transcript' : 'entity',
      sourceType: index === 0 ? 'TRANSCRIPT' : 'MANUAL',
      sourceId: index === 0 ? workspace.transcriptId : null,
      weight: index === 0 ? 10 : 1,
      updatedAt: '2026-11-12T00:00:00Z',
    }));
    const edges = Array.from({ length: 1500 }, (_, index) => {
      const source = Math.floor(index / 3),
        target = (source + ((index % 3) + 1) * 50) % 500;
      return {
        id: `dense-edge-${index}`,
        from: `dense-${source}`,
        to: `dense-${target}`,
        kind: 'mentions',
        method: 'test',
        confidence: '1',
      };
    });
    const focusedNodes = nodes.filter((node, index) => index === 0 || (index >= 50 && index < 150));
    const focusedIds = new Set(focusedNodes.map((node) => node.id));
    const focusedEdges = edges.filter(
      (edge) => focusedIds.has(edge.from) && focusedIds.has(edge.to),
    );
    await page.route('**/api/graph?*', async (route) => {
      const focused = new URL(route.request().url()).searchParams.has('focus');
      await route.fulfill({
        json: {
          nodes: focused
            ? focusedNodes.map((node) =>
                node.id === 'dense-0' ? { ...node, label: 'Focused source' } : node,
              )
            : nodes,
          edges: focused ? focusedEdges : edges,
          totalNodes: 500,
          totalEdges: 1500,
        },
      });
    });
    await page.route('**/api/graph/search?*', (route) =>
      route.fulfill({
        json: {
          query: new URL(route.request().url()).searchParams.get('q'),
          results: [nodes[0]],
        },
      }),
    );
    await page.goto('/grafo');
    await expect(page.getByText('500 nós · 1500 relações', { exact: true })).toHaveCount(1);
    const mode = page.getByRole('button', { name: '3D', exact: true });
    await mode.click();
    await expect(page.locator('canvas').first()).toBeVisible();
    const paintedPixels = async (): Promise<number> => {
      let png: Buffer;
      try {
        png = await page.locator('canvas').first().screenshot();
      } catch (error) {
        if (error instanceof Error && error.message.includes('Element is not attached')) return 0;
        throw error;
      }
      return page.evaluate(
        async (bytes) => {
          const image = await createImageBitmap(
            new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
          );
          const surface = new OffscreenCanvas(image.width, image.height);
          const context = surface.getContext('2d')!;
          context.drawImage(image, 0, 0);
          const { data } = context.getImageData(0, 0, image.width, image.height);
          let colored = 0;
          for (let i = 0; i < data.length; i += 4)
            if (
              Math.max(data[i]!, data[i + 1]!, data[i + 2]!) -
                Math.min(data[i]!, data[i + 1]!, data[i + 2]!) >
              40
            )
              colored++;
          return colored;
        },
        [...png],
      );
    };
    // Camera readiness alone can precede the first actual WebGL paint.
    await expect.poll(paintedPixels, { timeout: 20000 }).toBeGreaterThan(200);
    expect(errors).toEqual([]);
    await expect(mode).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Aparência', exact: true }).click();
    await page.getByText('Mudar para tema claro', { exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.keyboard.press('Escape');
    await expect.poll(paintedPixels, { timeout: 20000 }).toBeGreaterThan(200);
    await expect(mode).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
    await page.getByRole('combobox', { name: 'Pesquisar em todo o grafo…' }).fill('Related source');
    await page.getByRole('option').filter({ hasText: 'Related source' }).click();
    const details = page.locator('aside[aria-label="Detalhes do nó"]:visible');
    await expect(
      details.getByRole('heading', { name: 'Focused source', exact: true }),
    ).toBeVisible();
    await expect.poll(paintedPixels, { timeout: 20000 }).toBeGreaterThan(200);
    await page.screenshot({ path: test.info().outputPath('focused-3d.png') });
    await expect(mode).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
    await details.getByRole('button', { name: /^Shared concept Relação:/ }).click();
    await expect(
      details.getByRole('heading', { name: 'Shared concept', exact: true }),
    ).toBeVisible();
    await details
      .getByRole('button', { name: 'Abrir conteúdo: Focused source', exact: true })
      .click();
    await expect(page).toHaveURL(`/transcricoes/${workspace.transcriptId}`);
    await expect(page.getByRole('heading', { name: 'Matrix source', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await cleanupWorkspace(workspace.userId);
    expect(errors).toEqual([]);
  }
});
