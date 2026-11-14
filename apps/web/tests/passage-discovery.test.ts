import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { executePassageIndex } from '../src/lib/passage-index/runner';
import { searchPassages } from '../src/lib/passage-index/search';
import { discoverKnowledgeNames } from '../src/lib/passage-index/discovery';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const users: string[] = [];
suite('bounded typo-tolerant name discovery', () => {
  beforeAll(async () => {
    for (let i = 0; i < 2; i++)
      users.push(
        (
          await db.user.create({
            data: {
              email: `passage-discovery-${randomUUID()}@example.test`,
              name: 'Passage discovery',
              status: 'APPROVED',
            },
          })
        ).id,
      );
  });
  afterEach(async () => {
    await db.note.deleteMany({ where: { userId: { in: users } } });
    await db.brainNode.deleteMany({ where: { userId: { in: users } } });
    await db.transcript.deleteMany({ where: { userId: { in: users } } });
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: users } } });
  });
  async function note(title: string, userId = users[0]!) {
    const row = await db.note.create({
      data: { userId, title, content: 'A canonical passage about web extraction.' },
    });
    await executePassageIndex({ userId, type: 'note', id: row.id });
    return row;
  }
  test('finds a transposed title as a discovery lead without presenting it as verified evidence', async () => {
    const row = await note('Firecrawl MCP integration');
    const result = await searchPassages(users[0]!, { query: 'Firecrwal' });
    expect(result.results).toEqual([]);
    expect(result.discovery).toContainEqual(
      expect.objectContaining({
        id: row.id,
        kind: 'document',
        sourceType: 'note',
        name: row.title,
        verified: false,
      }),
    );
    expect(result.limitations).toEqual([]);
  });
  test('finds owned entity names, excludes archived source nodes and filters ownership before the bound', async () => {
    const entity = await db.brainNode.create({
      data: {
        userId: users[0]!,
        key: 'ENTITY:firecrawl',
        label: 'Firecrawl',
        type: 'ENTITY',
        sourceType: 'MANUAL',
      },
    });
    for (let i = 0; i < 8; i++)
      await db.brainNode.create({
        data: {
          userId: users[1]!,
          key: `ENTITY:foreign-${i}`,
          label: 'Firecrwal',
          type: 'ENTITY',
          sourceType: 'MANUAL',
        },
      });
    const parent = await db.transcript.create({
      data: {
        userId: users[0]!,
        title: 'Archived',
        status: 'ARCHIVED',
        source: 'WEB',
        url: 'https://example.test/source',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath: 'not-read.md',
        plainText: 'Body',
        frontmatter: {},
      },
    });
    await db.brainNode.create({
      data: {
        userId: users[0]!,
        key: 'ENTITY:archived',
        label: 'Firecrwal',
        type: 'ENTITY',
        sourceType: 'TRANSCRIPT',
        sourceId: parent.id,
      },
    });
    const found = await discoverKnowledgeNames(users[0]!, 'Firecrwal', {}, 1);
    expect(found.matches.map((p) => p.id)).toEqual([entity.id]);
    expect(found.matches[0]).toMatchObject({ kind: 'entity', verified: false });
  });
  test('never treats punctuation-distinct identifiers or short queries as typo matches', async () => {
    await note('C++ language');
    for (const query of ['C#', 'C++', 'ab', '12345', 'AWS-MCP-123'])
      expect((await discoverKnowledgeNames(users[0]!, query)).matches).toEqual([]);
  });
  test('respects document scopes and keeps deterministic order without widening to entities', async () => {
    await note('Firecrwal unrelated match');
    const target = await note('Firecrawl MCP integration');
    await db.brainNode.create({
      data: {
        userId: users[0]!,
        key: 'ENTITY:another',
        label: 'Firecrwal',
        type: 'ENTITY',
        sourceType: 'MANUAL',
      },
    });
    const scope = { sourceTypes: ['note'], sourceIds: [target.id] };
    const first = await discoverKnowledgeNames(users[0]!, 'Firecrwal', scope);
    expect(first.matches.map((p) => p.id)).toEqual([target.id]);
    expect(await discoverKnowledgeNames(users[0]!, 'Firecrwal', scope)).toEqual(first);
  });
  test('reports discovery unavailability without fabricating names or evidence', async () => {
    await db.$executeRawUnsafe(
      'ALTER TABLE "BrainNode" RENAME TO "BrainNode_discovery_unavailable"',
    );
    try {
      expect(await discoverKnowledgeNames(users[0]!, 'Firecrwal')).toEqual({
        matches: [],
        unavailable: true,
      });
    } finally {
      await db.$executeRawUnsafe(
        'ALTER TABLE "BrainNode_discovery_unavailable" RENAME TO "BrainNode"',
      );
    }
  });
});
