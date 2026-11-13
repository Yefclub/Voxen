import { expect, test, type Locator } from '@playwright/test';
import { cleanupWorkspace, seedWorkspace, type WorkspaceSeed } from './workspace-seed';

async function labelGeometry(button: Locator): Promise<{
  lines: number;
  top: number;
  bottom: number;
  paddingTop: number;
  paddingBottom: number;
}> {
  return button.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const rects: DOMRect[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!node.textContent?.trim() || !parent || parent.closest('svg, [role="status"]')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      rects.push(...Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0));
    }
    if (!rects.length) throw new Error('Expected a rendered action label');
    return {
      lines: new Set(rects.map((r) => Math.round(r.top))).size,
      top: Math.min(...rects.map((r) => r.top)) - rect.top,
      bottom: rect.bottom - Math.max(...rects.map((r) => r.bottom)),
      paddingTop: parseFloat(style.paddingTop),
      paddingBottom: parseFloat(style.paddingBottom),
    };
  });
}

test.describe('readable control labels (spec 227)', () => {
  test.skip(process.env.VOXEN_E2E !== '1', 'Run against an isolated Voxen test database.');
  let workspace: WorkspaceSeed | undefined;

  test.beforeEach(async ({ page }) => {
    expect(new URL(process.env.DATABASE_URL ?? '').pathname).toMatch(/test|e2e/i);
    workspace = await seedWorkspace(page, 'control-labels');
  });

  test.afterEach(async () => {
    if (workspace) await cleanupWorkspace(workspace.userId);
    workspace = undefined;
  });

  for (const width of [320, 390, 768, 1280, 1920]) {
    for (const locale of ['pt-BR', 'en']) {
      for (const appearance of ['light', 'dark']) {
        test(`contains Guide action labels at ${width}px in ${locale} ${appearance}`, async ({
          page,
        }, testInfo) => {
          await page.setViewportSize({ width, height: 900 });
          const preference = await page.request.patch('/api/account', {
            data: { theme: appearance === 'light' ? 'light' : 'linear' },
          });
          expect(preference.ok()).toBeTruthy();
          await page.addInitScript(
            ({ locale, appearance }) => {
              localStorage.setItem('voxen:locale', locale);
              localStorage.setItem('voxen:theme', appearance === 'light' ? 'light' : 'linear');
            },
            { locale, appearance },
          );
          await page.route('**/api/me', async (route) => {
            const response = await route.fetch();
            const body = await response.json();
            await route.fulfill({ response, json: { ...body, language: locale } });
          });
          await page.goto(`/transcricoes/${workspace!.transcriptId}`);
          await expect(page.locator('html')).toHaveAttribute('lang', locale);
          await expect(page.locator('html')).toHaveAttribute('data-theme', appearance);
          if (width < 1280) {
            await page
              .getByRole('button', { name: /^(Opções do conteúdo|Content options)$/ })
              .click();
          }
          const feedback = page.getByTestId('transcript-interest-feedback');
          const actions = feedback.getByRole('button');
          await expect(actions).toHaveCount(2);
          await expect(actions.first()).toBeEnabled();
          for (const textScale of [100, 200]) {
            await page.evaluate((scale) => {
              document.documentElement.style.fontSize = `${scale}%`;
            }, textScale);
            await feedback.scrollIntoViewIfNeeded();
            for (const action of await actions.all()) {
              await action.scrollIntoViewIfNeeded();
              await expect(action).toBeVisible();
              await expect(action).toBeInViewport({ ratio: 1 });
              const geometry = await labelGeometry(action);
              expect(geometry.top).toBeGreaterThanOrEqual(geometry.paddingTop - 0.5);
              expect(geometry.bottom).toBeGreaterThanOrEqual(geometry.paddingBottom - 0.5);
              if (textScale === 100) expect(geometry.lines).toBe(1);
            }
            expect(await page.locator('html').evaluate((e) => e.scrollWidth)).toBeLessThanOrEqual(
              width,
            );
            await page.screenshot({
              path: testInfo.outputPath(`guide-${appearance}-${locale}-${width}-${textScale}.png`),
            });
          }
        });
      }
    }
  }
});
