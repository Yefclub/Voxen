import { expect, test } from '@playwright/test';
import { db } from '../src/lib/db';
import { setSetting } from '../src/lib/settings';

test('explores grounded transcript knowledge and connected library content', async ({
  page,
}, testInfo) => {
  test.skip(process.env.VOXEN_E2E !== '1', 'Run against an isolated Voxen test database.');

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `transcript-graph-${suffix}@voxen.local`;
  const password = 'safe-transcript-graph-e2e-password-123';
  const signup = await page.request.post('/api/auth/sign-up/email', {
    data: { email, password, name: 'Transcript Graph E2E' },
  });
  expect(signup.ok()).toBeTruthy();
  const user = await db.user.update({ where: { email }, data: { status: 'APPROVED' } });

  try {
    await setSetting('openrouter_api_key', 'sk-test-not-real');
    await setSetting('onboarding_done', 'true');
    const signin = await page.request.post('/api/auth/sign-in/email', {
      data: { email, password },
    });
    expect(signin.ok()).toBeTruthy();

    const transcript = await db.transcript.create({
      data: {
        userId: user.id,
        source: 'YOUTUBE',
        url: 'https://example.test/local-graph',
        title: 'Grounded graph source',
        durationSec: 60,
        language: 'en',
        transcriptionMethod: 'SUBTITLES',
        mdPath: `tests/missing-${suffix}.md`,
        plainText: '[00:00:15] A grounded topic appears in this source.',
        frontmatter: {},
        summaryMd: 'A source used to validate its local knowledge graph.',
      },
    });
    const connected = await db.transcript.create({
      data: {
        userId: user.id,
        source: 'WEB',
        url: 'https://example.test/connected',
        title: 'Connected library source',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath: `tests/missing-connected-${suffix}.md`,
        plainText: 'Related knowledge from another source.',
        frontmatter: {},
      },
    });
    const [focus, topic, connectedNode] = await Promise.all([
      db.brainNode.create({
        data: {
          userId: user.id,
          key: `TRANSCRIPT:${transcript.id}`,
          type: 'CONTENT',
          label: transcript.title,
          description: transcript.summaryMd,
          sourceType: 'TRANSCRIPT',
          sourceId: transcript.id,
          metadata: { source: 'YOUTUBE' },
        },
      }),
      db.brainNode.create({
        data: {
          userId: user.id,
          key: `TOPIC:${suffix}`,
          type: 'TOPIC',
          label: 'Grounded topic',
          description: 'A concept with exact evidence in this transcript.',
        },
      }),
      db.brainNode.create({
        data: {
          userId: user.id,
          key: `TRANSCRIPT:${connected.id}`,
          type: 'CONTENT',
          label: connected.title,
          sourceType: 'TRANSCRIPT',
          sourceId: connected.id,
          metadata: { source: 'WEB' },
        },
      }),
    ]);
    const [mention, relation] = await Promise.all([
      db.brainEdge.create({
        data: {
          userId: user.id,
          fromNodeId: focus.id,
          toNodeId: topic.id,
          kind: 'MENTIONS',
          method: 'llm-grounded',
          confidence: 0.94,
        },
      }),
      db.brainEdge.create({
        data: {
          userId: user.id,
          fromNodeId: focus.id,
          toNodeId: connectedNode.id,
          kind: 'RELATED_TO',
          method: 'shared-concepts',
          confidence: 0.72,
        },
      }),
    ]);
    await Promise.all([
      db.brainSource.create({
        data: {
          userId: user.id,
          nodeId: topic.id,
          sourceType: 'TRANSCRIPT',
          sourceId: transcript.id,
          startLine: 1,
          endLine: 1,
          startSec: 15,
          endSec: 20,
          excerpt: 'A grounded topic appears in this source.',
        },
      }),
      db.brainSource.create({
        data: {
          userId: user.id,
          edgeId: mention.id,
          sourceType: 'TRANSCRIPT',
          sourceId: transcript.id,
          excerpt: 'The source mentions the grounded topic.',
        },
      }),
      db.brainSource.create({
        data: {
          userId: user.id,
          edgeId: relation.id,
          sourceType: 'TRANSCRIPT',
          sourceId: transcript.id,
          excerpt: 'Both sources share a grounded concept.',
        },
      }),
      db.brainCompilation.create({
        data: {
          userId: user.id,
          transcriptId: transcript.id,
          contentHash: `hash-${suffix}`,
          status: 'COMPLETED',
          totalSegments: 1,
          completedSegments: 1,
        },
      }),
    ]);

    await page.goto(`/transcricoes/${transcript.id}`);
    const graph = page.getByTestId('transcript-knowledge-graph');
    await expect(graph.getByText('Grafo deste conteúdo')).toBeVisible();
    await expect(
      graph.getByRole('img', { name: 'Mapa local de conhecimento da transcrição' }),
    ).toBeVisible();
    await expect(graph.getByRole('button', { name: 'Grounded topic — topic' })).toBeVisible();
    await expect(
      graph.getByRole('button', { name: 'Connected library source — transcript' }),
    ).toHaveCount(0);
    await graph.getByRole('button', { name: 'Grounded topic — topic' }).click();
    await expect(graph.getByText('A grounded topic appears in this source.')).toBeVisible();
    await graph.getByRole('button', { name: 'Ir para a passagem' }).click();
    await expect(page).toHaveURL(/#l=1-1$/);
    await page.screenshot({
      path: testInfo.outputPath('transcript-local-graph-content.png'),
      fullPage: true,
    });

    await graph.getByRole('button', { name: 'Conexões com a base' }).click();
    await expect(
      graph.getByRole('button', { name: 'Connected library source — transcript' }),
    ).toBeVisible();
    const globalLink = graph.getByRole('link', { name: 'Abrir no grafo completo' });
    await expect(globalLink).toHaveAttribute('href', `/grafo?focus=${focus.id}`);
    await page.screenshot({
      path: testInfo.outputPath('transcript-local-graph-connections.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(graph.getByText('Grafo deste conteúdo')).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('transcript-local-graph-mobile.png'),
      fullPage: true,
    });
  } finally {
    await db.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
});
