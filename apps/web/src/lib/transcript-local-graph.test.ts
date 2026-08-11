import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db } from './db';
import {
  evidenceAnchor,
  parseTranscriptGraphHops,
  parseTranscriptGraphScope,
  transcriptGraphState,
  readTranscriptLocalGraph,
} from './transcript-local-graph';

describe('transcript local graph contract', () => {
  test('bounds view and hops to the supported local graph contract', () => {
    expect(parseTranscriptGraphScope('connections')).toBe('connections');
    expect(parseTranscriptGraphScope('unknown')).toBe('content');
    expect(parseTranscriptGraphHops('2')).toBe(2);
    expect(parseTranscriptGraphHops('20')).toBe(2);
    expect(parseTranscriptGraphHops('invalid')).toBe(1);
  });

  test('derives durable visual states without hiding legacy graph data', () => {
    expect(transcriptGraphState(null, false)).toBe('NOT_INDEXED');
    expect(transcriptGraphState(null, true)).toBe('READY');
    expect(transcriptGraphState('PENDING', true)).toBe('INDEXING');
    expect(transcriptGraphState('RUNNING', true)).toBe('INDEXING');
    expect(transcriptGraphState('RETRY', false)).toBe('INDEXING');
    expect(transcriptGraphState('PARTIAL', true)).toBe('PARTIAL');
    expect(transcriptGraphState('FAILED', true)).toBe('FAILED');
    expect(transcriptGraphState('COMPLETED', true)).toBe('READY');
    expect(transcriptGraphState('SKIPPED', true)).toBe('READY');
  });

  test('prefers line anchors and falls back to timestamp anchors', () => {
    expect(evidenceAnchor({ startLine: 8, endLine: 11, startSec: 30, endSec: 42 })).toBe('#l=8-11');
    expect(evidenceAnchor({ startLine: null, endLine: null, startSec: 30, endSec: 42 })).toBe(
      '#t=30-42',
    );
    expect(
      evidenceAnchor({ startLine: null, endLine: null, startSec: null, endSec: null }),
    ).toBeNull();
  });
});

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('transcript local graph persistence and isolation', () => {
  let ownerId = '';
  let foreignId = '';
  let transcriptId = '';
  let focusId = '';
  let topicId = '';
  let groundedEdgeId = '';

  beforeAll(async () => {
    const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const [owner, foreign] = await Promise.all([
      db.user.create({
        data: {
          email: `local-graph-owner-${suffix}@voxen.local`,
          name: 'Local graph owner',
          status: 'APPROVED',
        },
      }),
      db.user.create({
        data: {
          email: `local-graph-foreign-${suffix}@voxen.local`,
          name: 'Local graph foreign user',
          status: 'APPROVED',
        },
      }),
    ]);
    ownerId = owner.id;
    foreignId = foreign.id;
    const transcript = await db.transcript.create({
      data: {
        userId: ownerId,
        source: 'YOUTUBE',
        url: `https://example.test/${suffix}`,
        title: 'Grounded local graph',
        durationSec: 90,
        language: 'en',
        transcriptionMethod: 'SUBTITLES',
        mdPath: `tests/${suffix}.md`,
        plainText: 'A grounded topic appears in this transcript.',
        frontmatter: {},
      },
    });
    transcriptId = transcript.id;
    const [focus, topic] = await Promise.all([
      db.brainNode.create({
        data: {
          userId: ownerId,
          key: `TRANSCRIPT:${transcriptId}`,
          type: 'CONTENT',
          label: transcript.title,
          sourceType: 'TRANSCRIPT',
          sourceId: transcriptId,
        },
      }),
      db.brainNode.create({
        data: {
          userId: ownerId,
          key: `TOPIC:${suffix}`,
          type: 'TOPIC',
          label: 'Grounded topic',
        },
      }),
    ]);
    focusId = focus.id;
    topicId = topic.id;
    const edge = await db.brainEdge.create({
      data: {
        userId: ownerId,
        fromNodeId: focusId,
        toNodeId: topicId,
        kind: 'MENTIONS',
        method: 'llm-grounded',
        confidence: 0.91,
      },
    });
    groundedEdgeId = edge.id;
    await db.brainEdge.create({
      data: {
        userId: ownerId,
        fromNodeId: focusId,
        toNodeId: topicId,
        kind: 'RELATED_TO',
        method: 'inferred',
        confidence: 0.55,
      },
    });
    await Promise.all([
      db.brainSource.create({
        data: {
          userId: ownerId,
          nodeId: topicId,
          sourceType: 'TRANSCRIPT',
          sourceId: transcriptId,
          startLine: 4,
          endLine: 5,
          startSec: 15,
          endSec: 22,
          excerpt: 'A grounded topic appears',
        },
      }),
      db.brainSource.create({
        data: {
          userId: ownerId,
          edgeId: edge.id,
          sourceType: 'TRANSCRIPT',
          sourceId: transcriptId,
          excerpt: 'Grounded relation',
        },
      }),
      db.brainCompilation.create({
        data: {
          userId: ownerId,
          transcriptId,
          contentHash: `hash-${suffix}`,
          status: 'PARTIAL',
          totalSegments: 3,
          completedSegments: 2,
        },
      }),
    ]);
  });

  afterAll(async () => {
    if (ownerId) await db.user.delete({ where: { id: ownerId } }).catch(() => undefined);
    if (foreignId) await db.user.delete({ where: { id: foreignId } }).catch(() => undefined);
    await db.$disconnect();
  });

  test('returns only source-grounded nodes with navigable evidence', async () => {
    const graph = await readTranscriptLocalGraph({
      userId: ownerId,
      transcriptId,
      scope: 'content',
      hops: 1,
    });
    expect(graph).not.toBeNull();
    expect(graph?.focusId).toBe(focusId);
    expect(graph?.state).toBe('PARTIAL');
    expect(graph?.nodes.map((node) => node.id).sort()).toEqual([focusId, topicId].sort());
    expect(graph?.edges.map((edge) => edge.id)).toEqual([groundedEdgeId]);
    expect(graph?.evidence.find((item) => item.nodeId === topicId)?.anchor).toBe('#l=4-5');
  });

  test('does not reveal another user transcript or graph', async () => {
    expect(
      await readTranscriptLocalGraph({
        userId: foreignId,
        transcriptId,
        scope: 'connections',
        hops: 2,
      }),
    ).toBeNull();
  });

  test('keeps an archived transcript graph explorable in both local views', async () => {
    await db.$transaction([
      db.transcript.update({ where: { id: transcriptId }, data: { status: 'ARCHIVED' } }),
      db.brainNode.update({ where: { id: focusId }, data: { status: 'ARCHIVED' } }),
      db.brainEdge.update({ where: { id: groundedEdgeId }, data: { status: 'ARCHIVED' } }),
    ]);

    const content = await readTranscriptLocalGraph({
      userId: ownerId,
      transcriptId,
      scope: 'content',
      hops: 1,
    });
    const connections = await readTranscriptLocalGraph({
      userId: ownerId,
      transcriptId,
      scope: 'connections',
      hops: 2,
    });

    expect(content?.focusId).toBe(focusId);
    expect(content?.edges.some((edge) => edge.id === groundedEdgeId)).toBeTrue();
    expect(connections?.focusId).toBe(focusId);
    expect(connections?.nodes.some((node) => node.id === topicId)).toBeTrue();
  });
});
