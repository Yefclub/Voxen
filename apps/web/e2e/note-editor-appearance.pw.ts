import { expect, test } from '@playwright/test';
import { cleanupWorkspace, seedWorkspace } from './workspace-seed';

test('keeps a pending note draft readable and mounted across both appearances', async ({
  page,
}) => {
  test.skip(process.env.VOXEN_E2E !== '1', 'Run against an isolated Voxen test database.');
  const workspace = await seedWorkspace(page, 'editor-appearance');
  let releaseSave = (): void => {};
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let saves = 0;
  try {
    const response = await page.request.post('/api/notes', {
      data: { kind: 'NOTE', title: 'Theme-aware note', content: 'Original note body' },
    });
    expect(response.status()).toBe(201);
    const { note } = (await response.json()) as { note: { id: string } };
    const endpoint = `**/api/notes/${note.id}`;
    await page.route(endpoint, async (route) => {
      if (route.request().method() === 'PATCH') {
        saves += 1;
        await saveGate;
      }
      await route.continue();
    });
    await page.goto(`/notas/${note.id}`);
    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    const editor = page.locator('.cm-content[contenteditable=true]');
    await expect(editor).toBeVisible();
    const original = await editor.elementHandle();
    const draft = 'Pending Markdown **draft** survives appearance changes.';
    await editor.fill(draft);
    await expect.poll(() => saves).toBe(1);

    for (const [mode, label] of [
      ['light', 'Mudar para tema claro'],
      ['dark', 'Mudar para tema escuro'],
    ] as const) {
      await page.getByRole('radio', { name: label, exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      await expect(editor).toContainText(draft);
      expect(await editor.evaluate((element, previous) => element === previous, original)).toBe(
        true,
      );
      const contrast = await editor.evaluate((element) => {
        const rgb = (value: string): number[] => (value.match(/[\d.]+/g) ?? []).map(Number);
        const luminance = (values: number[]): number =>
          values
            .slice(0, 3)
            .map((value) => {
              const channel = value / 255;
              return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            })
            .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
        let parent: Element | null = element;
        let background = [255, 255, 255];
        while (parent) {
          const color = rgb(getComputedStyle(parent).backgroundColor);
          if (color.length === 3 || color[3] === 1) {
            background = color;
            break;
          }
          parent = parent.parentElement;
        }
        const foreground = luminance(rgb(getComputedStyle(element).color));
        const surface = luminance(background);
        return (Math.max(foreground, surface) + 0.05) / (Math.min(foreground, surface) + 0.05);
      });
      expect(contrast, `${mode} editor text contrast`).toBeGreaterThanOrEqual(4.5);
      await expect(editor).toHaveAccessibleName('Conteúdo da nota');
    }
    await expect(page.getByRole('textbox', { name: 'Título da nota' })).toHaveValue(
      'Theme-aware note',
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
    await cleanupWorkspace(workspace.userId);
  }
});
