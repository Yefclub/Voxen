import { expect, test } from '@playwright/test';
import { cleanupWorkspace, seedWorkspace } from './workspace-seed';

// Network presentation fixtures need direct routing; real-worker offline/update checks run separately.
test.use({ serviceWorkers: 'block' });

test('keeps desktop appearance glyphs inside their clipping ancestors', async ({ page }) => {
  test.skip(process.env.VOXEN_E2E !== '1', 'Requires the isolated browser workspace.');
  const workspace = await seedWorkspace(page, 'finish-chrome');
  try {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/transcricoes');
    await expect(
      page.getByRole('button', { name: 'Mudar para tema claro', exact: true }),
    ).toBeVisible();
    const clipped = await page.locator('[aria-label="Aparência"] button svg').evaluateAll(
      (icons) =>
        icons.filter((icon) => {
          const r = icon.getBoundingClientRect();
          if (!r.width || !r.height) return false;
          for (let parent = icon.parentElement; parent; parent = parent.parentElement) {
            const css = getComputedStyle(parent);
            if (!/(hidden|clip|auto|scroll)/.test(css.overflowX)) continue;
            const box = parent.getBoundingClientRect();
            if (r.left < box.left - 1 || r.right > box.right + 1) return true;
          }
          return false;
        }).length,
    );
    expect(clipped).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: /^Filtros/ }).click();
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: 'Filtros da biblioteca', exact: true }),
    ).toHaveCount(1);
  } finally {
    await cleanupWorkspace(workspace.userId);
  }
});

test('reserves space between installation description and the focused close control', async ({
  page,
}) => {
  test.skip(process.env.VOXEN_E2E !== '1', 'Requires the isolated browser workspace.');
  const workspace = await seedWorkspace(page, 'finish-install');
  try {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/transcricoes');
      await page.evaluate(() =>
        window.dispatchEvent(
          Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
            prompt: async () => {},
            userChoice: Promise.resolve({ outcome: 'dismissed' }),
          }),
        ),
      );
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const close = await dialog.getByRole('button', { name: 'Fechar', exact: true }).boundingBox();
      const textRects = await dialog
        .locator('p')
        .first()
        .evaluate((paragraph) => {
          const range = document.createRange();
          range.selectNodeContents(paragraph);
          return [...range.getClientRects()].map(({ x, y, width, height }) => ({
            x,
            y,
            width,
            height,
          }));
        });
      expect(close).not.toBeNull();
      expect(textRects.length).toBeGreaterThan(0);
      for (const text of textRects)
        expect(
          text.x + text.width <= close!.x - 4 ||
            text.y >= close!.y + close!.height + 4 ||
            text.y + text.height <= close!.y - 4,
        ).toBe(true);
      await page.keyboard.press('Escape');
      await page.evaluate(() => localStorage.removeItem('voxen.pwa-install-dismissed-until'));
    }
  } finally {
    await cleanupWorkspace(workspace.userId);
  }
});

test('renders identifiable 3D markers for a complete mobile overview', async ({ page }) => {
  test.skip(process.env.VOXEN_E2E !== '1', 'Requires the isolated browser workspace.');
  const workspace = await seedWorkspace(page, 'finish-3d');
  try {
    const nodes = Array.from({ length: 16 }, (_, index) => ({
      id: `finish-${index}`,
      key: `topic:finish-${index}`,
      label: `Research ${index}`,
      description: null,
      type: index % 2 ? 'topic' : 'content',
      sourceType: 'MANUAL',
      sourceId: null,
      weight: 1,
      updatedAt: '2026-11-12T00:00:00Z',
    }));
    const edges = Array.from({ length: 8 }, (_, index) => ({
      id: `edge-${index}`,
      from: `finish-${index * 2}`,
      to: `finish-${index * 2 + 1}`,
      kind: 'mentions',
      method: 'test',
      confidence: '1',
    }));
    await page.route('**/api/graph?*', (route) =>
      route.fulfill({ json: { nodes, edges, totalNodes: 16, totalEdges: 8 } }),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/grafo');
    await page.getByRole('button', { name: '3D', exact: true }).click();
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
    await page.waitForTimeout(1200);
    const png = await canvas.screenshot();
    const sizes = await page.evaluate(
      async (bytes) => {
        const image = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
        );
        const target = new OffscreenCanvas(image.width, image.height),
          context = target.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, image.width, image.height);
        const seen = new Uint8Array(image.width * image.height),
          diameters: number[] = [];
        const colored = (i: number): boolean => {
          const r = data[i * 4]!,
            g = data[i * 4 + 1]!,
            b = data[i * 4 + 2]!;
          return (
            Math.max(r, g, b) - Math.min(r, g, b) > 45 &&
            ((b > r + 15 && b > g + 20) || (r > b + 20 && r > g + 20))
          );
        };
        for (let i = 0; i < seen.length; i++) {
          if (seen[i] || !colored(i)) continue;
          const queue = [i];
          seen[i] = 1;
          let area = 0,
            minX = image.width,
            maxX = 0,
            minY = image.height,
            maxY = 0;
          for (let k = 0; k < queue.length; k++) {
            const p = queue[k]!;
            area++;
            const x = p % image.width,
              y = Math.floor(p / image.width);
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
            for (const next of [p - image.width, p + image.width, p - 1, p + 1]) {
              if (next < 0 || next >= seen.length || seen[next] || !colored(next)) continue;
              seen[next] = 1;
              queue.push(next);
            }
          }
          if (area >= 3) diameters.push(Math.max(maxX - minX + 1, maxY - minY + 1));
        }
        return diameters.sort((a, b) => a - b);
      },
      [...png],
    );
    expect(sizes.length).toBeGreaterThanOrEqual(12);
    expect(sizes[Math.floor(sizes.length / 2)]).toBeGreaterThanOrEqual(10);
  } finally {
    await cleanupWorkspace(workspace.userId);
  }
});
