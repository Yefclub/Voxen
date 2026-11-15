import { expect, test } from '@playwright/test';
import { MockLanguageModelV4 } from 'ai/test';
import { seedWorkspace, cleanupWorkspace, type WorkspaceSeed } from './workspace-seed';
import { db } from '../src/lib/db';
import { setUserSetting } from '../src/lib/settings';
import { executeAssistantRun } from '../src/lib/assistant/runner';
import { mkdir } from 'node:fs/promises';

const answer =
  '## Síntese de validação\n\nUma resposta sintética com **evidência verificável**.\n\n- Preserve as fontes.\n- Compare os trechos.\n\n```ts\nconst source = "ORION-231";\n```';

test.describe('focused conversation craft', () => {
  let workspace: WorkspaceSeed;
  test.beforeEach(async ({ page }) => {
    expect(new URL(process.env.DATABASE_URL ?? '').pathname).toMatch(/test|e2e/i);
    workspace = await seedWorkspace(page, 'chat-craft');
    if (process.env.CHAT_CRAFT_EVIDENCE) await page.emulateMedia({ reducedMotion: 'reduce' });
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
  async function appearance(
    page: Parameters<typeof seedWorkspace>[0],
    theme: string,
    width: number,
  ) {
    expect(
      (
        await page.request.patch('/api/account', {
          data: { theme: theme === 'dark' ? 'linear' : 'light' },
        })
      ).ok(),
    ).toBe(true);
    await page.setViewportSize({ width, height: width >= 768 ? 800 : 844 });
    await page.goto('/chat');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByRole('textbox', { name: 'Mensagem' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
  }

  test('keeps the compact writing surface aligned and grows without losing its controls', async ({
    page,
  }) => {
    await page.goto('/chat');
    const input = page.getByRole('textbox', { name: 'Mensagem' });
    await expect(input).toBeVisible();
    for (const width of [1536, 1280, 390, 320]) {
      for (const theme of ['light', 'dark']) {
        await appearance(page, theme, width);
        const composer = page.locator('.assistant-composer');
        const body = composer.locator(':scope > div').first();
        expect(
          parseFloat(await body.evaluate((e) => getComputedStyle(e).borderRadius)),
        ).toBeGreaterThanOrEqual(24);
        const initial = (await composer.boundingBox())!;
        expect(initial.height).toBeLessThanOrEqual(72);
        const preferences = composer.getByRole('button', { name: 'Preferências da conversa' });
        await expect(preferences).toBeVisible();
        const plus = composer.getByRole('button', { name: 'Enviar arquivo para análise' });
        expect(
          await plus.locator('svg').evaluate((e) => {
            const icon = e.getBoundingClientRect();
            const button = e.closest('button')!.getBoundingClientRect();
            return Math.abs(icon.y + icon.height / 2 - button.y - button.height / 2);
          }),
        ).toBeLessThanOrEqual(1);
        await capture(page, `empty-${theme}-${width}`);
        const editorIdentity = await input.elementHandle();
        await input.fill('Oi');
        expect((await composer.boundingBox())!.height).toBeLessThanOrEqual(72);
        await input.fill('Primeira linha\nSegunda linha\nTerceira linha\nQuarta linha');
        expect((await composer.boundingBox())!.height).toBeGreaterThan(initial.height);
        await capture(page, `draft-${theme}-${width}`);
        for (const label of ['Enviar', 'Enviar arquivo para análise', 'Preferências da conversa']) {
          const control = page.getByRole('button', { name: label, exact: true });
          const box = (await control.boundingBox())!;
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.x).toBeGreaterThanOrEqual(initial.x);
          expect(box.x + box.width).toBeLessThanOrEqual(initial.x + initial.width + 1);
        }
        await expect(page.locator('[data-chat-suggestions]')).toHaveCount(0);
        await input.fill('Oi');
        expect((await composer.boundingBox())!.height).toBeGreaterThan(72);
        await input.fill('');
        expect((await composer.boundingBox())!.height).toBeLessThanOrEqual(72);
        await input.fill('Uma pergunta que ocupa mais espaço na linha de escrita. '.repeat(8));
        await expect.poll(async () => (await composer.boundingBox())!.height).toBeGreaterThan(72);
        const wrapped = (await input.boundingBox())!;
        const send = (await page
          .getByRole('button', { name: 'Enviar', exact: true })
          .boundingBox())!;
        expect(send.y).toBeGreaterThanOrEqual(wrapped.y + wrapped.height);
        await input.fill('Linha de conteúdo.\n'.repeat(24));
        expect((await composer.boundingBox())!.height).toBeLessThanOrEqual(250);
        await capture(page, `long-draft-${theme}-${width}`);
        await input.fill('');
        expect(await editorIdentity!.evaluate((e) => e.isConnected)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
    }
  });

  async function populate(
    page: Parameters<typeof seedWorkspace>[0],
    response = answer,
    hold?: { started: () => void; wait: Promise<void> },
  ) {
    await setUserSetting(
      workspace.userId,
      'ai_provider_key:anthropic',
      'test-key-not-a-real-credential',
    );
    await setUserSetting(
      workspace.userId,
      'ai_model_chains',
      JSON.stringify({ standard: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }] }),
    );
    await page.goto('/chat');
    await page
      .getByRole('textbox', { name: 'Mensagem' })
      .fill('Prepare uma resposta para a validação sintética.');
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Parar', exact: true })).toBeVisible();
    const run = await db.assistantRun.findFirstOrThrow({
      where: { userId: workspace.userId, status: 'QUEUED' },
    });
    let step = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          async start(c) {
            c.enqueue({ type: 'stream-start', warnings: [] });
            if (step++ === 0) {
              c.enqueue({
                type: 'tool-call',
                toolCallId: 'recent',
                toolName: 'recent_content',
                input: JSON.stringify({ days: 30 }),
              });
              c.enqueue({
                type: 'finish',
                finishReason: { unified: 'tool-calls', raw: undefined },
                usage: {
                  inputTokens: {
                    total: 10,
                    noCache: 10,
                    cacheRead: undefined,
                    cacheWrite: undefined,
                  },
                  outputTokens: { total: 10, text: 10, reasoning: undefined },
                },
              });
              c.close();
              return;
            }
            c.enqueue({ type: 'text-start', id: 'answer' });
            c.enqueue({ type: 'text-delta', id: 'answer', delta: response });
            if (hold) {
              hold.started();
              await hold.wait;
              c.enqueue({
                type: 'text-delta',
                id: 'answer',
                delta: '\n\nFim da resposta verificada.',
              });
            }
            c.enqueue({ type: 'text-end', id: 'answer' });
            c.enqueue({
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              usage: {
                inputTokens: {
                  total: 100,
                  noCache: 100,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: { total: 50, text: 50, reasoning: undefined },
              },
            });
            c.close();
          },
        }),
      }),
    });
    await executeAssistantRun(run.id, { model: () => model });
    await expect(page.getByRole('heading', { name: 'Síntese de validação' })).toBeVisible();
  }

  test('copies the complete answer and announces the outcome without replacing the draft', async ({
    page,
  }) => {
    await populate(page);
    for (const width of [1536, 1280, 390, 320]) {
      for (const theme of ['light', 'dark']) {
        await appearance(page, theme, width);
        const composer = (await page.locator('.assistant-composer').boundingBox())!;
        const assistant = (await page.locator('.assistant-answer').boundingBox())!;
        const user = (await page
          .locator('.assistant-message[data-sender="user"] .assistant-bubble')
          .boundingBox())!;
        expect(Math.abs(assistant.x - composer.x)).toBeLessThanOrEqual(2);
        expect(Math.abs(user.x + user.width - composer.x - composer.width)).toBeLessThanOrEqual(2);
        await capture(page, `conversation-${theme}-${width}`);
      }
    }
    const editor = page.getByRole('textbox', { name: 'Mensagem' });
    await editor.fill('Meu rascunho junto das fontes');
    const dock = (await page.locator('.assistant-composer').boundingBox())!;
    await page.getByRole('button', { name: 'Fontes consultadas', exact: true }).click();
    const sources = page.getByRole('region', { name: 'Fontes consultadas', exact: true });
    await expect(sources.getByRole('link', { name: 'Matrix source', exact: true })).toBeVisible();
    expect(
      Math.abs((await page.locator('.assistant-composer').boundingBox())!.y - dock.y),
    ).toBeLessThanOrEqual(2);
    await capture(page, 'sources-dark-320');
    const [source] = await Promise.all([
      page.waitForEvent('popup'),
      sources.getByRole('link', { name: 'Matrix source', exact: true }).click(),
    ]);
    await expect(source).toHaveURL(new RegExp(`/transcricoes/${workspace.transcriptId}$`));
    await source.close();
    await expect(editor).toHaveText('Meu rascunho junto das fontes');
    await page.getByRole('button', { name: 'Modelo e uso', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Modelo e uso', exact: true })).toContainText(
      'claude-haiku',
    );
    await capture(page, 'usage-dark-320');
    await page.getByRole('button', { name: 'Modelo e uso', exact: true }).click();
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (window as unknown as { copiedAnswer: string }).copiedAnswer = text;
          },
        },
      });
    });
    const draft = page.getByRole('textbox', { name: 'Mensagem' });
    await draft.fill('Continuar daqui com meu rascunho');
    await page.getByRole('button', { name: 'Copiar resposta', exact: true }).click();
    expect(
      await page.evaluate(() => (window as unknown as { copiedAnswer: string }).copiedAnswer),
    ).toBe(answer);
    await expect(page.getByRole('status').filter({ hasText: 'Resposta copiada.' })).toBeVisible();
    await expect(draft).toHaveText('Continuar daqui com meu rascunho');
    await capture(page, 'copied-dark-320');
  });

  test('keeps the answer and draft when clipboard access is unavailable', async ({ page }) => {
    await populate(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error('Clipboard blocked');
          },
        },
      });
      const original = document.execCommand.bind(document);
      document.execCommand = (name, ...args) => (name === 'copy' ? false : original(name, ...args));
    });
    const draft = page.getByRole('textbox', { name: 'Mensagem' });
    await draft.fill('Meu rascunho permanece');
    await page.getByRole('button', { name: 'Copiar resposta', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Selecione e copie o texto' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Síntese de validação' })).toBeVisible();
    await expect(draft).toHaveText('Meu rascunho permanece');
    await capture(page, 'copy-error-desktop');
  });

  test('preserves older reading during streaming and returns to the latest response on request', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let release!: () => void;
    let started!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const execution = populate(
      page,
      answer + '\n\n' + 'Uma passagem sintética para leitura contínua.\n\n'.repeat(70),
      { started, wait },
    );
    try {
      await ready;
      const transcript = page.locator('.assistant-transcript');
      await expect.poll(() => transcript.evaluate((e) => e.scrollTop)).toBeGreaterThan(500);
      await transcript.evaluate((e) => {
        e.scrollTop = 0;
      });
      const jump = page.getByRole('button', { name: 'Ir para a última mensagem', exact: true });
      await expect(jump).toBeVisible();
      await page
        .getByRole('textbox', { name: 'Mensagem' })
        .fill('Rascunho preservado durante leitura');
      const before = await transcript.evaluate((e) => e.scrollTop);
      await capture(page, 'streaming-reading-desktop');
      release();
      await execution;
      await expect(page.getByRole('button', { name: 'Parar', exact: true })).toBeHidden();
      expect(
        Math.abs((await transcript.evaluate((e) => e.scrollTop)) - before),
      ).toBeLessThanOrEqual(2);
      await expect(page.getByRole('textbox', { name: 'Mensagem' })).toHaveText(
        'Rascunho preservado durante leitura',
      );
      await jump.click();
      await expect
        .poll(() => transcript.evaluate((e) => e.scrollHeight - e.clientHeight - e.scrollTop))
        .toBeLessThanOrEqual(2);
      await capture(page, 'long-answer-desktop');
    } finally {
      release();
      await execution;
    }
  });
});
