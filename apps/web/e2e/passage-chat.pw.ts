import { expect, test } from '@playwright/test';
import { MockLanguageModelV4 } from 'ai/test';
import { mkdir } from 'node:fs/promises';
import { seedWorkspace, cleanupWorkspace, type WorkspaceSeed } from './workspace-seed';
import { db } from '../src/lib/db';
import { setUserSetting } from '../src/lib/settings';
import { executeAssistantRun } from '../src/lib/assistant/runner';
import { executePassageIndex } from '../src/lib/passage-index/runner';

test.describe('current passage chat workflow', () => {
  let workspace: WorkspaceSeed | undefined;
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    expect(new URL(process.env.DATABASE_URL ?? '').pathname).toMatch(/test|e2e/i);
    errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    workspace = await seedWorkspace(page, 'passage-chat');
  });
  test.afterEach(async () => {
    if (workspace) await cleanupWorkspace(workspace.userId);
    expect(errors).toEqual([]);
  });
  for (const width of [1280, 390])
    test(`streams passage discovery and verified source navigation at ${width}px`, async ({
      page,
    }) => {
      const userId = workspace!.userId;
      const note = await db.note.create({
        data: {
          userId,
          title: 'Nota de validação sintética',
          content: '# Evidência\nO identificador ORION-PASSAGE-73 está registrado nesta nota.\n',
        },
      });
      expect(await executePassageIndex({ userId, type: 'note', id: note.id })).toBe(true);
      const head = await db.passageIndexSource.findUniqueOrThrow({
        where: {
          userId_sourceType_sourceId: { userId, sourceType: 'note', sourceId: note.id },
        },
      });
      const passage = await db.retrievalPassage.findFirstOrThrow({
        where: { userId, sourceType: 'note', sourceId: note.id },
      });
      await setUserSetting(userId, 'ai_provider_key:anthropic', 'test-key-not-a-real-credential');
      await setUserSetting(
        userId,
        'ai_model_chains',
        JSON.stringify({ standard: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }] }),
      );
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/chat');
      await page
        .getByRole('textbox', { name: 'Mensagem' })
        .fill('Encontre ORION-PASSAGE-73 nas minhas notas e confira a fonte.');
      await page.getByRole('button', { name: 'Enviar', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Parar', exact: true })).toBeVisible();
      const run = await db.assistantRun.findFirstOrThrow({ where: { userId, status: 'QUEUED' } });
      let step = 0,
        release!: () => void,
        entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const usage = {
        inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 50, text: 50, reasoning: undefined },
      };
      const answer = `O identificador **ORION-PASSAGE-73** está registrado na sua nota. [Fonte de teste](/notas/${note.id}).`;
      const model = new MockLanguageModelV4({
        doStream: async (input) => ({
          stream: new ReadableStream({
            async start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] });
              const turn = step++;
              if (turn < 2) {
                if (turn === 1) expect(JSON.stringify(input.prompt)).toContain(passage.key);
                controller.enqueue({
                  type: 'tool-call',
                  toolCallId: `passage-${turn}`,
                  toolName: turn ? 'read_passage' : 'search_passages',
                  input: JSON.stringify(
                    turn
                      ? { key: passage.key, revision: head.revision }
                      : {
                          query: 'ORION-PASSAGE-73',
                          limit: 4,
                          sourceTypes: ['note'],
                          sourceIds: [note.id],
                        },
                  ),
                });
                if (!turn) {
                  entered();
                  await held;
                }
                controller.enqueue({
                  type: 'finish',
                  finishReason: { unified: 'tool-calls', raw: undefined },
                  usage,
                });
              } else {
                controller.enqueue({ type: 'text-start', id: 'answer' });
                controller.enqueue({ type: 'text-delta', id: 'answer', delta: answer });
                controller.enqueue({ type: 'text-end', id: 'answer' });
                controller.enqueue({
                  type: 'finish',
                  finishReason: { unified: 'stop', raw: undefined },
                  usage,
                });
              }
              controller.close();
            },
          }),
        }),
      });
      const execution = executeAssistantRun(run.id, { model: () => model });
      try {
        await started;
        const progress = page.locator('[data-chat-progress]');
        await expect(progress).toBeVisible();
        await progress.locator('summary').click();
        await expect(progress.getByText(/Encontrando passagens relevantes/)).toBeVisible();
      } finally {
        release();
        await execution;
      }
      const completed = await db.assistantRun.findUniqueOrThrow({ where: { id: run.id } });
      expect(completed.status).toBe('DONE');
      const message = await db.assistantMessage.findUniqueOrThrow({
        where: { id: completed.outputMessageId! },
      });
      expect(message.details).toMatchObject({
        references: [
          expect.objectContaining({ id: note.id, href: `/notas/${note.id}`, verified: true }),
        ],
      });
      await expect(page.getByRole('link', { name: 'Fonte de teste', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const evidence = `${process.env.PASSAGE_BROWSER_EVIDENCE ?? '/tmp/voxen-passage-browser'}`;
      await mkdir(evidence, { recursive: true });
      await page.screenshot({ path: `${evidence}/chat-${width}.png`, fullPage: true });
      const [sourcePage] = await Promise.all([
        page.waitForEvent('popup'),
        page.getByRole('link', { name: 'Fonte de teste', exact: true }).click(),
      ]);
      await expect(sourcePage).toHaveURL(new RegExp(`/notas/${note.id}$`));
      await expect(
        sourcePage.getByRole('heading', { name: note.title, exact: true }),
      ).toBeVisible();
      await expect(page).toHaveURL(/\/chat$/);
      await sourcePage.close();
    });
});
