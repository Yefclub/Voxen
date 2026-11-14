import { expect, test } from '@playwright/test';
import { seedWorkspace, cleanupWorkspace, type WorkspaceSeed } from './workspace-seed';
import { setSetting, setUserSetting } from '../src/lib/settings';
import { saveOrganizationPreferences } from '../src/lib/organization/preferences';
import { db } from '../src/lib/db';
import { storagePut, storageReadText } from '../src/lib/storage';
import { createSourceEvidenceManifest } from '../src/lib/source-provenance';
import { executeOrganization } from '../src/lib/organization/runner';

test.describe('source-grounded library organization', () => {
  let workspace: WorkspaceSeed;
  let pageErrors: string[];
  test.beforeEach(async ({ page }) => {
    expect(new URL(process.env.DATABASE_URL ?? '').pathname).toMatch(/test|e2e/i);
    pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    workspace = await seedWorkspace(page, 'organization');
    const source = await db.transcript.findFirstOrThrow({
      where: { id: workspace.transcriptId, userId: workspace.userId },
    });
    const markdown = await storageReadText(source.mdPath);
    await storagePut({ key: source.mdPath, body: markdown, contentType: 'text/markdown' });
    await db.transcript.update({
      where: { id: source.id },
      data: {
        sourceMetadata: {
          producer: 'voxen-capture',
          evidenceManifest: createSourceEvidenceManifest(markdown, [
            { start: 0, end: markdown.length },
          ]),
        },
      },
    });
  });
  test.afterEach(async () => {
    await setSetting('app_language', 'pt-BR');
    if (workspace) await cleanupWorkspace(workspace.userId);
    expect(pageErrors).toEqual([]);
  });
  async function configure() {
    await setUserSetting(
      workspace.userId,
      'ai_provider_key:anthropic',
      'browser-fixture-provider-key-not-real',
    );
    await setUserSetting(
      workspace.userId,
      'ai_model_chains',
      JSON.stringify({ standard: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }] }),
    );
  }
  test('keeps consent explicit, preserves a rejected preference and allows credential-free opt-out', async ({
    page,
  }) => {
    await page.goto('/conta/ia#library-organization');
    const section = page.getByRole('region', { name: 'Organização da biblioteca', exact: true });
    await expect(section).toBeVisible();
    const mode = section.getByRole('combobox', { name: 'Quando organizar' });
    const save = section.getByRole('button', { name: 'Salvar organização', exact: true });
    const status = section.getByRole('status', { name: 'Estado das preferências de organização' });
    await expect(mode).toHaveValue('OFF');
    await expect(save).toBeDisabled();
    await mode.selectOption('MANUAL');
    await save.click();
    await expect(status).toHaveText(
      'Configure um modelo no papel Padrão antes de ativar a organização.',
    );
    await expect(mode).toHaveValue('MANUAL');
    await configure();
    await save.click();
    await expect(status).toHaveText('Preferências de organização salvas.');
    await saveOrganizationPreferences(workspace.userId, 'OFF');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(mode).toHaveValue('OFF');
    await mode.selectOption('MANUAL');
    await save.click();
    await expect(status).toHaveText('Preferências de organização salvas.');
    await page.reload();
    await expect(mode).toHaveValue('MANUAL');
    await mode.selectOption('AUTO');
    await expect(
      section.getByText(
        'Organiza capturas coletadas a partir da ativação. Não analisa automaticamente a biblioteca anterior.',
      ),
    ).toBeVisible();
    await save.click();
    await expect(status).toHaveText('Preferências de organização salvas.');
    await setUserSetting(workspace.userId, 'ai_provider_key:anthropic', '');
    await mode.selectOption('OFF');
    await save.click();
    await expect(status).toHaveText('Preferências de organização salvas.');
    await expect(save).toBeDisabled();
    expect(await db.organizationRun.count({ where: { userId: workspace.userId } })).toBe(0);
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await section.scrollIntoViewIfNeeded();
      const bounds = (await section.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
      expect((await mode.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await save.scrollIntoViewIfNeeded();
      expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(40);
      await page.screenshot({ path: `/tmp/voxen-organization-settings-${width}.png` });
    }
  });
  test('queues and cancels without archive misinformation while preserving the original and status node', async ({
    page,
  }) => {
    await configure();
    await saveOrganizationPreferences(workspace.userId, 'MANUAL');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/transcricoes/${workspace.transcriptId}#document-connections`);
    const section = page.getByRole('region', { name: 'Conexões com IA', exact: true });
    const status = section.getByRole('status', { name: 'Estado da organização' });
    await expect(section).toBeVisible();
    const originalStatus = await status.elementHandle();
    const before = await db.transcript.findFirstOrThrow({
      where: { id: workspace.transcriptId, userId: workspace.userId },
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/api/organization/documents/${workspace.transcriptId}`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      await held;
      await route.fulfill({ response });
    });
    const submit = section.getByRole('button', { name: 'Organizar conteúdo', exact: true });
    try {
      await submit.click();
      await expect(
        section.getByRole('button', { name: 'Solicitando análise…', exact: true }),
      ).toBeDisabled();
      await expect(
        section.getByText('Restaure o conteúdo arquivado para solicitar uma nova análise.'),
      ).toHaveCount(0);
    } finally {
      release();
    }
    await expect(status).toContainText('Na fila');
    expect(await originalStatus!.evaluate((node) => node.isConnected)).toBe(true);
    await section.getByRole('button', { name: 'Interromper análise', exact: true }).click();
    await expect(status).toContainText('Interrompida');
    await section.getByText('Histórico de organização', { exact: true }).click();
    await expect(section.getByRole('link', { name: 'Abrir esta execução' })).toHaveCount(1);
    expect(
      await db.transcript.findFirstOrThrow({
        where: { id: workspace.transcriptId, userId: workspace.userId },
      }),
    ).toEqual(before);
    expect(
      await db.organizationRun.findFirstOrThrow({
        where: { userId: workspace.userId, transcriptId: workspace.transcriptId },
      }),
    ).toMatchObject({ status: 'CANCELLED' });
    await page.screenshot({ path: '/tmp/voxen-organization-cancelled-390.png' });
  });
  test('reads older run links, unknown usage and failures without changing the document', async ({
    page,
  }) => {
    await saveOrganizationPreferences(workspace.userId, 'MANUAL');
    const oldestId = crypto.randomUUID();
    const startedAt = new Date(Date.now() - 60_000);
    await db.organizationRun.create({
      data: {
        id: oldestId,
        userId: workspace.userId,
        transcriptId: workspace.transcriptId,
        runKey: crypto.randomUUID(),
        trigger: 'MANUAL',
        status: 'FAILED',
        totalSections: 2,
        completedSections: 1,
        startedAt,
        createdAt: startedAt,
        finishedAt: new Date(),
        warnings: ['UNCONFIRMED_USAGE'],
        lastError: 'TIMEOUT',
        costUsd: null,
        model: 'fixture:standard',
        tokensIn: 1200,
        tokensOut: 300,
      },
    });
    await db.organizationRun.createMany({
      data: Array.from({ length: 22 }, (_, i) => ({
        userId: workspace.userId,
        transcriptId: workspace.transcriptId,
        runKey: crypto.randomUUID(),
        trigger: 'MANUAL' as const,
        status: 'COMPLETED' as const,
        totalSections: 1,
        completedSections: 1,
        createdAt: new Date(Date.now() + i),
        startedAt,
        finishedAt: new Date(),
        costUsd: 0.00042,
        tokensIn: 100,
        tokensOut: 40,
        model: 'fixture:standard',
      })),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/transcricoes/${workspace.transcriptId}#organization-${oldestId}`);
    const section = page.getByRole('region', { name: 'Conexões com IA', exact: true });
    const row = section.locator(`#organization-${oldestId}`);
    await expect(row).toBeVisible();
    await expect(row.getByText('Custo não confirmado', { exact: true })).toBeVisible();
    await expect(
      row.getByText(
        'O uso de uma chamada interrompida não foi confirmado. O custo total é desconhecido.',
      ),
    ).toBeVisible();
    await expect(
      row.getByText(
        'A análise atingiu o limite de tempo. Confira o histórico antes de solicitar outra.',
      ),
    ).toBeVisible();
    await expect(section.getByRole('status', { name: 'Estado da organização' })).toContainText(
      'Análise concluída',
    );
    const first = await section
      .locator('article')
      .evaluateAll((nodes) => nodes.map((node) => node.id));
    await section.getByRole('button', { name: 'Mais antigas', exact: true }).click();
    await expect
      .poll(() => section.locator('article').evaluateAll((nodes) => nodes.map((node) => node.id)))
      .not.toEqual(first);
    await expect(row).toBeVisible();
    await section.getByRole('button', { name: 'Mais recentes', exact: true }).click();
    await expect
      .poll(() => section.locator('article').evaluateAll((nodes) => nodes.map((node) => node.id)))
      .toEqual(first);
    await page.route(`**/api/organization/documents/${workspace.transcriptId}?cursor=*`, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'ORGANIZATION_UNAVAILABLE' }),
      }),
    );
    await section.getByRole('button', { name: 'Mais antigas', exact: true }).click();
    const failure = section.getByText(
      'Não foi possível atualizar a organização. Tente novamente; o original continua disponível.',
      { exact: true },
    );
    await expect(failure).toBeVisible();
    await section.getByRole('button', { name: 'Mais recentes', exact: true }).click();
    await expect(failure).toHaveCount(0);
    await page.screenshot({ path: '/tmp/voxen-organization-history-390.png' });
  });
  test('announces actual executor progress, confirmed usage and omitted unsupported output', async ({
    page,
  }) => {
    await configure();
    await saveOrganizationPreferences(workspace.userId, 'MANUAL');
    await page.goto(`/transcricoes/${workspace.transcriptId}#document-connections`);
    const section = page.getByRole('region', { name: 'Conexões com IA', exact: true });
    const status = section.getByRole('status', { name: 'Estado da organização' });
    await section.getByRole('button', { name: 'Organizar conteúdo', exact: true }).click();
    await expect(status).toContainText('Na fila');
    const node = await status.elementHandle();
    const run = await db.organizationRun.findFirstOrThrow({
      where: { userId: workspace.userId, transcriptId: workspace.transcriptId },
    });
    let release!: () => void, dispatched!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const called = new Promise<void>((resolve) => {
      dispatched = resolve;
    });
    const quote = `${workspace.topicLabel} appears in this source.`;
    const execution = executeOrganization(workspace.userId, run.id, {
      prepare: async () => ({
        execution: {
          language: 'en',
          reasoning: 'off',
          chain: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }],
        },
        generate: async (input) => {
          dispatched();
          await wait;
          return {
            output: input.schema.parse({
              reason: 'Grounded demonstration.',
              nodes: [
                { id: 'topic', name: workspace.topicLabel, kind: 'TOPIC', quote },
                {
                  id: 'unsupported',
                  name: 'Invented',
                  kind: 'TOPIC',
                  quote: 'Invented material absent from the source.',
                },
              ],
              relationships: [],
            }),
            costUsd: 0.00042,
            modelRef: 'fixture:standard',
            usage: { inputTokens: 123, outputTokens: 45 },
          };
        },
      }),
    });
    try {
      await called;
      await expect(status).toContainText('Analisando conteúdo');
      expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
    } finally {
      release();
      await execution;
    }
    await expect(status).toContainText('Análise concluída');
    await expect(status).toContainText('Com avisos');
    expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
    await section.getByText('Histórico de organização', { exact: true }).click();
    const row = section.locator(`#organization-${run.id}`);
    await expect(row.getByText('fixture:standard', { exact: true })).toBeVisible();
    await expect(row.getByText('0,00042', { exact: false })).toBeVisible();
    await expect(row.getByText('Itens sem evidência verificável foram omitidos.')).toBeVisible();
    expect(
      await db.brainSource.count({
        where: {
          userId: workspace.userId,
          sourceId: workspace.transcriptId,
          authority: 'CAPTURED_SOURCE',
          invalidatedAt: null,
        },
      }),
    ).toBe(1);
    await page.screenshot({ path: '/tmp/voxen-organization-completed-1280.png' });
  });
  test('recovers an active-source read failure without displaying archive guidance', async ({
    page,
  }) => {
    await configure();
    await saveOrganizationPreferences(workspace.userId, 'MANUAL');
    const routePath = `**/api/organization/documents/${workspace.transcriptId}`;
    let fail = true;
    await page.route(routePath, async (route) => {
      if (fail && route.request().method() === 'GET')
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'ORGANIZATION_UNAVAILABLE' }),
        });
      return route.continue();
    });
    await page.goto(`/transcricoes/${workspace.transcriptId}#document-connections`);
    const section = page.getByRole('region', { name: 'Conexões com IA', exact: true });
    await expect(
      section.getByRole('button', { name: 'Tentar novamente', exact: true }),
    ).toBeVisible();
    await expect(
      section.getByText('Restaure o conteúdo arquivado para solicitar uma nova análise.'),
    ).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Matrix source', exact: true })).toHaveCount(1);
    fail = false;
    await section.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
    await expect(
      section.getByRole('button', { name: 'Organizar conteúdo', exact: true }),
    ).toBeEnabled();
    await db.transcript.update({
      where: { id: workspace.transcriptId },
      data: { status: 'ARCHIVED' },
    });
    await page.reload();
    await expect(
      section.getByText('Restaure o conteúdo arquivado para solicitar uma nova análise.'),
    ).toBeVisible();
    await expect(
      section.getByRole('button', { name: 'Organizar conteúdo', exact: true }),
    ).toBeDisabled();
  });
  test('keeps English Light controls and long execution metadata readable across widths', async ({
    page,
  }) => {
    await saveOrganizationPreferences(workspace.userId, 'MANUAL');
    await db.user.update({ where: { id: workspace.userId }, data: { theme: 'light' } });
    await setSetting('app_language', 'en');
    await page.addInitScript(() => {
      localStorage.setItem('voxen:locale', 'en');
      localStorage.setItem('voxen:theme', 'light');
    });
    await db.organizationRun.create({
      data: {
        userId: workspace.userId,
        transcriptId: workspace.transcriptId,
        runKey: crypto.randomUUID(),
        trigger: 'MANUAL',
        status: 'COMPLETED',
        totalSections: 1,
        completedSections: 1,
        startedAt: new Date(),
        finishedAt: new Date(),
        costUsd: 0.00042,
        model: `fixture:${'long-model-identifier-'.repeat(5)}`,
        tokensIn: 1200,
        tokensOut: 300,
      },
    });
    await page.goto(`/transcricoes/${workspace.transcriptId}#document-connections`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const section = page.getByRole('region', { name: 'AI connections', exact: true });
    await section.getByText('Organization history', { exact: true }).click();
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await section.scrollIntoViewIfNeeded();
      const bounds = (await section.boundingBox())!;
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
      const overflow = await section.evaluate((node) => ({
        scroll: node.scrollWidth,
        client: node.clientWidth,
        outside: Array.from(node.querySelectorAll('*')).flatMap((child) => {
          const box = child.getBoundingClientRect(),
            parent = node.getBoundingClientRect();
          return box.right > parent.right + 0.1
            ? [
                {
                  tag: child.tagName,
                  className: child.getAttribute('class'),
                  right: box.right,
                  boundary: parent.right,
                },
              ]
            : [];
        }),
      }));
      expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.client);
      if (width < 640) {
        const description = await section
          .getByText(
            'Connect concepts using passages from this document. The original and your manual choices are preserved.',
          )
          .boundingBox();
        expect(description!.width).toBeGreaterThanOrEqual(bounds.width * 0.9);
      }
      expect(
        (await section
          .getByRole('button', { name: 'Organize content', exact: true })
          .boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: `/tmp/voxen-organization-reader-en-light-${width}.png` });
    }
    await section.getByRole('link', { name: 'Configure organization', exact: true }).click();
    const settings = page.getByRole('region', { name: 'Library organization', exact: true });
    await expect(settings.getByRole('combobox', { name: 'When to organize' })).toHaveValue(
      'MANUAL',
    );
    await expect(
      settings.getByText(
        'Sends eligible passages to your Standard model and may incur provider costs. Folders, tags and the original document are preserved.',
      ),
    ).toBeVisible();
    await page.screenshot({ path: '/tmp/voxen-organization-settings-en-light-320.png' });
  });
});
