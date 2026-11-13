import { expect, test } from '@playwright/test';
import { seedWorkspace, cleanupWorkspace, type WorkspaceSeed } from './workspace-seed';
import { setUserSetting } from '../src/lib/settings';
import { db } from '../src/lib/db';

test.describe('opted-in library research', () => {
  let workspace: WorkspaceSeed | undefined;
  let pageErrors: string[];
  test.beforeEach(async ({ page }) => {
    expect(new URL(process.env.DATABASE_URL ?? '').pathname).toMatch(/test|e2e/i);
    pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    workspace = await seedWorkspace(page, 'research');
  });
  test.afterEach(async () => {
    if (workspace) await cleanupWorkspace(workspace.userId);
    expect(pageErrors).toEqual([]);
  });
  test('keeps consent explicit, preserves a rejected draft and safely removes the shared discovery key', async ({
    page,
  }) => {
    await page.goto('/conta/ia#library-research');
    const settings = page.getByRole('region', { name: 'Pesquisa da biblioteca', exact: true });
    await expect(settings).toBeVisible();
    const mode = settings.getByRole('combobox', { name: 'Quando pesquisar' });
    const key = settings.getByLabel('Chave da Brave Search API');
    const save = settings.getByRole('button', { name: 'Salvar pesquisa', exact: true });
    const status = settings.getByRole('status', { name: 'Estado da pesquisa' });
    await expect(mode).toHaveValue('OFF');
    await expect(save).toBeDisabled();
    const legacy = await db.transcriptEnrichment.create({
      data: {
        userId: workspace!.userId,
        transcriptId: workspace!.transcriptId,
        runKey: 'legacy-fixture',
        trigger: 'MANUAL',
        status: 'PENDING',
      },
    });
    await mode.selectOption('MANUAL');
    await key.fill('browser-fixture-discovery-key-229');
    await save.click();
    await expect(status).toHaveText(
      'Configure um modelo para o papel Padrão antes de ativar a pesquisa.',
    );
    await expect(key).toHaveValue('browser-fixture-discovery-key-229');
    await expect(mode).toHaveValue('MANUAL');
    await setUserSetting(
      workspace!.userId,
      'ai_provider_key:anthropic',
      'browser-fixture-provider-key-not-real',
    );
    await setUserSetting(
      workspace!.userId,
      'ai_model_chains',
      JSON.stringify({ standard: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }] }),
    );
    await save.click();
    await expect(status).toHaveText('Preferências de pesquisa salvas.');
    expect(await db.transcriptEnrichment.findUnique({ where: { id: legacy.id } })).toMatchObject({
      status: 'CANCELLED',
    });
    await page.reload();
    await expect(mode).toHaveValue('MANUAL');
    await expect(key).toHaveValue('');
    await expect(settings.getByText('Chave configurada: ••••-229')).toBeVisible();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await settings.scrollIntoViewIfNeeded();
      const box = (await settings.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      await expect(mode).toBeVisible();
      expect((await mode.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: `/tmp/voxen-research-settings-${width}.png` });
      await save.scrollIntoViewIfNeeded();
      const actionBounds = (await save.boundingBox())!;
      const mainBounds = (await page.locator('main').boundingBox())!;
      expect(actionBounds.y + actionBounds.height).toBeLessThanOrEqual(
        mainBounds.y + mainBounds.height + 1,
      );
      await page.screenshot({ path: `/tmp/voxen-research-settings-footer-${width}.png` });
    }
    await mode.selectOption('AUTO');
    await expect(
      settings.getByText(
        'Pesquisa capturas coletadas a partir da ativação. A biblioteca antiga fica de fora.',
      ),
    ).toBeVisible();
    await save.click();
    await expect(status).toHaveText('Preferências de pesquisa salvas.');
    await settings
      .getByRole('checkbox', { name: 'Remover a chave compartilhada e desativar a pesquisa' })
      .check();
    await expect(mode).toHaveValue('OFF');
    await save.click();
    await expect(status).toHaveText('Preferências de pesquisa salvas.');
    await expect(settings.getByText('Chave configurada:', { exact: false })).toHaveCount(0);
    await expect(save).toBeDisabled();
  });
});
