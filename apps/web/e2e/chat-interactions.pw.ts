import { expect, test } from '@playwright/test';
import { seedWorkspace, cleanupWorkspace, type WorkspaceSeed } from './workspace-seed';
import { db } from '../src/lib/db';
import { setUserSetting } from '../src/lib/settings';

test.describe('chat interaction details', () => {
  let workspace: WorkspaceSeed;
  test.beforeEach(async ({ page }) => {
    expect(new URL(process.env.DATABASE_URL ?? '').pathname).toMatch(/test|e2e/i);
    workspace = await seedWorkspace(page, 'interactions232');
    await setUserSetting(workspace.userId, 'ai_provider_key:anthropic', 'test-key-not-real');
    await setUserSetting(
      workspace.userId,
      'ai_model_chains',
      JSON.stringify({ standard: [{ provider: 'anthropic', model: 'claude-haiku-5-5' }] }),
    );
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/chat');
  });
  test.afterEach(async () => {
    if (workspace) await cleanupWorkspace(workspace.userId);
  });

  async function conversation() {
    await db.assistantConversation.upsert({
      where: { userId: workspace.userId },
      create: { userId: workspace.userId, nextPosition: 3 },
      update: { nextPosition: 3 },
    });
    await db.assistantMessage.createMany({
      data: [
        {
          userId: workspace.userId,
          position: 1,
          role: 'user',
          text: 'Compare as fontes da minha biblioteca.',
        },
        {
          userId: workspace.userId,
          position: 2,
          role: 'assistant',
          text:
            '## Resposta sintética\n\n' +
            'Um parágrafo de evidência para validar a leitura e a navegação.\n\n'.repeat(40),
          details: {
            references: [
              {
                id: workspace.transcriptId,
                title: 'Matrix source',
                source: 'library',
                href: '/transcricoes/' + workspace.transcriptId,
              },
            ],
            model: 'Synthetic model',
          },
        },
      ],
    });
  }

  test('animates and reverses sidebar geometry without replacing the editor', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const editor = page.getByRole('textbox', { name: 'Mensagem' });
    await editor.fill('Um rascunho que deve permanecer.');
    const identity = await editor.elementHandle();
    const sample = await page.evaluate(async () => {
      const side = document.querySelector('#desktop-sidebar')!;
      (document.querySelector('#desktop-sidebar-close') as HTMLButtonElement).click();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const animations = side.getAnimations();
      for (const a of animations) {
        a.pause();
        a.currentTime = 100;
      }
      const width = side.getBoundingClientRect().width;
      const itemWidth = side.querySelector('[aria-current="page"]')!.getBoundingClientRect().width;
      const main = document.querySelector('[data-app-surface]')!;
      for (const a of main.getAnimations()) {
        a.pause();
        a.currentTime = 100;
      }
      const left = main.getBoundingClientRect().left;
      for (const a of [...animations, ...main.getAnimations()]) a.play();
      return { animations: animations.length, width, left, itemWidth };
    });
    expect(sample.animations).toBeGreaterThan(0);
    expect(sample.width).toBeGreaterThan(64);
    expect(sample.width).toBeLessThan(264);
    expect(Math.abs(sample.width - sample.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(sample.width - 21 - sample.itemWidth)).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Expandir menu', exact: true }).click();
    await expect
      .poll(() => page.locator('#desktop-sidebar').evaluate((n) => n.getBoundingClientRect().width))
      .toBe(264);
    expect(await identity!.evaluate((n) => n.isConnected)).toBe(true);
    await expect(editor).toHaveText('Um rascunho que deve permanecer.');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Recolher', exact: true }).click();
    expect(
      await page.locator('#desktop-sidebar').evaluate((n) => n.getBoundingClientRect().width),
    ).toBe(64);
    await page.getByRole('button', { name: 'Expandir menu', exact: true }).focus();
    await page.keyboard.press('Control+Shift+b');
    await expect(page.locator('#desktop-sidebar')).toHaveAttribute('data-collapsed', 'true');
    await page.keyboard.press('Control+b');
    await expect(page.locator('#desktop-sidebar')).toHaveAttribute('data-collapsed', 'false');
    await editor.press('Control+b');
    await expect(page.locator('#desktop-sidebar')).toHaveAttribute('data-collapsed', 'false');
  });

  test('previews and removes image and file attachments before any upload', async ({ page }) => {
    let uploads = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/api/captures/upload')) uploads++;
    });
    const input = page.locator('.assistant-composer input[type=file]');
    await input.setInputFiles({
      name: 'research.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Synthetic research.'),
    });
    const preview = page.getByRole('group', { name: 'Arquivo anexado' });
    await expect(preview).toContainText('research.txt');
    await preview.getByRole('button', { name: 'Remover arquivo' }).click();
    await expect(preview).toHaveCount(0);
    await input.setInputFiles({
      name: 'image.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwmFDwHwAElAJAd61mMQAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
    await expect(preview.getByRole('img', { name: 'image.png' })).toBeVisible();
    await preview.getByRole('button', { name: 'Remover arquivo' }).click();
    expect(uploads).toBe(0);
    expect(
      await db.job.count({ where: { userId: workspace.userId, type: 'CAPTURE_UPLOAD' } }),
    ).toBe(0);
  });

  test('decodes raster previews and leaves vector or invalid images removable', async ({
    page,
  }) => {
    let uploads = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/captures/upload')) uploads++;
    });
    const input = page.locator('.assistant-composer input[type=file]');
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 120;
      canvas.getContext('2d')!.fillRect(0, 0, 240, 120);
      return canvas.toDataURL('image/png');
    });
    await input.setInputFiles({
      name: 'decoded.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png.split(',')[1]!, 'base64'),
    });
    const preview = page.getByRole('group', { name: 'Arquivo anexado' });
    const image = preview.getByRole('img', { name: 'decoded.png' });
    await expect(image).toHaveAttribute('src', /^data:image\/png;base64,/);
    await expect
      .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBe(96);
    expect(await image.evaluate((node) => (node as HTMLImageElement).naturalHeight)).toBe(48);
    await preview.getByRole('button', { name: 'Remover arquivo' }).click();
    for (const file of [
      {
        name: 'vector.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" onload="window.previewExecuted=true"/>',
        ),
      },
      {
        name: 'invalid.png',
        mimeType: 'image/png',
        buffer: Buffer.from('<html><script>window.previewExecuted=true</script></html>'),
      },
    ]) {
      await input.setInputFiles(file);
      await expect(preview).toContainText(file.name);
      await expect(preview.locator('img')).toHaveCount(0);
      await preview.getByRole('button', { name: 'Remover arquivo' }).click();
      await expect(preview).toHaveCount(0);
    }
    expect(await page.evaluate(() => Reflect.get(window, 'previewExecuted'))).toBeUndefined();
    expect(uploads).toBe(0);
    expect(
      await db.job.count({ where: { userId: workspace.userId, type: 'CAPTURE_UPLOAD' } }),
    ).toBe(0);
  });

  test('retains failed attachments and reuses an uploaded capture on message retry', async ({
    page,
  }) => {
    let uploads = 0,
      messages = 0;
    await page.route('**/api/captures/upload', async (route) => {
      uploads++;
      if (uploads === 1) await route.fulfill({ status: 503, json: { error: 'UNAVAILABLE' } });
      else await route.continue();
    });
    await page.route('**/api/chat/messages', async (route) => {
      messages++;
      if (messages === 1)
        await route.fulfill({ status: 503, json: { error: 'ASSISTANT_UNAVAILABLE' } });
      else await route.continue();
    });
    const editor = page.getByRole('textbox', { name: 'Mensagem' });
    await editor.fill('Analise este arquivo.');
    await page.locator('.assistant-composer input[type=file]').setInputFiles({
      name: 'research.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Synthetic content.'),
    });
    await expect(page.getByRole('group', { name: 'Arquivo anexado' })).toContainText(
      'research.txt',
    );
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(
      page.getByText('Não foi possível enviar o arquivo.', { exact: false }),
    ).toBeVisible();
    await expect(editor).toHaveText('Analise este arquivo.');
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(
      page.getByText('A conversa está indisponível no momento.', { exact: false }),
    ).toBeVisible();
    const job = await db.job.findFirstOrThrow({
      where: { userId: workspace.userId, type: 'CAPTURE_UPLOAD' },
    });
    await expect(page.getByRole('group', { name: 'Arquivo anexado' })).toContainText(
      'research.txt',
    );
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(editor).toBeEmpty();
    await expect(page.getByRole('group', { name: 'Arquivo anexado' })).toHaveCount(0);
    expect(uploads).toBe(2);
    expect(messages).toBe(2);
    expect(
      await db.job.count({ where: { userId: workspace.userId, type: 'CAPTURE_UPLOAD' } }),
    ).toBe(1);
    expect(
      (
        await db.assistantMessage.findFirstOrThrow({
          where: { userId: workspace.userId, role: 'user' },
        })
      ).text,
    ).toContain(`capture_job_id=${job.id}`);
  });

  test('keeps sources beside the desktop answer and in a phone sheet', async ({ page }) => {
    await conversation();
    await page.reload();
    const editor = page.getByRole('textbox', { name: 'Mensagem' });
    await editor.fill('Meu rascunho.');
    const identity = await editor.elementHandle();
    const trigger = page.getByRole('button', { name: 'Fontes consultadas', exact: true });
    await trigger.click();
    const side = page.getByRole('complementary', { name: 'Fontes consultadas', exact: true });
    await expect(side).toBeVisible();
    const box = (await side.boundingBox())!,
      composer = (await page.locator('.assistant-composer').boundingBox())!;
    expect(box.height).toBe(800);
    expect(composer.x + composer.width).toBeLessThanOrEqual(box.x);
    await expect(editor).toBeVisible();
    expect(await identity!.evaluate((n) => n.isConnected)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(side).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    await trigger.click();
    const sheet = page.getByRole('dialog', { name: 'Fontes consultadas', exact: true });
    await expect(sheet).toBeVisible();
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      sheet.getByRole('link', { name: 'Matrix source', exact: true }).click(),
    ]);
    await expect(popup).toHaveURL(new RegExp('/transcricoes/' + workspace.transcriptId + '$'));
    await popup.close();
    await sheet.getByRole('button', { name: 'Fechar', exact: true }).click();
    await expect(editor).toHaveText('Meu rascunho.');
  });

  test('floats the latest-message control without moving the composer', async ({ page }) => {
    await conversation();
    await page.reload();
    const scroll = page.locator('.assistant-transcript');
    const composer = page.locator('.assistant-composer');
    const before = (await composer.boundingBox())!;
    await scroll.evaluate((n) => {
      n.scrollTop = 0;
      n.dispatchEvent(new Event('scroll'));
    });
    const jump = page.getByRole('button', { name: 'Ir para a última mensagem', exact: true });
    await expect(jump).toBeVisible();
    const box = (await jump.boundingBox())!;
    expect(box.width).toBe(44);
    expect(box.height).toBe(44);
    expect(Math.abs((await composer.boundingBox())!.y - before.y)).toBeLessThanOrEqual(1);
    expect(await jump.evaluate((n) => getComputedStyle(n.parentElement!).backgroundColor)).toBe(
      'rgba(0, 0, 0, 0)',
    );
    await jump.click();
    await expect(jump).toBeHidden();
    expect(Math.abs((await composer.boundingBox())!.y - before.y)).toBeLessThanOrEqual(1);
  });

  test('gives library hover equal clearance from both separators', async ({ page }) => {
    await page.goto('/transcricoes');
    const row = page.locator('.library-result-row').last();
    await row.hover();
    const clearance = await row.evaluate((n) => {
      const style = getComputedStyle(n, '::before');
      const previous = n.previousElementSibling!.getBoundingClientRect();
      return {
        top: n.getBoundingClientRect().top + parseFloat(style.top) - previous.bottom,
        bottom: parseFloat(style.bottom),
      };
    });
    expect(clearance.top).toBe(8);
    expect(clearance.bottom).toBe(8);
  });

  test('keeps a removable attachment and draft after a network upload failure', async ({
    page,
  }) => {
    await page.route('**/api/captures/upload', (route) => route.abort('failed'));
    await page.getByRole('textbox', { name: 'Mensagem' }).fill('Um rascunho antes da falha.');
    await page.locator('.assistant-composer input[type=file]').setInputFiles({
      name: 'network.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Synthetic file.'),
    });
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(
      page.getByText('Não foi possível enviar o arquivo.', { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Mensagem' })).toHaveText(
      'Um rascunho antes da falha.',
    );
    await page
      .getByRole('group', { name: 'Arquivo anexado' })
      .getByRole('button', { name: 'Remover arquivo' })
      .click();
    expect(
      await db.job.count({ where: { userId: workspace.userId, type: 'CAPTURE_UPLOAD' } }),
    ).toBe(0);
  });

  test('uses one outer focus surface for attachments in both appearances', async ({ page }) => {
    for (const theme of ['linear', 'light']) {
      expect((await page.request.patch('/api/account', { data: { theme } })).ok()).toBe(true);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/chat');
      await page.locator('.assistant-composer input[type=file]').setInputFiles({
        name: 'focus.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Synthetic preview.'),
      });
      const editor = page.getByRole('textbox', { name: 'Mensagem' });
      await editor.fill('Rascunho com foco visível.');
      await editor.press('ArrowRight');
      const focus = await page.locator('.assistant-composer').evaluate((n) => {
        const body = getComputedStyle(n.querySelector(':scope > div')!);
        const root = getComputedStyle(n);
        return {
          innerShadow: body.boxShadow,
          innerOutline: body.outlineStyle,
          outerOutline: root.outlineStyle,
          outerWidth: parseFloat(root.outlineWidth),
        };
      });
      expect(focus.innerShadow).toBe('none');
      expect(focus.innerOutline).toBe('none');
      expect(focus.outerOutline).toBe('solid');
      expect(focus.outerWidth).toBeGreaterThanOrEqual(2);
    }
  });

  test('keeps the latest answer visible when an attachment grows the composer', async ({
    page,
  }) => {
    await conversation();
    await page.reload();
    const scroll = page.locator('.assistant-transcript');
    await scroll.evaluate((n) => {
      n.scrollTop = n.scrollHeight;
      n.dispatchEvent(new Event('scroll'));
    });
    const distance = () => scroll.evaluate((n) => n.scrollHeight - n.clientHeight - n.scrollTop);
    await expect.poll(distance).toBeLessThanOrEqual(2);
    await page.locator('.assistant-composer input[type=file]').setInputFiles({
      name: 'viewport.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Synthetic file.'),
    });
    await expect(page.getByRole('group', { name: 'Arquivo anexado' })).toBeVisible();
    await expect.poll(distance).toBeLessThanOrEqual(2);
    await scroll.evaluate((n) => {
      n.scrollTop = 120;
      n.dispatchEvent(new Event('scroll'));
    });
    await expect(
      page.getByRole('button', { name: 'Ir para a última mensagem', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Mensagem' })
      .fill('Primeira linha\nSegunda linha\nTerceira linha\nQuarta linha');
    expect(Math.abs((await scroll.evaluate((n) => n.scrollTop)) - 120)).toBeLessThanOrEqual(2);
  });

  test('does not submit a late upload result after leaving the chat', async ({ page }) => {
    let release!: () => void;
    let started!: () => void;
    let settled!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const uploading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      settled = resolve;
    });
    let messages = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/chat/messages')) messages++;
    });
    await page.route('**/api/captures/upload', async (route) => {
      started();
      await gate;
      await route.fulfill({ status: 200, json: { job: { id: 'synthetic-late-upload' } } });
      settled();
    });
    await page.locator('.assistant-composer input[type=file]').setInputFiles({
      name: 'late.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Synthetic file.'),
    });
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await uploading;
    await page.getByRole('link', { name: 'Biblioteca', exact: true }).click();
    await expect(page).toHaveURL(/\/transcricoes$/);
    release();
    await finished;
    await page.getByRole('link', { name: 'Conversar', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Mensagem' })).toBeVisible();
    expect(messages).toBe(0);
    expect(await db.assistantMessage.count({ where: { userId: workspace.userId } })).toBe(0);
  });
});
