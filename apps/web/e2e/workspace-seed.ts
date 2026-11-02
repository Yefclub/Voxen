import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { db } from '../src/lib/db';
import { setSetting } from '../src/lib/settings';
import { storagePut } from '../src/lib/storage';

export interface WorkspaceSeed {
  userId: string;
  transcriptId: string;
  focusId: string;
  topicLabel: string;
  connectedLabel: string;
}

async function seedMarkdown(mdPath: string, title: string, body: string): Promise<void> {
  await storagePut({ key: mdPath, body: `# ${title}\n\n${body}\n`, contentType: 'text/markdown' });
}

export async function seedWorkspace(page: Page, tag: string): Promise<WorkspaceSeed> {
  const suffix = `${Date.now()}-${tag}-${Math.random().toString(16).slice(2)}`;
  const email = `workspace-matrix-${suffix}@voxen.local`;
  const password = 'safe-workspace-matrix-password-123';

  const signup = await page.request.post('/api/auth/sign-up/email', {
    data: { email, password, name: 'Workspace Matrix E2E' },
  });
  expect(signup.ok()).toBeTruthy();
  const user = await db.user.update({ where: { email }, data: { status: 'APPROVED' } });

  await setSetting('onboarding_done', 'true');
  const signin = await page.request.post('/api/auth/sign-in/email', {
    data: { email, password },
  });
  expect(signin.ok()).toBeTruthy();

  const topicLabel = 'Matrix grounded topic';
  const connectedLabel = 'Matrix connected source';
  const mdSource = `[00:00:15] ${topicLabel} appears in this source.`;
  await seedMarkdown(`tests/matrix-${suffix}.md`, 'Matrix source', mdSource);
  await seedMarkdown(
    `tests/matrix-connected-${suffix}.md`,
    'Matrix connected',
    'Related knowledge from another source.',
  );

  const transcript = await db.transcript.create({
    data: {
      userId: user.id,
      source: 'YOUTUBE',
      url: 'https://example.test/matrix',
      title: 'Matrix source',
      durationSec: 60,
      language: 'en',
      transcriptionMethod: 'SUBTITLES',
      mdPath: `tests/matrix-${suffix}.md`,
      plainText: mdSource,
      frontmatter: {},
      summaryMd: 'A source used to validate the rendered workspace matrix.',
    },
  });
  const connected = await db.transcript.create({
    data: {
      userId: user.id,
      source: 'WEB',
      url: 'https://example.test/matrix-connected',
      title: connectedLabel,
      durationSec: 0,
      language: 'en',
      transcriptionMethod: 'SCRAPE',
      mdPath: `tests/matrix-connected-${suffix}.md`,
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
        label: topicLabel,
        description: 'A concept with exact evidence in this transcript.',
      },
    }),
    db.brainNode.create({
      data: {
        userId: user.id,
        key: `TRANSCRIPT:${connected.id}`,
        type: 'CONTENT',
        label: connectedLabel,
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
        excerpt: `${topicLabel} appears in this source.`,
      },
    }),
    db.brainSource.create({
      data: {
        userId: user.id,
        edgeId: mention.id,
        sourceType: 'TRANSCRIPT',
        sourceId: transcript.id,
        excerpt: 'The source mentions the matrix topic.',
      },
    }),
    db.brainSource.create({
      data: {
        userId: user.id,
        edgeId: relation.id,
        sourceType: 'TRANSCRIPT',
        sourceId: transcript.id,
        excerpt: 'Both sources share a matrix concept.',
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

  return {
    userId: user.id,
    transcriptId: transcript.id,
    focusId: focus.id,
    topicLabel,
    connectedLabel,
  };
}

export async function cleanupWorkspace(userId: string): Promise<void> {
  await db.user.delete({ where: { id: userId } }).catch(() => undefined);
}
