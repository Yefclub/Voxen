import { expect, test } from '@playwright/test';
import { db } from '../src/lib/db';
import { setSetting } from '../src/lib/settings';
import { storagePut } from '../src/lib/storage';

test('records a personal transcript preference with accessible reversible feedback', async ({
  page,
}, testInfo) => {
  test.skip(process.env.VOXEN_E2E !== '1', 'Run against an isolated Voxen test database.');

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `transcript-interest-${suffix}@voxen.local`;
  const password = 'safe-transcript-interest-e2e-password-123';
  const signup = await page.request.post('/api/auth/sign-up/email', {
    data: { email, password, name: 'Transcript Interest E2E' },
  });
  expect(signup.ok()).toBeTruthy();
  const user = await db.user.update({ where: { email }, data: { status: 'APPROVED' } });

  try {
    await setSetting('onboarding_done', 'true');
    const signin = await page.request.post('/api/auth/sign-in/email', {
      data: { email, password },
    });
    expect(signin.ok()).toBeTruthy();

    await storagePut({
      key: `tests/missing-${suffix}.md`,
      body: '# Personal interest source\n\n[00:00:10] A source used to validate explicit preference feedback.\n',
      contentType: 'text/markdown',
    });

    const transcript = await db.transcript.create({
      data: {
        userId: user.id,
        source: 'YOUTUBE',
        url: 'https://example.test/personal-interest',
        title: 'Personal interest source',
        durationSec: 60,
        language: 'en',
        transcriptionMethod: 'SUBTITLES',
        mdPath: `tests/missing-${suffix}.md`,
        plainText: '[00:00:10] A source used to validate explicit preference feedback.',
        frontmatter: {},
        summaryMd: 'A source used to validate explicit preference feedback.',
      },
    });

    let releaseInitialInterest: (() => void) | undefined;
    const initialInterestGate = new Promise<void>((resolve) => {
      releaseInitialInterest = resolve;
    });
    const interestEndpoint = `**/api/transcripts/${transcript.id}/interest`;
    await page.route(interestEndpoint, async (route) => {
      if (route.request().method() === 'GET') await initialInterestGate;
      await route.continue();
    });

    await page.goto(`/transcricoes/${transcript.id}`);
    const feedback = page.getByTestId('transcript-interest-feedback');
    const more = feedback.getByRole('button', { name: /Mais como isto/ });
    const less = feedback.getByRole('button', { name: /Menos como isto/ });
    await expect(feedback.getByText('Ajuste seu Guia')).toBeVisible();
    await expect(more).toBeDisabled();
    await expect(less).toBeDisabled();
    releaseInitialInterest?.();
    await expect(more).toBeEnabled();
    await expect(less).toBeEnabled();
    await page.unroute(interestEndpoint);
    await expect(more).toHaveAttribute('aria-pressed', 'false');
    await expect(less).toHaveAttribute('aria-pressed', 'false');

    let releaseSave: (() => void) | undefined;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    await page.route(interestEndpoint, async (route) => {
      if (route.request().method() === 'PUT') await saveGate;
      await route.continue();
    });
    await more.click();
    await expect(more).toBeDisabled();
    await expect(less).toBeDisabled();
    await feedback.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('transcript-interest-pending-desktop.png'),
      fullPage: true,
    });
    releaseSave?.();
    await expect(more).toHaveAttribute('aria-pressed', 'true');
    await page.unroute(interestEndpoint);
    await expect(feedback.getByText(/Preferência selecionada/)).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('transcript-interest-selected-desktop.png'),
      fullPage: true,
    });

    await page.reload();
    await expect(more).toHaveAttribute('aria-pressed', 'true');
    await more.click();
    await expect(more).toHaveAttribute('aria-pressed', 'false');
    await less.click();
    await expect(less).toHaveAttribute('aria-pressed', 'true');

    const events = await db.interestEvent.findMany({
      where: { userId: user.id, transcriptId: transcript.id },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { origin: true, kind: true },
    });
    expect(events.filter((event) => event.origin === 'OBSERVED')).toHaveLength(1);
    expect(
      events.filter((event) => event.origin === 'EXPLICIT').map((event) => event.kind),
    ).toEqual(['PREFERENCE_MORE', 'PREFERENCE_CLEARED', 'PREFERENCE_LESS']);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Opções do conteúdo', exact: true }).click();
    await feedback.scrollIntoViewIfNeeded();
    await expect(less).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('transcript-interest-selected-mobile.png'),
      fullPage: true,
    });

    await page.route(interestEndpoint, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"error":"down"}',
        });
        return;
      }
      await route.continue();
    });
    await page.reload();
    await page.getByRole('button', { name: 'Opções do conteúdo', exact: true }).click();
    await expect(feedback.getByText('Não foi possível carregar sua preferência.')).toBeVisible();
    await expect(feedback.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
    await feedback.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('transcript-interest-retry-mobile.png'),
      fullPage: true,
    });
  } finally {
    await db.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
});
