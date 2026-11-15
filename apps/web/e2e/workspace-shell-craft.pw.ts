import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { cleanupWorkspace, seedWorkspace, type WorkspaceSeed } from './workspace-seed';
import { db } from '../src/lib/db';

test.describe('flat desktop workspace (spec 231)', () => {
  let workspace: WorkspaceSeed;
  test.beforeEach(async ({ page }) => {
    expect(new URL(process.env.DATABASE_URL ?? '').pathname).toMatch(/test|e2e/i);
    workspace = await seedWorkspace(page, 'flat-workspace');
    if (process.env.CHAT_CRAFT_EVIDENCE) await page.emulateMedia({ reducedMotion: 'reduce' });
    await db.user.update({ where: { id: workspace.userId }, data: { role: 'ADMIN' } });
  });
  test.afterEach(async () => {
    if (workspace) await cleanupWorkspace(workspace.userId);
  });
  async function capture(page: Parameters<typeof seedWorkspace>[0], name: string) {
    const dir = process.env.CHAT_CRAFT_EVIDENCE;
    if (!dir) return;
    await mkdir(dir, { recursive: true });
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
  }
  test('gives every desktop destination a flat workspace and retains compact navigation and footer controls', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const theme of ['light', 'dark']) {
      expect(
        (
          await page.request.patch('/api/account', {
            data: { theme: theme === 'dark' ? 'linear' : 'light' },
          })
        ).ok(),
      ).toBe(true);
      await page.setViewportSize({ width: 1280, height: 720 });
      const routes = [
        ['library', '/transcricoes'],
        ['capture', '/capturar'],
        ['notes', '/notas'],
        ['reader', `/transcricoes/${workspace.transcriptId}`],
        ['guide', '/guia'],
        ['graph', '/grafo'],
        ['account', '/conta'],
        ['providers', '/conta/ia'],
        ['mcp', '/conta/mcp'],
        ['admin', '/admin'],
        ['updates', '/novidades'],
      ];
      for (const [name, route] of routes) {
        await page.goto(route!);
        await expect(page.locator('[data-route-loading]')).toHaveCount(0);
        await expect(page.locator('main h1').first()).toBeVisible();
        await expect(page.locator('[data-app-header]')).toHaveCount(0);
        const frame = (await page.locator('[data-app-surface]').boundingBox())!;
        expect(frame.y).toBe(0);
        expect(frame.height).toBe(720);
        expect(frame.x + frame.width).toBe(1280);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await capture(page, `shell-${name}-${theme}-1280`);
        if (name === 'graph') {
          await page.getByRole('button', { name: '3D', exact: true }).click();
          await expect(page.locator('canvas').first()).toBeVisible();
          // A mounted WebGL canvas can precede its first actual graph paint.
          await expect
            .poll(
              async () => {
                const png = await page.locator('canvas').first().screenshot();
                return page.evaluate(
                  async (bytes) => {
                    const bitmap = await createImageBitmap(
                      new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
                    );
                    const surface = document.createElement('canvas');
                    surface.width = bitmap.width;
                    surface.height = bitmap.height;
                    const context = surface.getContext('2d')!;
                    context.drawImage(bitmap, 0, 0);
                    const { data } = context.getImageData(0, 0, surface.width, surface.height);
                    bitmap.close();
                    let painted = 0;
                    for (let i = 0; i < data.length; i += 4)
                      if (
                        Math.max(data[i]!, data[i + 1]!, data[i + 2]!) -
                          Math.min(data[i]!, data[i + 1]!, data[i + 2]!) >
                        40
                      )
                        painted++;
                    // Three small nodes must be painted and initially framed,
                    // rather than captured during the oversized first camera frame.
                    return painted > 20 && painted < surface.width * surface.height * 0.05;
                  },
                  [...png],
                );
              },
              { timeout: 20_000 },
            )
            .toBe(true);
          await capture(page, `shell-graph-3d-${theme}-1280`);
        }
      }
      await page.goto('/chat');
      const input = page.getByRole('textbox', { name: 'Mensagem' });
      await input.fill('Meu rascunho continua ao recolher a navegação.');
      const identity = await input.elementHandle();
      await page.locator('#desktop-sidebar-close').click();
      const sidebar = page.locator('#desktop-sidebar');
      await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
      await expect(sidebar.getByRole('link', { name: 'Biblioteca', exact: true })).toBeVisible();
      await expect(sidebar.getByRole('link', { name: 'Notas', exact: true })).toBeVisible();
      await expect(sidebar.getByRole('link', { name: 'Conversar', exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(await identity!.evaluate((e) => e.isConnected)).toBe(true);
      await expect(input).toHaveText('Meu rascunho continua ao recolher a navegação.');
      await capture(page, `shell-collapsed-${theme}-1280`);
      await sidebar.getByRole('button', { name: 'Aparência', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Aparência', exact: true })).toBeVisible();
      await capture(page, `shell-appearance-${theme}-1280`);
      await page.keyboard.press('Escape');
      const account = sidebar.getByRole('button', { name: /^Menu do usuário:/ });
      await account.click();
      await expect(page.getByRole('menu')).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Perfil', exact: true })).toBeVisible();
      await capture(page, `shell-account-${theme}-1280`);
      await page.keyboard.press('Escape');
      await page.locator('[data-sidebar-toggle]').click();
      await expect(page.locator('#desktop-sidebar-close')).toBeFocused();
      await input.fill('');
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('[data-app-header]')).toBeVisible();
      await expect(sidebar).toHaveCount(0);
      await capture(page, `shell-phone-${theme}-390`);
    }
    expect(errors).toEqual([]);
  });
});
