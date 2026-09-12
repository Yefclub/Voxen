import { expect, test } from '@playwright/test';
import { db } from '../src/lib/db';
import { setSetting } from '../src/lib/settings';

test('zooms, pans, expands, and resets a Mermaid diagram safely', async ({ page }, testInfo) => {
  test.skip(process.env.VOXEN_E2E !== '1', 'Run against an isolated Voxen test database.');

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `mermaid-canvas-${suffix}@voxen.local`;
  const password = 'safe-mermaid-e2e-password-123';
  const signup = await page.request.post('/api/auth/sign-up/email', {
    data: { email, password, name: 'Mermaid Canvas E2E' },
  });
  expect(signup.ok()).toBeTruthy();
  await db.user.update({ where: { email }, data: { status: 'APPROVED' } });
  await setSetting('onboarding_done', 'true');
  const signin = await page.request.post('/api/auth/sign-in/email', {
    data: { email, password },
  });
  expect(signin.ok()).toBeTruthy();

  const create = await page.request.post('/api/notes', {
    data: {
      kind: 'NOTE',
      title: 'Interactive Mermaid canvas',
      content: [
        '# Processing flow',
        '',
        '```mermaid',
        'flowchart LR',
        '  Capture[Capture] --> Analyze[Analyze]',
        '  Analyze --> Graph[Knowledge graph]',
        '  Graph --> Search[Grounded search]',
        '```',
      ].join('\n'),
    },
  });
  expect(create.status()).toBe(201);
  const created = (await create.json()) as { note: { id: string } };

  await page.goto(`/notas/${created.note.id}`);
  const canvas = page.getByRole('img', { name: 'Diagrama Mermaid' });
  await expect(canvas).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aumentar zoom' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mermaid-canvas-before.png'), fullPage: true });

  await page.getByRole('button', { name: 'Aumentar zoom' }).click();
  await expect(page.getByText('125%', { exact: true })).toBeVisible();

  const modifiedWheel = await canvas.evaluate((element) => {
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -1,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(modifiedWheel).toBeTruthy();
  await expect(page.getByText('150%', { exact: true })).toBeVisible();

  const ordinaryWheel = await canvas.evaluate((element) => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 1 });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(ordinaryWheel).toBeFalsy();
  await expect(page.getByText('150%', { exact: true })).toBeVisible();

  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) throw new Error('Mermaid canvas has no layout bounds');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2 + 30);
  await page.mouse.up();
  const transform = await canvas.locator(':scope > div').getAttribute('style');
  expect(transform).toContain('translate3d(60px, 30px, 0px) scale(1.5)');

  await page.getByRole('button', { name: 'Expandir diagrama' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Diagrama Mermaid expandido' })).toBeAttached();
  await expect(dialog.getByRole('img', { name: 'Diagrama Mermaid' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mermaid-canvas-expanded.png') });

  const expandedCanvas = dialog.getByRole('img', { name: 'Diagrama Mermaid' });
  const expandedBounds = await expandedCanvas.boundingBox();
  expect(expandedBounds).not.toBeNull();
  if (!expandedBounds) throw new Error('Expanded Mermaid canvas has no layout bounds');
  await page.mouse.move(
    expandedBounds.x + expandedBounds.width / 2,
    expandedBounds.y + expandedBounds.height / 2,
  );
  await page.mouse.down();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.mouse.up();
  await expect(canvas).toHaveClass(/cursor-grab/);
  await expect(canvas).not.toHaveClass(/cursor-grabbing/);

  await canvas.focus();
  await page.keyboard.press('0');
  await expect(page.getByText('100%', { exact: true })).toBeVisible();
  await expect(canvas.locator(':scope > div')).toHaveAttribute(
    'style',
    /translate3d\(0px, 0px, 0px\) scale\(1\)/,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Expandir diagrama' }).click();
  await expect(dialog).toBeVisible();
  const overflow = await dialog.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('mermaid-canvas-mobile.png') });
});
