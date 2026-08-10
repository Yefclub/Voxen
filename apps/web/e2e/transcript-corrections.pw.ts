import { expect, test } from '@playwright/test';
import { db } from '../src/lib/db';
import { setSetting } from '../src/lib/settings';
import { storagePut } from '../src/lib/storage';

test('previews, conflicts, inspects, and restores transcript corrections', async ({
  page,
}, testInfo) => {
  test.skip(process.env.VOXEN_E2E !== '1', 'Run against an isolated Voxen test database.');

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `transcript-correction-${suffix}@voxen.local`;
  const password = 'safe-transcript-e2e-password-123';
  const signup = await page.request.post('/api/auth/sign-up/email', {
    data: { email, password, name: 'Transcript E2E' },
  });
  expect(signup.ok()).toBeTruthy();
  const user = await db.user.update({ where: { email }, data: { status: 'APPROVED' } });
  await setSetting('onboarding_done', 'true');
  const signin = await page.request.post('/api/auth/sign-in/email', {
    data: { email, password },
  });
  expect(signin.ok()).toBeTruthy();

  const baseMarkdown = [
    '---',
    'title: Correction E2E',
    '---',
    '',
    '# Transcript',
    '',
    '[00:00:01] wrong word in immutable evidence',
  ].join('\n');
  const mdPath = `workspaces/${user.id}/tests/${suffix}.md`;
  await storagePut({ key: mdPath, body: baseMarkdown, contentType: 'text/markdown' });
  const transcript = await db.transcript.create({
    data: {
      userId: user.id,
      source: 'YOUTUBE',
      url: 'https://example.test/correction-e2e',
      title: 'Correction E2E',
      durationSec: 3,
      language: 'en',
      transcriptionMethod: 'SUBTITLES',
      mdPath,
      plainText: 'wrong word in immutable evidence',
      frontmatter: {},
    },
  });

  await page.goto(`/transcricoes/${transcript.id}`);
  const card = page.locator('[data-transcript-corrections]');
  await expect(card.getByText('Correções da transcrição')).toBeVisible();
  await card.getByRole('button', { name: 'Corrigir' }).click();
  await card.getByPlaceholder('Trecho exato a localizar').fill('wrong word');
  await card.getByPlaceholder('Novo texto').fill('correct word');
  await card.getByRole('button', { name: 'Pré-visualizar' }).click();
  await expect(card.getByText(/Linha 7 · 1 ocorrência/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('transcript-correction-preview.png') });
  await card.getByRole('button', { name: 'Aplicar correção' }).click();
  await expect(card.getByText('Revisão 1')).toBeVisible();
  await expect(page.getByText('correct word in immutable evidence', { exact: true })).toBeVisible();

  await card.getByRole('button', { name: 'Ver original' }).click();
  await expect(card.getByText('wrong word in immutable evidence')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('transcript-correction-original.png') });
  await card.getByRole('button', { name: 'Ocultar original' }).click();

  const headResponse = await page.request.get(`/api/transcripts/${transcript.id}/corrections`);
  const head = (await headResponse.json()) as {
    head: {
      correctionRevision: number;
      sourceVersion: number;
      sourceChecksum: string | null;
      checksum: string;
    };
  };
  const externalPreview = await page.request.post(
    `/api/transcripts/${transcript.id}/corrections/preview`,
    {
      data: {
        expectedRevision: head.head.correctionRevision,
        expectedSourceVersion: head.head.sourceVersion,
        expectedSourceChecksum: head.head.sourceChecksum,
        operation: { kind: 'replace', target: 'correct word', text: 'external word' },
      },
    },
  );
  const preview = (await externalPreview.json()) as {
    baseChecksum: string;
    resultChecksum: string;
  };
  const externalApply = await page.request.post(
    `/api/transcripts/${transcript.id}/corrections/apply`,
    {
      data: {
        expectedRevision: head.head.correctionRevision,
        expectedSourceVersion: head.head.sourceVersion,
        expectedSourceChecksum: head.head.sourceChecksum,
        expectedBaseChecksum: preview.baseChecksum,
        expectedResultChecksum: preview.resultChecksum,
        operation: { kind: 'replace', target: 'correct word', text: 'external word' },
      },
    },
  );
  expect(externalApply.ok()).toBeTruthy();

  await card.getByPlaceholder('Trecho exato a localizar').fill('correct word');
  await card.getByPlaceholder('Novo texto').fill('local draft');
  await card.getByRole('button', { name: 'Pré-visualizar' }).click();
  await expect(card.getByPlaceholder('Novo texto')).toHaveValue('local draft');
  await page.screenshot({ path: testInfo.outputPath('transcript-correction-conflict.png') });

  await page.reload();
  const refreshedCard = page.locator('[data-transcript-corrections]');
  await refreshedCard.getByRole('button', { name: 'Histórico' }).click();
  await refreshedCard.getByRole('button', { name: 'Inspecionar' }).last().click();
  await expect(refreshedCard.getByText('correct word in immutable evidence')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('transcript-correction-history.png') });
  await refreshedCard.getByRole('button', { name: 'Restaurar' }).last().click();
  await expect(refreshedCard.getByText('Revisão 3')).toBeVisible();
  await expect(page.getByText('correct word in immutable evidence', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await refreshedCard.evaluate(
    (element) => element.scrollWidth - element.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath('transcript-correction-mobile.png'),
    fullPage: true,
  });
});
