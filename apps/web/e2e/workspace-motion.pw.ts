import { expect, test, type Page } from '@playwright/test';
import { cleanupWorkspace, seedWorkspace, type WorkspaceSeed } from './workspace-seed';
import { db } from '../src/lib/db';

async function settle(page: Page) {
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    await Promise.allSettled(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished),
    );
  });
}

test.describe('workspace motion and control geometry (spec 233)', () => {
  let workspace: WorkspaceSeed;
  test.beforeEach(async ({ page }) => {
    expect(new URL(process.env.DATABASE_URL ?? '').pathname).toMatch(/test|e2e/i);
    workspace = await seedWorkspace(page, 'motion233');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/chat');
    await expect(page.getByRole('textbox', { name: 'Mensagem' })).toBeVisible();
  });
  test.afterEach(async () => {
    if (workspace) await cleanupWorkspace(workspace.userId);
  });

  async function mockConversation(page: Page, active = false) {
    await page.route('**/api/chat', (route) =>
      route.fulfill({
        json: {
          revision: 0,
          eventCursor: 0,
          hasMore: false,
          messages: [
            {
              id: 'synthetic-user',
              position: 1,
              role: 'user',
              text: 'Synthetic question for motion verification.',
              details: {},
              createdAt: '2026-11-15T00:00:00Z',
            },
            {
              id: 'synthetic-answer',
              position: 2,
              role: 'assistant',
              text: 'Synthetic response for motion verification.',
              details: {
                references: [
                  {
                    id: workspace.transcriptId,
                    title: 'Matrix source',
                    source: 'library',
                    href: '/transcricoes/' + workspace.transcriptId,
                  },
                ],
              },
              createdAt: '2026-11-15T00:00:00Z',
            },
          ],
          activeRun: active
            ? { id: 'synthetic-run', status: 'RUNNING', model: 'Synthetic fixture', revision: 0 }
            : null,
        },
      }),
    );
    await page.reload();
  }

  test('centers square capture and navigation controls in both appearances and locales', async ({
    page,
  }) => {
    let currentLocale = 'pt-BR';
    await page.route('**/api/me', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: { ...(await response.json()), language: currentLocale },
      });
    });
    for (const locale of ['pt-BR', 'en']) {
      currentLocale = locale;
      for (const theme of ['linear', 'light']) {
        expect((await page.request.patch('/api/account', { data: { theme } })).ok()).toBe(true);
        await page.evaluate((locale) => localStorage.setItem('voxen:locale', locale), locale);
        await page.goto('/chat');
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        if (await page.locator('#desktop-sidebar-close').count())
          await page.locator('#desktop-sidebar-close').click();
        await settle(page);
        const geometry = await page.locator('#desktop-sidebar').evaluate((side) => {
          const rail = side.getBoundingClientRect();
          return [
            ...side.querySelectorAll<HTMLElement>(
              '.desktop-new-capture, .desktop-nav-item, [data-sidebar-toggle]',
            ),
          ].map((control) => {
            const box = control.getBoundingClientRect(),
              icon = control.querySelector('svg')!.getBoundingClientRect();
            return {
              label: control.getAttribute('aria-label'),
              width: box.width,
              height: box.height,
              iconOffset: icon.x + icon.width / 2 - rail.width / 2,
            };
          });
        });
        for (const control of geometry) {
          expect(control.width, control.label ?? '').toBe(44);
          expect(control.height, control.label ?? '').toBe(44);
          expect(Math.abs(control.iconOffset), control.label ?? '').toBeLessThanOrEqual(1);
        }
        await page.locator('#desktop-sidebar-open').click();
        await settle(page);
        expect((await page.locator('.desktop-new-capture').boundingBox())!.height).toBe(44);
        await expect(page.locator('.desktop-new-capture')).toContainText(
          locale === 'en' ? 'New capture' : 'Nova captura',
        );
      }
    }
  });

  test('keeps icon cells and fading labels coherent throughout collapse and reversal', async ({
    page,
  }) => {
    const editor = page.getByRole('textbox', { name: 'Mensagem' });
    await editor.fill('Retained draft during every sampled frame.');
    const identity = await editor.elementHandle();
    const frames = await page.evaluate(async () => {
      const side = document.querySelector('#desktop-sidebar')!,
        main = document.querySelector('[data-app-surface]')!;
      (document.querySelector('#desktop-sidebar-close') as HTMLButtonElement).click();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const animations = document.getAnimations().filter((a) => {
        const target = (a.effect as KeyframeEffect).target;
        return target instanceof Element && (side.contains(target) || target === main);
      });
      animations.forEach((a) => a.pause());
      const samples = [];
      for (const time of [0, 50, 100, 150, 200]) {
        animations.forEach((a) => {
          a.currentTime = time;
        });
        const capture = side.querySelector('.desktop-new-capture')!,
          active = side.querySelector('[aria-current=page]')!;
        const icon = capture.querySelector('svg')!.getBoundingClientRect();
        const label = active.querySelector('span.truncate')!;
        samples.push({
          time,
          width: side.getBoundingClientRect().width,
          inset: main.getBoundingClientRect().left,
          iconCenter: icon.x + icon.width / 2,
          captureHeight: capture.getBoundingClientRect().height,
          labelWidth: label.getBoundingClientRect().width,
          labelOpacity: Number(getComputedStyle(label).opacity),
        });
      }
      animations.forEach((a) => {
        a.currentTime = 100;
        a.play();
      });
      return samples;
    });
    for (const frame of frames) {
      expect(Math.abs(frame.width - frame.inset)).toBeLessThanOrEqual(1);
      expect(frame.captureHeight).toBe(44);
      expect(frame.iconCenter).toBeGreaterThanOrEqual(31);
      expect(frame.iconCenter).toBeLessThanOrEqual(35);
      if (frame.time === 50) {
        expect(frame.labelOpacity).toBeGreaterThan(0);
        expect(frame.labelWidth).toBeGreaterThan(20);
      }
    }
    await page.locator('#desktop-sidebar-open').click();
    await settle(page);
    expect(await identity!.evaluate((element) => element.isConnected)).toBe(true);
    await expect(editor).toHaveText('Retained draft during every sampled frame.');
    expect((await page.locator('#desktop-sidebar').boundingBox())!.width).toBe(264);
  });

  test('folds an eligible release region without detaching it before the transition', async ({
    page,
  }) => {
    await page.route('**/api/releases/latest', (route) =>
      route.fulfill({
        json: {
          available: true,
          currentVersion: '0.15.1-dev.1',
          environment: 'dev',
          latestVersion: '9.9.9',
          latestTag: 'v9.9.9',
          latestEnvironment: 'prod',
          releaseUrl: 'https://github.com/Yefclub/Voxen/releases/tag/v9.9.9',
          checkedAt: '2026-11-15T00:00:00Z',
        },
      }),
    );
    await page.reload();
    const link = page.locator('#desktop-sidebar a[href$="/tag/v9.9.9"]');
    await expect(link).toBeVisible();
    const identity = await link.elementHandle();
    const before = (await page.locator('.desktop-nav-footer').boundingBox())!.height;
    await page.locator('#desktop-sidebar-close').click();
    expect(await identity!.evaluate((n) => n.isConnected)).toBe(true);
    const middle = await page.locator('.desktop-nav-footer').evaluate(async (footer) => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const animations = footer.getAnimations({ subtree: true });
      animations.forEach((a) => {
        a.pause();
        a.currentTime = 50;
      });
      const height = footer.getBoundingClientRect().height;
      animations.forEach((a) => a.play());
      return height;
    });
    await settle(page);
    const after = (await page.locator('.desktop-nav-footer').boundingBox())!.height;
    expect(middle).toBeLessThan(before);
    expect(middle).toBeGreaterThan(after);
    await expect(link).toBeHidden();
    await page.locator('#desktop-sidebar-open').click();
    await settle(page);
    await expect(link).toBeVisible();
    expect(await identity!.evaluate((n) => n.isConnected)).toBe(true);
  });

  test('preserves footer rhythm and usable menu anchors during keyboard collapse', async ({
    page,
  }) => {
    const footer = page.locator('.desktop-nav-footer');
    const before = (await footer.boundingBox())!.height;
    const account = footer.getByRole('button', { name: /^Menu do usuário:/ });
    const identity = await account.elementHandle();
    await account.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Control+b');
    await settle(page);
    await expect(page.locator('#desktop-sidebar')).toHaveAttribute('data-collapsed', 'true');
    expect(Math.abs((await footer.boundingBox())!.height - before)).toBeLessThanOrEqual(1);
    expect(await identity!.evaluate((n) => n.isConnected)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#desktop-sidebar-open')).toBeFocused();
    await footer.getByRole('button', { name: 'Aparência', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Aparência', exact: true })).toBeVisible();
    await page.keyboard.press('Control+b');
    await settle(page);
    // The appearance radio owns focus; the global shortcut must leave inputs alone.
    await expect(page.locator('#desktop-sidebar')).toHaveAttribute('data-collapsed', 'true');
    await page.keyboard.press('Escape');
    await expect(footer.getByRole('button', { name: 'Aparência', exact: true })).toBeFocused();
    await page.keyboard.press('Control+b');
    await settle(page);
    await expect(page.locator('#desktop-sidebar-close')).toBeFocused();
    expect(await identity!.evaluate((n) => n.isConnected)).toBe(true);
  });

  test('keeps short admin and user navigation reachable at desktop boundaries', async ({
    page,
  }) => {
    for (const role of ['ADMIN', 'USER'] as const) {
      await db.user.update({
        where: { id: workspace.userId },
        data: {
          role,
          name: 'A deliberately long workspace account name for overflow verification',
        },
      });
      for (const width of [768, 1024, 2000]) {
        await page.setViewportSize({ width, height: 600 });
        await page.goto('/chat');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        if (await page.locator('#desktop-sidebar-close').count())
          await page.locator('#desktop-sidebar-close').click();
        const links = page.locator('#desktop-sidebar-navigation a');
        expect(await links.count()).toBe(role === 'ADMIN' ? 10 : 9);
        for (const link of await links.all()) {
          await link.scrollIntoViewIfNeeded();
          const box = (await link.boundingBox())!;
          expect(box.height).toBe(44);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.y + box.height).toBeLessThanOrEqual(600);
        }
        const account = page
          .locator('.desktop-nav-footer')
          .getByRole('button', { name: /^Menu do usuário:/ });
        const box = (await account.boundingBox())!;
        expect(box.width).toBe(44);
        expect(box.height).toBe(44);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
    }
  });

  test('rotates progress and disclosure then stops spatial motion when reduced', async ({
    page,
  }) => {
    await mockConversation(page, true);
    const progress = page.locator('[data-chat-progress]');
    await expect(progress).toBeVisible();
    const rotation = await progress.locator('.assistant-progress-spinner').evaluate(async (n) => {
      const animation = n.getAnimations()[0]!;
      animation.pause();
      animation.currentTime = 0;
      const first = getComputedStyle(n).transform;
      animation.currentTime = 350;
      const next = getComputedStyle(n).transform;
      animation.play();
      return { first, next };
    });
    expect(rotation.first).not.toBe(rotation.next);
    await progress.locator('summary').click();
    await expect(progress).toHaveAttribute('open', '');
    await settle(page);
    expect(
      await progress
        .locator('.assistant-progress-chevron')
        .evaluate((n) => getComputedStyle(n).transform),
    ).not.toBe('none');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(
      await progress
        .locator('.assistant-progress-spinner')
        .evaluate((n) => n.getAnimations().length),
    ).toBe(0);
    await progress.locator('summary').click();
    await progress.locator('summary').click();
    expect(
      await progress
        .locator('.assistant-progress-chevron')
        .evaluate((n) => n.getAnimations().length),
    ).toBe(0);
    await expect(page.getByRole('textbox', { name: 'Mensagem' })).toBeVisible();
  });

  test('fades message actions with pointer and keyboard without reduced-motion animation', async ({
    page,
  }) => {
    await mockConversation(page);
    const message = page.locator('.assistant-message[data-sender=user]');
    const actions = message.locator('.assistant-message-actions');
    await page.mouse.move(0, 0);
    await settle(page);
    expect(await actions.evaluate((n) => getComputedStyle(n).opacity)).toBe('0');
    await message.hover();
    const middle = await actions.evaluate((n) => {
      const animation = n.getAnimations()[0]!;
      animation.pause();
      animation.currentTime = 80;
      const opacity = Number(getComputedStyle(n).opacity);
      animation.play();
      return opacity;
    });
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1);
    await settle(page);
    expect(await actions.evaluate((n) => getComputedStyle(n).opacity)).toBe('1');
    await actions.getByRole('button').first().focus();
    await page.mouse.move(0, 0);
    expect(await actions.evaluate((n) => getComputedStyle(n).opacity)).toBe('1');
    await page.getByRole('textbox', { name: 'Mensagem' }).focus();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await settle(page);
    await message.hover();
    expect(await actions.evaluate((n) => n.getAnimations().length)).toBe(0);
    expect(await actions.evaluate((n) => getComputedStyle(n).opacity)).toBe('1');
  });

  test('keeps press feedback static when reduced motion is requested', async ({ page }) => {
    const capture = page.locator('.desktop-new-capture');
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      await page.emulateMedia({ reducedMotion });
      const box = (await capture.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const scale = () =>
        capture.evaluate((n) => {
          const s = getComputedStyle(n).scale;
          return s === 'none' ? 1 : parseFloat(s);
        });
      if (reducedMotion === 'reduce') expect(await scale()).toBe(1);
      else await expect.poll(scale).toBeLessThan(1);
      await page.mouse.move(0, 0);
      await page.mouse.up();
      await settle(page);
      await expect(page).toHaveURL(/\/chat$/);
    }
  });

  test('transitions library feedback without changing separator clearance', async ({ page }) => {
    await page.goto('/transcricoes');
    await page.mouse.move(0, 0);
    const row = page.locator('.library-result-row').last();
    const before = await row.evaluate((n) => getComputedStyle(n, '::before').backgroundColor);
    await row.hover();
    const middle = await row.evaluate((n) => {
      const animation = n
        .getAnimations({ subtree: true })
        .find((a) => (a as CSSTransition).transitionProperty === 'background-color')!;
      animation.pause();
      animation.currentTime = 80;
      const style = getComputedStyle(n, '::before');
      const result = { background: style.backgroundColor, top: style.top, bottom: style.bottom };
      animation.play();
      return result;
    });
    await settle(page);
    const after = await row.evaluate((n) => getComputedStyle(n, '::before').backgroundColor);
    expect(middle.background).not.toBe(before);
    expect(middle.background).not.toBe(after);
    expect(middle.top).toBe('8px');
    expect(middle.bottom).toBe('8px');
    await page.mouse.move(0, 0);
    await settle(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await row.hover();
    expect(
      await row.evaluate(
        (n) =>
          n
            .getAnimations({ subtree: true })
            .filter((a) => (a as CSSTransition).transitionProperty === 'background-color').length,
      ),
    ).toBe(0);
  });

  test('opens and dismisses the retained phone drawer without losing the draft or focus', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const editor = page.getByRole('textbox', { name: 'Mensagem' });
    await editor.fill('Draft retained through phone navigation motion.');
    const identity = await editor.elementHandle();
    const trigger = page.getByRole('button', { name: 'Abrir menu', exact: true });
    const drawer = page.locator('aside[aria-label="Menu"]');
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      await page.emulateMedia({ reducedMotion });
      await trigger.click();
      await expect(drawer).toHaveAttribute('aria-modal', 'true');
      await expect.poll(() => drawer.evaluate((n) => n.getBoundingClientRect().x)).toBe(0);
      await expect(drawer.getByRole('link', { name: 'Biblioteca', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(drawer).toHaveAttribute('aria-hidden', 'true');
      await expect(trigger).toBeFocused();
      await expect(editor).toHaveText('Draft retained through phone navigation motion.');
      expect(await identity!.evaluate((n) => n.isConnected)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  });
});
