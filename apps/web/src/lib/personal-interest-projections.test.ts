import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db } from './db';
import {
  calculateInterestProjections,
  getPersonalInterestProjections,
  normalizeFeatureKey,
  rebuildPersonalInterestProjections,
  type InterestProjectionFeature,
} from './personal-interest-projections';

describe('personal interest projection scoring', () => {
  const now = new Date('2026-08-11T12:00:00.000Z');
  const feature: InterestProjectionFeature = {
    dimension: 'TOPIC',
    key: 'topic:knowledge-graphs',
    label: 'Knowledge graphs',
    relevance: 1,
    brainNodeId: 'topic-node',
  };

  test('uses distinct decay horizons without blending explicit and inferred scores', () => {
    const projections = calculateInterestProjections({
      now,
      eventWatermark: now,
      featuresByTranscript: new Map([
        ['recent', [feature]],
        ['older', [feature]],
        ['explicit', [feature]],
      ]),
      events: [
        {
          transcriptId: 'recent',
          origin: 'OBSERVED',
          kind: 'TRANSCRIPT_VIEWED',
          signal: 0,
          occurredAt: new Date('2026-08-10T12:00:00.000Z'),
        },
        {
          transcriptId: 'older',
          origin: 'OBSERVED',
          kind: 'TRANSCRIPT_VIEWED',
          signal: 0,
          occurredAt: new Date('2026-07-12T12:00:00.000Z'),
        },
        {
          transcriptId: 'explicit',
          origin: 'EXPLICIT',
          kind: 'PREFERENCE_LESS',
          signal: -1,
          occurredAt: new Date('2025-01-01T00:00:00.000Z'),
        },
      ],
    });

    const short = projections[0]!.items[0]!;
    const medium = projections[1]!.items[0]!;
    const long = projections[2]!.items[0]!;
    expect(projections.map((projection) => projection.eventCount)).toEqual([2, 3, 3]);
    expect(short.explicitScore).toBe(-1);
    expect(short.inferredScore).toBeGreaterThan(0);
    expect(short.score).toBeLessThan(0);
    expect(medium.inferredScore).toBeGreaterThan(short.inferredScore);
    expect(long.inferredScore).toBeGreaterThan(medium.inferredScore);
    expect(long.brainNodeId).toBe('topic-node');
  });

  test('treats a cleared explicit state as neutral instead of inferred dislike', () => {
    const [short] = calculateInterestProjections({
      now,
      featuresByTranscript: new Map([['cleared', [feature]]]),
      events: [
        {
          transcriptId: 'cleared',
          origin: 'EXPLICIT',
          kind: 'PREFERENCE_CLEARED',
          signal: 0,
          occurredAt: now,
        },
      ],
    });
    expect(short!.items).toEqual([]);
  });

  test('normalizes personal metadata into stable keys', () => {
    expect(normalizeFeatureKey('  João da Silva / IA  ')).toBe('joao-da-silva-ia');
    expect(normalizeFeatureKey('知識グラフ')).toBe('知識グラフ');
  });
});

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('materialized personal interest projections', () => {
  let ownerId = '';
  let foreignId = '';
  let activeId = '';
  let archivedId = '';
  let trashedId = '';
  let topicNodeId = '';
  const now = new Date('2026-08-11T12:00:00.000Z');

  beforeAll(async () => {
    const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const [owner, foreign] = await Promise.all([
      db.user.create({
        data: {
          email: `projection-owner-${suffix}@voxen.local`,
          name: 'Projection owner',
          status: 'APPROVED',
        },
      }),
      db.user.create({
        data: {
          email: `projection-foreign-${suffix}@voxen.local`,
          name: 'Projection foreign',
          status: 'APPROVED',
        },
      }),
    ]);
    ownerId = owner.id;
    foreignId = foreign.id;
    const [folder, tag, foreignFolder, foreignTag] = await Promise.all([
      db.libraryFolder.create({ data: { userId: ownerId, name: 'Graph research' } }),
      db.tag.create({ data: { userId: ownerId, name: 'Graph RAG', slug: 'graph-rag' } }),
      db.libraryFolder.create({ data: { userId: foreignId, name: 'Foreign private folder' } }),
      db.tag.create({
        data: { userId: foreignId, name: 'Foreign private tag', slug: 'foreign-private-tag' },
      }),
    ]);
    const createTranscript = (input: {
      title: string;
      author: string;
      status?: 'ACTIVE' | 'ARCHIVED' | 'TRASH';
      folderId?: string;
    }) =>
      db.transcript.create({
        data: {
          userId: ownerId,
          folderId: input.folderId ?? folder.id,
          status: input.status ?? 'ACTIVE',
          source: 'YOUTUBE',
          url: `https://example.test/${suffix}/${encodeURIComponent(input.title)}`,
          title: input.title,
          author: input.author,
          channel: `${input.author} channel`,
          durationSec: 120,
          language: 'en',
          transcriptionMethod: 'SUBTITLES',
          mdPath: `tests/${suffix}/${input.title}.md`,
          plainText: input.title,
          frontmatter: {},
          ...(input.status === 'ARCHIVED' ? { archivedAt: now } : {}),
          ...(input.status === 'TRASH' ? { trashedAt: now } : {}),
          tags: { create: { tagId: tag.id } },
        },
      });
    const [active, archived, trashed, corruptRelations] = await Promise.all([
      createTranscript({ title: 'Active graph study', author: 'Active Author' }),
      createTranscript({
        title: 'Archived graph study',
        author: 'Archived Author',
        status: 'ARCHIVED',
      }),
      createTranscript({ title: 'Trashed graph study', author: 'Trashed Author', status: 'TRASH' }),
      createTranscript({
        title: 'Corrupt relation study',
        author: 'Owned Author',
        folderId: foreignFolder.id,
      }),
    ]);
    activeId = active.id;
    archivedId = archived.id;
    trashedId = trashed.id;
    await db.transcriptTag.create({
      data: { transcriptId: active.id, tagId: foreignTag.id },
    });
    const [contentNode, topicNode, foreignTopicNode] = await Promise.all([
      db.brainNode.create({
        data: {
          userId: ownerId,
          key: `transcript:${active.id}`,
          type: 'CONTENT',
          label: active.title,
          sourceType: 'TRANSCRIPT',
          sourceId: active.id,
        },
      }),
      db.brainNode.create({
        data: {
          userId: ownerId,
          key: `topic:${suffix}:knowledge-graphs`,
          type: 'TOPIC',
          label: 'Knowledge graphs',
        },
      }),
      db.brainNode.create({
        data: {
          userId: foreignId,
          key: `topic:${suffix}:foreign-private`,
          type: 'TOPIC',
          label: 'Foreign private topic',
        },
      }),
    ]);
    topicNodeId = topicNode.id;
    await db.brainEdge.create({
      data: {
        userId: ownerId,
        fromNodeId: contentNode.id,
        toNodeId: topicNode.id,
        kind: 'MENTIONS',
        confidence: 0.9,
        method: 'llm-grounded',
      },
    });
    await db.brainEdge.create({
      data: {
        userId: ownerId,
        fromNodeId: contentNode.id,
        toNodeId: foreignTopicNode.id,
        kind: 'MENTIONS',
        confidence: 1,
        method: 'corrupt-cross-user-test',
      },
    });
    await db.interestEvent.createMany({
      data: [
        {
          userId: ownerId,
          transcriptId: activeId,
          origin: 'OBSERVED',
          kind: 'TRANSCRIPT_VIEWED',
          signal: 0,
          dedupeKey: `projection:${suffix}:view`,
          occurredAt: new Date('2026-08-10T12:00:00.000Z'),
        },
        {
          userId: ownerId,
          transcriptId: activeId,
          origin: 'EXPLICIT',
          kind: 'PREFERENCE_MORE',
          signal: 1,
          occurredAt: new Date('2026-08-09T12:00:00.000Z'),
        },
        {
          userId: ownerId,
          transcriptId: activeId,
          origin: 'EXPLICIT',
          kind: 'PREFERENCE_LESS',
          signal: -1,
          occurredAt: new Date('2026-08-10T13:00:00.000Z'),
        },
        {
          userId: ownerId,
          transcriptId: archivedId,
          origin: 'EXPLICIT',
          kind: 'PREFERENCE_MORE',
          signal: 1,
          occurredAt: new Date('2026-08-10T14:00:00.000Z'),
        },
        {
          userId: ownerId,
          transcriptId: trashedId,
          origin: 'EXPLICIT',
          kind: 'PREFERENCE_MORE',
          signal: 1,
          occurredAt: new Date('2026-08-10T15:00:00.000Z'),
        },
        {
          userId: ownerId,
          transcriptId: corruptRelations.id,
          origin: 'OBSERVED',
          kind: 'TRANSCRIPT_VIEWED',
          signal: 0,
          dedupeKey: `projection:${suffix}:corrupt-relations`,
          occurredAt: new Date('2026-08-10T16:00:00.000Z'),
        },
      ],
    });
  });

  afterAll(async () => {
    if (ownerId) await db.user.delete({ where: { id: ownerId } }).catch(() => undefined);
    if (foreignId) await db.user.delete({ where: { id: foreignId } }).catch(() => undefined);
    await db.$disconnect();
  });

  test('materializes explainable features from durable and graph metadata', async () => {
    const projections = await rebuildPersonalInterestProjections(ownerId, now);
    expect(projections).toHaveLength(3);
    const short = projections.find((projection) => projection.horizon === 'SHORT')!;
    const activeAuthor = short.items.find(
      (item) => item.dimension === 'AUTHOR' && item.key === 'active-author',
    );
    const archivedAuthor = short.items.find(
      (item) => item.dimension === 'AUTHOR' && item.key === 'archived-author',
    );
    const topic = short.items.find((item) => item.brainNodeId === topicNodeId);
    expect(activeAuthor).toMatchObject({ explicitScore: -1 });
    expect(activeAuthor!.inferredScore).toBeGreaterThan(0);
    expect(activeAuthor!.score).toBeLessThan(0);
    expect(archivedAuthor).toMatchObject({ explicitScore: 1, inferredScore: 0 });
    expect(topic).toMatchObject({ dimension: 'TOPIC', explicitScore: -1 });
    expect(short.items.some((item) => item.key === 'trashed-author')).toBe(false);
    expect(short.items.some((item) => item.dimension === 'TAG' && item.key === 'graph-rag')).toBe(
      true,
    );
    expect(
      short.items.some((item) =>
        ['Foreign private folder', 'Foreign private tag', 'Foreign private topic'].includes(
          item.label,
        ),
      ),
    ).toBe(false);
    expect(await db.interestProjection.count({ where: { userId: ownerId } })).toBe(3);
    expect(await db.interestProjection.count({ where: { userId: foreignId } })).toBe(0);
  });

  test('rebuilds snapshots when a newer event advances the watermark', async () => {
    const eventAt = new Date('2026-08-11T13:00:00.000Z');
    await db.interestEvent.create({
      data: {
        userId: ownerId,
        transcriptId: activeId,
        origin: 'OBSERVED',
        kind: 'TRANSCRIPT_VIEWED',
        signal: 0,
        dedupeKey: `projection:fresh:${activeId}`,
        occurredAt: eventAt,
      },
    });
    const projections = await getPersonalInterestProjections({
      userId: ownerId,
      now: new Date('2026-08-11T13:01:00.000Z'),
    });
    expect(
      projections.every((projection) => projection.eventWatermark === eventAt.toISOString()),
    ).toBe(true);
  });

  test('cascades materialized projections with their owner', async () => {
    const suffix = crypto.randomUUID();
    const disposable = await db.user.create({
      data: {
        email: `projection-disposable-${suffix}@voxen.local`,
        name: 'Disposable projection owner',
        status: 'APPROVED',
      },
    });
    await rebuildPersonalInterestProjections(disposable.id, now);
    expect(await db.interestProjection.count({ where: { userId: disposable.id } })).toBe(3);
    await db.user.delete({ where: { id: disposable.id } });
    expect(await db.interestProjection.count({ where: { userId: disposable.id } })).toBe(0);
  });

  test('does not let an older rebuild overwrite a newer snapshot', async () => {
    const suffix = crypto.randomUUID();
    const disposable = await db.user.create({
      data: {
        email: `projection-concurrency-${suffix}@voxen.local`,
        name: 'Concurrent projection owner',
        status: 'APPROVED',
      },
    });
    const newerNow = new Date('2026-08-11T14:00:00.000Z');
    const olderNow = new Date('2026-08-11T13:00:00.000Z');
    await rebuildPersonalInterestProjections(disposable.id, newerNow);
    const result = await rebuildPersonalInterestProjections(disposable.id, olderNow);
    expect(result.every((projection) => projection.computedAt === newerNow.toISOString())).toBe(
      true,
    );
    await db.user.delete({ where: { id: disposable.id } });
  });
});
