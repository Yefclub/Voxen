import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db } from '../lib/db';
import { keepCurrentOwnedSources } from './mcp-brain-source-lifecycle';

describe.skipIf(!process.env.DATABASE_URL)('MCP Brain source lifecycle', () => {
  const suffix = crypto.randomUUID().replaceAll('-', '');
  const ownerId = `mcp-source-owner-${suffix}`;
  const foreignId = `mcp-source-foreign-${suffix}`;
  const activeId = `mcp-source-active-${suffix}`;
  const archivedId = `mcp-source-archived-${suffix}`;
  const foreignTranscriptId = `mcp-source-other-${suffix}`;

  beforeAll(async () => {
    await db.user.createMany({
      data: [
        { id: ownerId, email: `${ownerId}@example.test`, name: 'Owner', status: 'APPROVED' },
        { id: foreignId, email: `${foreignId}@example.test`, name: 'Foreign', status: 'APPROVED' },
      ],
    });
    for (const [id, userId, status] of [
      [activeId, ownerId, 'ACTIVE'],
      [archivedId, ownerId, 'ARCHIVED'],
      [foreignTranscriptId, foreignId, 'ACTIVE'],
    ] as const) {
      await db.transcript.create({
        data: {
          id,
          userId,
          status,
          source: 'WEB',
          url: `https://example.test/${id}`,
          title: id,
          durationSec: 0,
          language: 'en',
          transcriptionMethod: 'SCRAPE',
          mdPath: `${id}.md`,
          plainText: id,
          frontmatter: {},
        },
      });
    }
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: [ownerId, foreignId] } } });
    await db.$disconnect();
  });

  test('keeps non-transcript evidence plus active owned transcripts only', async () => {
    const sources = await keepCurrentOwnedSources(ownerId, [
      { sourceType: 'TRANSCRIPT' as const, sourceId: activeId, marker: 'active' },
      { sourceType: 'TRANSCRIPT' as const, sourceId: archivedId, marker: 'archived' },
      { sourceType: 'TRANSCRIPT' as const, sourceId: foreignTranscriptId, marker: 'foreign' },
      { sourceType: 'NOTE' as const, sourceId: 'owned-note', marker: 'note' },
    ]);

    expect(sources.map((source) => source.marker)).toEqual(['active', 'note']);
  });
});
