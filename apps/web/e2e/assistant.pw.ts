import { expect, test } from '@playwright/test';
import { seedWorkspace, cleanupWorkspace, type WorkspaceSeed } from './workspace-seed';
import { MockLanguageModelV4 } from 'ai/test';
import { db } from '../src/lib/db';
import { deleteSetting, getSetting, setSetting, setUserSetting } from '../src/lib/settings';
import { executeAssistantRun } from '../src/lib/assistant/runner';

test.describe('continuous assistant workspace', () => {
  let workspace: WorkspaceSeed | undefined;
  let pageErrors: string[];
  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    expect(new URL(process.env.DATABASE_URL ?? '').pathname).toMatch(/test|e2e/i);
    workspace = await seedWorkspace(page, 'assistant');
  });
  test.afterEach(async () => {
    if (workspace) await cleanupWorkspace(workspace.userId);
    expect(pageErrors).toEqual([]);
  });
  test('keeps the composer and settings usable on desktop and phone', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/chat');
    await expect(page.locator('main h1').first()).toBeVisible();
    const pageHeading = page.getByRole('heading', { name: 'Conversar', exact: true });
    await expect(pageHeading).toHaveCount(1);
    expect((await pageHeading.boundingBox())!.width).toBeLessThanOrEqual(1);
    await expect(page.getByRole('textbox', { name: 'Mensagem' })).toBeVisible();
    const composer = page.locator('.assistant-composer');
    const settings = page.getByRole('button', { name: 'Preferências da conversa' });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const bounds = (await composer.boundingBox())!;
      expect(bounds.height).toBeLessThanOrEqual(72);
      const workspace = (await page.locator('[data-assistant-workspace]').boundingBox())!;
      const corner = (await settings.boundingBox())!;
      expect(workspace.x + workspace.width - corner.x - corner.width).toBeLessThanOrEqual(24);
      expect(corner.y - workspace.y).toBeLessThanOrEqual(16);
      expect(corner.width).toBeGreaterThanOrEqual(44);
      const input = page.getByRole('textbox', { name: 'Mensagem' });
      await input.fill('A first line\nA second line\nA third line\nA fourth line');
      expect((await composer.boundingBox())!.height).toBeGreaterThan(bounds.height);
      await input.fill('');
      expect((await composer.boundingBox())!.height).toBeLessThanOrEqual(72);
    }
    await page.getByRole('button', { name: 'Conectar ideias', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Mensagem' })).toContainText('relações');
    await expect(page.locator('[data-chat-suggestions]')).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Mensagem' }).fill('');
    await expect(page.locator('[data-chat-suggestions]')).toBeVisible();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByRole('button', { name: 'Preferências da conversa' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      if (width === 1280) {
        await dialog.getByRole('combobox', { name: 'Modelo da conversa' }).selectOption('fast');
        await dialog.getByRole('checkbox', { name: 'Permitir pesquisa na web' }).check();
        await dialog.getByLabel('Chave da Brave Search API').fill('browser-fixture-key-not-real');
        await dialog.getByRole('button', { name: 'Salvar preferências' }).click();
        await expect(dialog.getByText('Preferências salvas.', { exact: true })).toBeVisible();
        await expect(dialog.getByText(/Chave de pesquisa configurada/)).toBeVisible();
        await dialog.getByRole('checkbox', { name: 'Remover chave de pesquisa' }).check();
        await dialog.getByRole('checkbox', { name: 'Permitir pesquisa na web' }).uncheck();
        await dialog.getByRole('button', { name: 'Salvar preferências' }).click();
        await expect(
          dialog.getByRole('checkbox', { name: 'Remover chave de pesquisa' }),
        ).toHaveCount(0);
      }
      await page.screenshot({ path: `/tmp/voxen-assistant-preferences-${width}.png` });
      await page.getByRole('button', { name: 'Fechar', exact: true }).click();
      await expect(dialog).toBeHidden();
      await page.screenshot({ path: `/tmp/voxen-assistant-${width}.png` });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
  });

  test('keeps a failed draft without requiring a conversation mode', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/chat');
    const draft = 'Encontre os conteúdos sobre arquitetura';
    const editor = page.getByRole('textbox', { name: 'Mensagem' });
    await editor.fill(draft);
    await editor.press('Enter');
    await expect(
      page.getByText('Configure um provedor de IA para conversar com a sua base.'),
    ).toBeVisible();
    await expect(editor).toHaveText(draft);
    await expect(page.getByRole('button', { name: 'Modo da conversa' })).toHaveCount(0);
    await expect(editor).toHaveText(draft);
    await page.screenshot({ path: '/tmp/voxen-assistant-error-mobile.png' });
  });

  test('retains keyboard input when the conversation cannot load', async ({ page }) => {
    let submissions = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/chat/messages'))
        submissions++;
    });
    await page.route(/\/api\/chat$/, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'ASSISTANT_UNAVAILABLE' }),
      }),
    );
    await page.goto('/chat');
    const input = page.getByRole('textbox', { name: 'Mensagem' });
    await input.fill('A draft while the service is unavailable');
    await input.press('Enter');
    await expect(input).toHaveText('A draft while the service is unavailable');
    await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeDisabled();
    expect(submissions).toBe(0);
    await page.unroute(/\/api\/chat$/);
    await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled();
    await expect(input).toHaveText('A draft while the service is unavailable');
  });

  test('streams real persisted work, resumes after navigation and rewinds while keeping a published note', async ({
    page,
  }) => {
    const userId = workspace!.userId;
    await setUserSetting(userId, 'ai_provider_key:anthropic', 'test-key-not-a-real-credential');
    await setUserSetting(
      userId,
      'ai_model_chains',
      JSON.stringify({ standard: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }] }),
    );
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.goto('/chat');
    const inputIdentity = await page.getByRole('textbox', { name: 'Mensagem' }).elementHandle();
    const announcement = page.locator('[data-chat-announcement]');
    await expect(announcement).toHaveText('');
    const announcementIdentity = await announcement.elementHandle();
    await page
      .getByRole('textbox', { name: 'Mensagem' })
      .fill('Consulte minhas fontes recentes e salve uma nota com as conexões importantes.');
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Parar', exact: true })).toBeVisible();
    await expect(announcement).toHaveText('Preparando resposta…');
    expect(await announcementIdentity!.evaluate((element) => element.isConnected)).toBe(true);
    const run = await db.assistantRun.findFirstOrThrow({ where: { userId, status: 'QUEUED' } });
    let step = 0;
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let releaseTool!: () => void;
    let enteredTool!: () => void;
    const toolReady = new Promise<void>((resolve) => {
      enteredTool = resolve;
    });
    const toolHeld = new Promise<void>((resolve) => {
      releaseTool = resolve;
    });
    const answer = `As suas fontes se conectam pelo tema **conhecimento verificável**.\n\n### O que aparece nas fontes\n\nA primeira fonte registra o conceito em um trecho com marcação de tempo. A segunda acrescenta contexto relacionado. Essa relação permite retomar a ideia sem depender de um resumo isolado.\n\n### Como aproveitar\n\n- Leia a passagem original antes de usar uma afirmação.\n- Compare as fontes para distinguir evidência e interpretação.\n- Use a nota salva para reunir o que merece ser revisitado.\n\nA nota foi salva na sua biblioteca.`;
    const usage = {
      inputTokens: { total: 300, noCache: 300, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 200, text: 200, reasoning: undefined },
    };
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          async start(c) {
            c.enqueue({ type: 'stream-start', warnings: [] });
            const turn = step++;
            if (turn < 2) {
              c.enqueue({
                type: 'tool-call',
                toolCallId: `tool-${turn}`,
                toolName: turn === 0 ? 'recent_content' : 'create_note',
                input: JSON.stringify(
                  turn === 0
                    ? { days: 30 }
                    : {
                        title: 'Conexões verificáveis',
                        content: 'An owned, retained publication.',
                        sourceIds: [workspace!.transcriptId],
                      },
                ),
              });
              if (turn === 0) {
                enteredTool();
                await toolHeld;
              }
              c.enqueue({
                type: 'finish',
                finishReason: { unified: 'tool-calls', raw: undefined },
                usage,
              });
            } else {
              c.enqueue({ type: 'text-start', id: 'answer' });
              c.enqueue({ type: 'text-delta', id: 'answer', delta: answer.slice(0, 100) });
              entered();
              await held;
              c.enqueue({ type: 'text-delta', id: 'answer', delta: answer.slice(100) });
              c.enqueue({ type: 'text-end', id: 'answer' });
              c.enqueue({
                type: 'finish',
                finishReason: { unified: 'stop', raw: undefined },
                usage,
              });
            }
            c.close();
          },
        }),
      }),
    });
    const execution = executeAssistantRun(run.id, {
      model: () => model,
      intent: async (_userId, request) => ({
        output: { notes: true, captures: false, evidence: request },
        modelRef: 'test-intent',
        usage: { inputTokens: 10, outputTokens: 10 },
        costUsd: 0,
      }),
    });
    await toolReady;
    const progress = page.locator('[data-chat-progress]');
    await expect(progress).toHaveCount(1);
    await expect(progress).not.toHaveAttribute('open');
    await progress.locator('summary').click();
    await expect(progress).toHaveAttribute('open', '');
    await expect(progress.getByText(/Consultando conteúdos recentes/)).toBeVisible();
    await page.screenshot({ path: '/tmp/voxen-chat-layout-tools.png' });
    releaseTool();
    await ready;
    await expect(announcement).toHaveText('Escrevendo resposta…');
    expect(await announcementIdentity!.evaluate((element) => element.isConnected)).toBe(true);
    await expect(progress.getByRole('status')).toHaveCount(0);
    await expect(progress.locator('summary')).toContainText('Escrevendo resposta…');
    await expect(page.getByText(/As suas fontes se conectam/)).toBeVisible();
    expect(await inputIdentity!.evaluate((element) => element.isConnected)).toBe(true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(
      await progress
        .locator('.assistant-progress-spinner')
        .evaluate((element) => getComputedStyle(element).animationName),
    ).toBe('none');
    await page.screenshot({ path: '/tmp/voxen-chat-layout-streaming.png' });
    await page.goto('/notas');
    release();
    await execution;
    await page.goto('/chat');
    await expect(
      page.getByText('A nota foi salva na sua biblioteca.', { exact: true }),
    ).toBeVisible();
    await expect(announcement).toHaveText('');
    await page.getByText('Fontes consultadas', { exact: true }).click();
    await expect(page.getByRole('link', { name: 'Matrix source', exact: true })).toBeVisible();
    for (const theme of ['dark', 'light']) {
      if (theme === 'light')
        await page.getByRole('radio', { name: 'Mudar para tema claro' }).click();
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await expect(page.getByRole('textbox', { name: 'Mensagem' })).toBeVisible();
        await page.screenshot({ path: `/tmp/voxen-assistant-populated-${theme}-${width}.png` });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
      }
      await page.setViewportSize({ width: 1280, height: 844 });
    }
    await page.getByRole('link', { name: 'Conexões verificáveis', exact: true }).click();
    await expect(page).toHaveURL(/\/notas\//);
    await page.goto('/chat');
    await page.getByRole('button', { name: 'Editar mensagem' }).click();
    await page
      .getByRole('dialog')
      .getByRole('textbox', { name: 'Mensagem' })
      .fill('Compare apenas as duas fontes originais.');
    await page.getByRole('button', { name: 'Salvar e continuar' }).click();
    await expect(
      page.getByText('Compare apenas as duas fontes originais.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('A nota foi salva na sua biblioteca.', { exact: true }),
    ).toHaveCount(0);
    expect(await db.note.count({ where: { userId, title: 'Conexões verificáveis' } })).toBe(1);
    await page.getByRole('button', { name: 'Parar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Parar', exact: true })).toHaveCount(0);
  });

  test('keeps a persistent announcement when an idle event stream fails and reconnects', async ({
    page,
  }) => {
    let release!: () => void;
    let requested!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      requested = resolve;
    });
    const events = /\/api\/chat\/events\?/;
    await page.route(events, async (route) => {
      requested();
      await held;
      await route.abort('connectionfailed');
    });
    try {
      await page.goto('/chat');
      await ready;
      const announcement = page.locator('[data-chat-announcement]');
      await expect(announcement).toHaveAttribute('role', 'status');
      await expect(announcement).toHaveAttribute('aria-live', 'polite');
      await expect(announcement).toHaveText('');
      const identity = await announcement.elementHandle();
      expect(
        await announcement.evaluate((element) => {
          for (
            let ancestor: Element | null = element;
            ancestor;
            ancestor = ancestor.parentElement
          ) {
            if (getComputedStyle(ancestor).display === 'none') return false;
          }
          return true;
        }),
      ).toBe(true);
      release();
      await expect(announcement).toHaveText('Reconectando à conversa…');
      expect(await identity!.evaluate((element) => element.isConnected)).toBe(true);
      await page.unroute(events);
      await expect(announcement).toHaveText('');
      expect(await identity!.evaluate((element) => element.isConnected)).toBe(true);
    } finally {
      release();
      await page.unroute(events);
    }
  });

  test('uploads an attachment through the owned capture pipeline', async ({ page }) => {
    await setUserSetting(
      workspace!.userId,
      'ai_provider_key:anthropic',
      'test-key-not-a-real-credential',
    );
    await setUserSetting(
      workspace!.userId,
      'ai_model_chains',
      JSON.stringify({ standard: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }] }),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/chat');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Enviar arquivo para análise' }).click();
    await (
      await chooser
    ).setFiles({
      name: 'research-note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('An owned attachment for capture.'),
    });
    await expect(page.getByRole('textbox', { name: 'Mensagem' })).toContainText('capture_job_id=');
    const job = await db.job.findFirstOrThrow({
      where: { userId: workspace!.userId, type: 'CAPTURE_UPLOAD' },
    });
    await expect(page.getByRole('textbox', { name: 'Mensagem' })).toContainText(job.id);
  });

  test('confirms or dismisses exact additions in the conversation without a mode', async ({
    page,
  }) => {
    const userId = workspace!.userId;
    await setUserSetting(userId, 'ai_provider_key:anthropic', 'test-key-not-a-real-credential');
    await setUserSetting(
      userId,
      'ai_model_chains',
      JSON.stringify({ standard: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }] }),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/chat');
    await page.getByRole('textbox', { name: 'Mensagem' }).fill('Como essas ideias se conectam?');
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Parar', exact: true })).toBeVisible();
    const run = await db.assistantRun.findFirstOrThrow({ where: { userId, status: 'QUEUED' } });
    let step = 0;
    const usage = {
      inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 50, text: 50, reasoning: undefined },
    };
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: 'stream-start', warnings: [] });
            if (step++ === 0) {
              for (const title of ['Síntese para revisar', 'Alternativa descartável'])
                c.enqueue({
                  type: 'tool-call',
                  toolCallId: title,
                  toolName: 'create_note',
                  input: JSON.stringify({
                    title,
                    content: 'Confira o conteúdo exato antes de salvar.',
                    sourceIds: [workspace!.transcriptId],
                  }),
                });
              c.enqueue({
                type: 'finish',
                finishReason: { unified: 'tool-calls', raw: undefined },
                usage,
              });
            } else {
              c.enqueue({ type: 'text-start', id: 'proposal' });
              c.enqueue({
                type: 'text-delta',
                id: 'proposal',
                delta:
                  'As fontes compartilham a mesma ideia. Posso guardar uma síntese; confira a proposta antes de confirmar.',
              });
              c.enqueue({ type: 'text-end', id: 'proposal' });
              c.enqueue({
                type: 'finish',
                finishReason: { unified: 'stop', raw: undefined },
                usage,
              });
            }
            c.close();
          },
        }),
      }),
    });
    await executeAssistantRun(run.id, {
      model: () => model,
      intent: async () => ({
        output: { notes: false, captures: false, evidence: '' },
        modelRef: 'test-intent',
        usage: { inputTokens: 5, outputTokens: 5 },
        costUsd: 0,
      }),
    });
    const cards = page.getByRole('region', { name: 'Confirmar adição à base' });
    await expect(cards).toHaveCount(2);
    expect(await db.note.count({ where: { userId, title: 'Síntese para revisar' } })).toBe(0);
    const saved = cards.filter({ hasText: 'Síntese para revisar' });
    const dismissed = cards.filter({ hasText: 'Alternativa descartável' });
    await saved.getByText('Ver conteúdo da nota', { exact: true }).click();
    await expect(
      saved.getByText('Confira o conteúdo exato antes de salvar.', { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: '/tmp/voxen-assistant-confirmation-390.png' });
    await dismissed.getByRole('button', { name: 'Não adicionar', exact: true }).click();
    await expect(dismissed.getByText('Esta adição foi descartada.')).toBeVisible();
    await saved.getByRole('button', { name: 'Confirmar adição', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Parar', exact: true })).toBeVisible();
    const approved = await db.assistantRun.findFirstOrThrow({
      where: { userId, status: 'QUEUED' },
    });
    const ack = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: 'stream-start', warnings: [] });
            c.enqueue({ type: 'text-start', id: 'saved' });
            c.enqueue({
              type: 'text-delta',
              id: 'saved',
              delta: 'A síntese confirmada foi salva.',
            });
            c.enqueue({ type: 'text-end', id: 'saved' });
            c.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage });
            c.close();
          },
        }),
      }),
    });
    await executeAssistantRun(approved.id, { model: () => ack });
    await expect(
      page.getByRole('link', { name: 'Síntese para revisar', exact: true }),
    ).toBeVisible();
    expect(await db.note.count({ where: { userId, title: 'Síntese para revisar' } })).toBe(1);
    expect(await db.note.count({ where: { userId, title: 'Alternativa descartável' } })).toBe(0);
    await page.reload();
    await expect(page.getByText('Esta adição foi descartada.')).toBeVisible();
  });

  test('keeps the phone composer above an emulated keyboard and Enter adds a line', async ({
    browser,
    page,
  }) => {
    const context = await browser.newContext({
      baseURL: 'http://127.0.0.1:5174',
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      storageState: await page.context().storageState(),
    });
    const phone = await context.newPage();
    try {
      await phone.addInitScript(() => {
        const viewport = Object.assign(new EventTarget(), {
          height: 844,
          width: 390,
          offsetTop: 0,
          offsetLeft: 0,
          scale: 1,
        });
        Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
      });
      await phone.goto('/chat');
      const input = phone.getByRole('textbox', { name: 'Mensagem' });
      await input.fill('Uma pergunta em duas linhas');
      await input.press('End');
      await input.press('Enter');
      await phone.keyboard.insertText('Segunda linha');
      await expect(input).toContainText('Segunda linha');
      expect(await input.innerText()).toContain('\nSegunda linha');
      expect(await db.assistantMessage.count({ where: { userId: workspace!.userId } })).toBe(0);
      await phone.evaluate(() => {
        // Viewport events are emulated; this does not assert OS keyboard behavior.
        Object.assign(window.visualViewport!, { height: 500 });
        window.visualViewport!.dispatchEvent(new Event('resize'));
      });
      await expect(phone.locator('html')).toHaveAttribute('data-keyboard', 'open');
      await expect(phone.locator('[data-chat-suggestions]')).toHaveCount(0);
      const send = (await phone
        .getByRole('button', { name: 'Enviar', exact: true })
        .boundingBox())!;
      expect(send.y + send.height).toBeLessThanOrEqual(500);
      await phone.screenshot({ path: '/tmp/voxen-assistant-keyboard-390.png' });
      await input.fill('');
      await expect(phone.locator('[data-chat-suggestions]')).toHaveCount(1);
      await expect(phone.locator('[data-chat-suggestions]')).toBeHidden();
      await phone.screenshot({ path: '/tmp/voxen-assistant-keyboard-empty-390.png' });
      await phone.evaluate(() => {
        Object.assign(window.visualViewport!, { height: 844 });
        window.visualViewport!.dispatchEvent(new Event('resize'));
      });
      await expect(phone.locator('[data-chat-suggestions]')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('renders both appearances and supported languages without horizontal overflow', async ({
    page,
  }) => {
    const previous = await getSetting('app_language');
    try {
      for (const locale of ['pt-BR', 'en'] as const) {
        await setSetting('app_language', locale);
        for (const theme of ['dark', 'light'] as const) {
          expect(
            (
              await page.request.patch('/api/account', {
                data: { theme: theme === 'dark' ? 'linear' : 'light' },
              })
            ).ok(),
          ).toBe(true);
          await page.goto('/chat');
          await expect(
            page.getByRole('heading', {
              name: locale === 'en' ? 'Chat' : 'Conversar',
              exact: true,
            }),
          ).toBeVisible();
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await page.evaluate(() => document.fonts.ready);
          for (const width of [1280, 390]) {
            await page.setViewportSize({ width, height: 844 });
            await expect(
              page.getByRole('textbox', {
                name: locale === 'en' ? 'Message' : 'Mensagem',
                exact: true,
              }),
            ).toBeVisible();
            expect(
              await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            ).toBe(true);
            await page.screenshot({
              path: `/tmp/voxen-assistant-empty-${locale}-${theme}-${width}.png`,
            });
          }
        }
      }
    } finally {
      if (previous === null) await deleteSetting('app_language');
      else await setSetting('app_language', previous);
    }
  });
});
