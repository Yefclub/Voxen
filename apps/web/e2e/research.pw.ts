import { expect, test } from '@playwright/test';
import { seedWorkspace, cleanupWorkspace, type WorkspaceSeed } from './workspace-seed';
import { setUserSetting } from '../src/lib/settings';
import { saveResearchPreferences } from '../src/lib/research/preferences';
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
  test('reviews cited context, preserves an obsolete edit draft and keeps the original source intact', async ({
    page,
  }) => {
    const source = await db.transcript.findUniqueOrThrow({
      where: { id: workspace!.transcriptId },
    });
    await setUserSetting(
      workspace!.userId,
      'library_research_preferences',
      JSON.stringify({ mode: 'MANUAL', automaticSince: null }),
    );
    const row = await db.transcriptEnrichment.create({
      data: {
        userId: workspace!.userId,
        transcriptId: source.id,
        runKey: 'reader-fixture',
        trigger: 'MANUAL',
        status: 'READY',
        title: 'Contexto de demonstração',
        content: 'Evidência externa verificável, separada da fonte original.',
        sourceVersion: source.sourceVersion,
        sourceChecksum: source.sourceChecksum,
        costUsd: 0.00123,
        tokensIn: 1200,
        tokensOut: 300,
        searchCallCount: 1,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
        citations: [
          {
            title: 'Fonte de demonstração',
            url: 'https://example.org/evidence',
            excerpt: 'Trecho verificado para demonstração da interface.',
            retrievedAt: new Date().toISOString(),
          },
        ],
      },
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/transcricoes/${source.id}#additional-context-${row.id}`);
    const section = page.getByRole('region', { name: 'Contexto adicional', exact: true });
    await expect(section).toBeVisible();
    const context = section.locator(`#additional-context-${row.id}`);
    await expect(context.getByText('Aguardando revisão', { exact: true })).toBeVisible();
    await expect(
      context.getByRole('link', { name: 'Fonte de demonstração', exact: false }),
    ).not.toBeVisible();
    await context.getByText('Fontes e execução', { exact: false }).click();
    await expect(
      context.getByRole('link', { name: 'Fonte de demonstração', exact: false }),
    ).toHaveAttribute('href', 'https://example.org/evidence');
    await expect(context.getByText('$0,0012', { exact: false })).toBeVisible();
    await context.getByRole('button', { name: 'Aceitar contexto', exact: true }).click();
    await expect(context.getByText('Aceito na biblioteca', { exact: true })).toBeVisible();
    await context.getByRole('button', { name: 'Editar', exact: true }).click();

    const editor = page.getByRole('dialog', { name: 'Editar contexto adicional', exact: true });
    const content = editor.getByLabel('Texto do contexto', { exact: true });
    await content.fill('Rascunho preservado durante uma atualização concorrente.');
    await db.transcriptEnrichment.update({
      where: { id: row.id },
      data: { revision: { increment: 1 }, content: 'Versão concorrente da pesquisa.' },
    });
    await editor.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(
      editor.getByRole('status', { name: 'Estado da edição', exact: true }),
    ).toContainText('Este contexto mudou');
    await expect(content).toHaveValue('Rascunho preservado durante uma atualização concorrente.');
    await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(editor).not.toBeVisible();
    await context.getByRole('button', { name: 'Editar', exact: true }).click();
    await expect(content).toHaveValue('Versão concorrente da pesquisa.');
    await content.fill('Contexto curado pelo usuário com evidência preservada.');
    await editor.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(editor).not.toBeVisible();
    await expect(context.getByText('Editado por você', { exact: true })).toBeVisible();
    await expect(context.getByText('Aguardando revisão', { exact: true })).toBeVisible();
    await context.getByRole('button', { name: 'Dispensar', exact: true }).click();
    await expect(context.getByText('Dispensado', { exact: true })).toBeVisible();
    await context.getByRole('button', { name: 'Apagar', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Excluir este contexto adicional?' });
    await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(context).toBeVisible();
    const original = await db.transcript.findUniqueOrThrow({ where: { id: source.id } });
    expect(original.plainText).toBe(source.plainText);
    expect(original.summaryMd).toBe(source.summaryMd);
    expect(original.sourceVersion).toBe(source.sourceVersion);
    expect(await db.transcriptEnrichment.findUnique({ where: { id: row.id } })).toMatchObject({
      reviewState: 'DISMISSED',
      content: 'Contexto curado pelo usuário com evidência preservada.',
    });
  });
  test('queues once, announces completion, cancels active work and confirms independent deletion', async ({
    page,
  }) => {
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
    await saveResearchPreferences(workspace!.userId, 'MANUAL', 'browser-fixture-discovery-key-229');
    await page.goto(`/transcricoes/${workspace!.transcriptId}`);
    const section = page.getByRole('region', { name: 'Contexto adicional', exact: true });
    const status = page.getByRole('status', { name: 'Estado da pesquisa', exact: true });
    const announcement = await status.elementHandle();
    await section.getByRole('button', { name: 'Pesquisar contexto', exact: true }).click();
    await expect(status).toContainText('Pendente');
    expect(await db.transcriptEnrichment.count({ where: { userId: workspace!.userId } })).toBe(1);
    await section.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(status).toContainText('Cancelado');
    expect(await status.evaluate((element, initial) => element === initial, announcement)).toBe(
      true,
    );
    await section.getByRole('button', { name: 'Pesquisar contexto', exact: true }).click();
    await expect(status).toContainText('Pendente');
    const current = await db.transcriptEnrichment.findFirstOrThrow({
      where: { userId: workspace!.userId, status: 'PENDING' },
    });
    await db.transcriptEnrichment.update({
      where: { id: current.id },
      data: {
        status: 'READY',
        title: 'Resultado verificado',
        content: 'Resultado sintético com fonte verificável.',
        citations: [
          {
            url: 'https://example.org/source',
            title: 'Fonte',
            excerpt: 'Trecho verificado para o teste de conclusão.',
          },
        ],
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    await expect(status).toContainText('Aguardando revisão');
    expect(await status.evaluate((element, initial) => element === initial, announcement)).toBe(
      true,
    );
    const result = section.locator(`#additional-context-${current.id}`);
    await result.getByRole('button', { name: 'Apagar', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Excluir este contexto adicional?' });
    await confirm.getByRole('button', { name: 'Apagar', exact: true }).click();
    await expect(confirm).not.toBeVisible();
    await expect(result.getByText('Exclusão agendada', { exact: true })).toBeVisible();
    expect(
      await db.job.count({
        where: {
          userId: workspace!.userId,
          type: 'DELETE_KNOWLEDGE',
          deletionTargetId: current.id,
        },
      }),
    ).toBe(1);
    expect(await db.transcript.count({ where: { id: workspace!.transcriptId } })).toBe(1);
  });

  test('opens an older linked result, paginates history and keeps edit actions above the emulated keyboard', async ({
    page,
  }) => {
    const source = await db.transcript.findUniqueOrThrow({
      where: { id: workspace!.transcriptId },
    });
    await saveResearchPreferences(workspace!.userId, 'MANUAL');
    let olderId = '';
    for (let index = 0; index < 11; index++) {
      const row = await db.transcriptEnrichment.create({
        data: {
          userId: workspace!.userId,
          transcriptId: source.id,
          runKey: `history-${index}`,
          trigger: 'MANUAL',
          status: 'READY',
          title: `Pesquisa ${index}`,
          content: 'Contexto sintético para conferir o histórico de pesquisa.',
          sourceVersion: source.sourceVersion,
          sourceChecksum: source.sourceChecksum,
          createdAt: new Date(Date.now() - index * 1000),
          citations: [
            {
              url: 'https://example.org/history',
              title: 'Histórico',
              excerpt: 'Trecho de demonstração para o histórico.',
            },
          ],
        },
      });
      olderId = row.id;
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/transcricoes/${source.id}#additional-context-${olderId}`);
    const older = page.locator(`#additional-context-${olderId}`);
    await expect(older.getByRole('heading', { name: 'Pesquisa 10', exact: true })).toBeVisible();
    const focused = await older.evaluate((element) => document.activeElement === element);
    expect(focused).toBe(true);
    await older.getByRole('button', { name: 'Editar', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Editar contexto adicional', exact: true });
    await expect(editor.getByLabel('Texto do contexto', { exact: true })).toHaveValue(
      'Contexto sintético para conferir o histórico de pesquisa.',
    );
    await page.evaluate(() =>
      document.documentElement.style.setProperty('--visual-viewport-height', '420px'),
    );
    await editor.getByRole('button', { name: 'Salvar', exact: true }).scrollIntoViewIfNeeded();
    const panel = (await editor.boundingBox())!;
    const action = (await editor
      .getByRole('button', { name: 'Salvar', exact: true })
      .boundingBox())!;
    expect(action.y).toBeGreaterThanOrEqual(panel.y);
    expect(action.y + action.height).toBeLessThanOrEqual(panel.y + panel.height);
    await page.screenshot({ path: '/tmp/voxen-research-editor-keyboard-390.png' });
    await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.evaluate(() =>
      document.documentElement.style.removeProperty('--visual-viewport-height'),
    );
    const history = page.getByRole('navigation', { name: 'Histórico da pesquisa', exact: true });
    await history.getByRole('button', { name: 'Mais antigas', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Pesquisa 0', exact: true })).toHaveCount(0);
    await expect(older.getByRole('heading', { name: 'Pesquisa 10', exact: true })).toBeVisible();
    await history.getByRole('button', { name: 'Mais recentes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Pesquisa 0', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Configurar pesquisa', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Pesquisa da biblioteca', exact: true }),
    ).toBeVisible();
  });
});
