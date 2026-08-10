import { expect, test } from '@playwright/test';
import { db } from '../src/lib/db';
import { setSetting } from '../src/lib/settings';

test('preserves a stale draft and restores an immutable note revision', async ({
  page,
}, testInfo) => {
  test.skip(process.env.VOXEN_E2E !== '1', 'Run against an isolated Voxen test database.');

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `note-e2e-${suffix}@voxen.local`;
  const password = 'safe-note-e2e-password-123';
  const signup = await page.request.post('/api/auth/sign-up/email', {
    data: { email, password, name: 'Note E2E' },
  });
  expect(signup.ok()).toBeTruthy();
  await db.user.update({ where: { email }, data: { status: 'APPROVED' } });
  await setSetting('onboarding_done', 'true');
  const signin = await page.request.post('/api/auth/sign-in/email', {
    data: { email, password },
  });
  expect(signin.ok()).toBeTruthy();
  const create = await page.request.post('/api/notes', {
    data: { kind: 'NOTE', title: 'Playwright revision', content: 'Original body' },
  });
  expect(create.status()).toBe(201);
  const created = (await create.json()) as { note: { id: string; revision: number } };
  expect(created.note.revision).toBe(1);

  await page.goto(`/notas/${created.note.id}`);
  await expect(page.getByText('Rev. 1', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('note-revision-before.png'), fullPage: true });

  const external = await page.request.patch(`/api/notes/${created.note.id}`, {
    data: { expectedRevision: 1, content: 'Changed by another surface' },
  });
  expect(external.ok()).toBeTruthy();

  await page.getByRole('button', { name: 'Editar' }).click();
  const title = page.locator('[data-note-editor-toolbar] input');
  await title.fill('Local stale draft');
  await page.getByRole('button', { name: 'Salvar' }).click();
  const conflict = page.locator('[data-note-revision-conflict]');
  await expect(conflict).toBeVisible();
  await expect(title).toHaveValue('Local stale draft');
  await page.screenshot({
    path: testInfo.outputPath('note-revision-conflict.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Carregar versão atual' }).click();
  await expect(page.getByText('Rev. 2', { exact: true })).toBeVisible();
  await expect(title).toHaveValue('Playwright revision');

  await page.getByRole('button', { name: 'Histórico' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: /Rev\. 1/ }).click();
  await expect(page.getByText('Original body')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('note-revision-history.png'), fullPage: true });
  await page.getByRole('button', { name: 'Restaurar revisão' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('Rev. 3', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Histórico' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const overflow = await dialog.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('note-revision-mobile.png'), fullPage: true });
});
