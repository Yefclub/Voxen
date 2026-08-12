import { describe, expect, mock, test } from 'bun:test';
import { Prisma } from '../../prisma-generated/client';
import { db } from './db';
import { normalizeEntityAlias, queryBrainTimeline } from './brain-temporal';

describe('Brain temporal retrieval', () => {
  test('normalizes aliases consistently without leaking punctuation', () => {
    expect(normalizeEntityAlias('  Estúdio Ghibli™ ')).toBe('estudio-ghibli');
  });

  test('rejects reversed ranges before querying storage', async () => {
    const client = { $queryRaw: mock() };
    await expect(
      queryBrainTimeline(
        'user-1',
        { from: '2026-02-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
        client,
      ),
    ).rejects.toThrow('to must be later than from');
    expect(client.$queryRaw).not.toHaveBeenCalled();
  });

  test('serializes temporal rows and binds workspace plus alias scope', async () => {
    const queryRaw = mock(async (_query: Prisma.Sql) => [
      {
        id: 'fact-1',
        factKey: 'key-1',
        predicate: 'created',
        kind: 'RELATED_TO',
        confidence: new Prisma.Decimal('0.91'),
        method: 'llm-grounded-temporal',
        validFrom: new Date('2024-01-01T00:00:00Z'),
        validTo: null,
        observedAt: new Date('2026-01-01T00:00:00Z'),
        invalidatedAt: null,
        subjectId: 'entity-1',
        subjectKey: 'ENTITY:organization:openai',
        subjectLabel: 'OpenAI',
        subjectType: 'ENTITY',
        objectId: 'entity-2',
        objectKey: 'ENTITY:product:chatgpt',
        objectLabel: 'ChatGPT',
        objectType: 'ENTITY',
        sources: [{ sourceId: 'transcript-1', excerpt: 'OpenAI created ChatGPT' }],
      },
    ]);

    const result = await queryBrainTimeline(
      'user-1',
      { entityRef: 'Open AI', asOf: '2025-01-01T00:00:00Z' },
      { $queryRaw: queryRaw } as never,
    );

    const sql = queryRaw.mock.calls[0]?.[0] as Prisma.Sql;
    expect(sql.values).toContain('user-1');
    expect(sql.values).toContain('open-ai');
    expect(result[0]).toMatchObject({
      validFrom: '2024-01-01T00:00:00.000Z',
      observedAt: '2026-01-01T00:00:00.000Z',
      subject: { label: 'OpenAI' },
    });
  });
});

describe.skipIf(!process.env.DATABASE_URL)('Brain temporal retrieval (PostgreSQL)', () => {
  test('enforces owner, active source, alias, and point-in-time validity in SQL', async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '');
    const ownerId = `temporal-owner-${suffix}`;
    const foreignId = `temporal-foreign-${suffix}`;
    const ownerTranscript = `temporal-transcript-${suffix}`;
    const archivedTranscript = `temporal-archived-${suffix}`;
    await db.user.createMany({
      data: [
        { id: ownerId, email: `${ownerId}@example.test`, name: 'Owner', status: 'APPROVED' },
        { id: foreignId, email: `${foreignId}@example.test`, name: 'Foreign', status: 'APPROVED' },
      ],
    });
    try {
      for (const [id, status] of [
        [ownerTranscript, 'ACTIVE'],
        [archivedTranscript, 'ARCHIVED'],
      ] as const) {
        await db.transcript.create({
          data: {
            id,
            userId: ownerId,
            status,
            source: 'WEB',
            url: `https://example.test/${id}`,
            title: id,
            durationSec: 0,
            language: 'en',
            transcriptionMethod: 'SCRAPE',
            mdPath: `${id}.md`,
            plainText: 'Temporal evidence',
            frontmatter: {},
          },
        });
      }
      const subject = await db.brainNode.create({
        data: { userId: ownerId, key: `ENTITY:person:ana:${suffix}`, type: 'ENTITY', label: 'Ana' },
      });
      const object = await db.brainNode.create({
        data: {
          userId: ownerId,
          key: `ENTITY:organization:acme:${suffix}`,
          type: 'ENTITY',
          label: 'Acme',
        },
      });
      const edge = await db.brainEdge.create({
        data: {
          userId: ownerId,
          fromNodeId: subject.id,
          toNodeId: object.id,
          kind: 'RELATED_TO',
          method: 'llm-grounded-relation',
        },
      });
      await db.brainEntityAlias.create({
        data: {
          userId: ownerId,
          entityNodeId: subject.id,
          alias: 'Ana Maria',
          normalizedAlias: 'ana-maria',
          entityType: 'PERSON',
          sourceType: 'TRANSCRIPT',
          sourceId: ownerTranscript,
          evidenceKey: `alias:${suffix}`,
        },
      });
      for (const [sourceId, key] of [
        [ownerTranscript, 'active'],
        [archivedTranscript, 'archived'],
      ] as const) {
        const fact = await db.brainFact.create({
          data: {
            userId: ownerId,
            edgeId: edge.id,
            factKey: `${key}:${suffix}`,
            predicate: 'worked_at',
            validFrom: new Date('2020-01-01T00:00:00Z'),
            validTo: new Date('2022-01-01T00:00:00Z'),
            observedAt: new Date('2026-01-01T00:00:00Z'),
            method: 'llm-grounded-temporal',
          },
        });
        await db.brainSource.create({
          data: {
            userId: ownerId,
            edgeId: edge.id,
            factId: fact.id,
            sourceType: 'TRANSCRIPT',
            sourceId,
            evidenceKey: `source:${key}:${suffix}`,
            excerpt: 'Ana worked at Acme',
          },
        });
      }
      const futureFact = await db.brainFact.create({
        data: {
          userId: ownerId,
          edgeId: edge.id,
          factKey: `future:${suffix}`,
          predicate: 'will_work_at',
          validFrom: new Date('2999-01-01T00:00:00Z'),
          observedAt: new Date('2026-01-01T00:00:00Z'),
          method: 'llm-grounded-temporal',
        },
      });
      await db.brainSource.create({
        data: {
          userId: ownerId,
          edgeId: edge.id,
          factId: futureFact.id,
          sourceType: 'TRANSCRIPT',
          sourceId: ownerTranscript,
          evidenceKey: `source:future:${suffix}`,
          excerpt: 'Ana will work at Acme',
        },
      });

      const results = await queryBrainTimeline(ownerId, {
        entityRef: 'Ana Maria',
        asOf: '2021-01-01T00:00:00Z',
      });
      const current = await queryBrainTimeline(ownerId, { entityRef: 'Ana Maria' });
      const foreign = await queryBrainTimeline(foreignId, {
        entityRef: 'Ana Maria',
        asOf: '2021-01-01T00:00:00Z',
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.sources).toEqual([
        expect.objectContaining({ sourceId: ownerTranscript, excerpt: 'Ana worked at Acme' }),
      ]);
      expect(current).toEqual([]);
      expect(foreign).toEqual([]);
    } finally {
      await db.user.deleteMany({ where: { id: { in: [ownerId, foreignId] } } });
    }
  });
});
