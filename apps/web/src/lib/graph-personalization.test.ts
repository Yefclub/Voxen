import { describe, expect, test } from 'bun:test';
import type {
  InterestProjectionHorizon,
  InterestProjectionSnapshot,
} from './personal-interest-projections';
import { buildGraphPersonalization } from './graph-personalization';

function snapshot(
  horizon: InterestProjectionHorizon,
  watermark: string | null,
  items: InterestProjectionSnapshot['items'],
): InterestProjectionSnapshot {
  return {
    horizon,
    algorithmVersion: 'interest-v1',
    windowDays: 30,
    halfLifeDays: 7,
    items,
    eventCount: 1,
    eventWatermark: watermark,
    computedAt: '2026-08-11T12:00:00.000Z',
  };
}

function item(input: {
  key: string;
  brainNodeId: string | null;
  score: number;
  explicitScore?: number;
}): InterestProjectionSnapshot['items'][number] {
  return {
    dimension: 'TOPIC',
    key: input.key,
    label: input.key,
    brainNodeId: input.brainNodeId,
    explicitScore: input.explicitScore ?? input.score,
    inferredScore: 0,
    score: input.score,
    evidence: { observedEvents: 0, explicitTranscripts: 1, transcriptIds: ['transcript-1'] },
    lastEventAt: '2026-08-11T12:00:00.000Z',
  };
}

describe('durable graph personalization context', () => {
  test('combines positive mapped features across horizons and preserves negative accounting', () => {
    const context = buildGraphPersonalization([
      snapshot('SHORT', '2026-08-10T12:00:00.000Z', [
        item({ key: 'agents', brainNodeId: 'topic-agents', score: 0.8 }),
        item({ key: 'noise', brainNodeId: 'topic-noise', score: -0.7 }),
      ]),
      snapshot('MEDIUM', '2026-08-11T12:00:00.000Z', [
        item({ key: 'agents', brainNodeId: 'topic-agents', score: 0.5 }),
        item({ key: 'unmapped', brainNodeId: null, score: 0.9 }),
      ]),
      snapshot('LONG', null, [item({ key: 'graph', brainNodeId: 'topic-graph', score: 0.4 })]),
    ]);

    expect(context.seeds).toEqual([
      { nodeId: 'topic-agents', weight: 0.55 },
      { nodeId: 'topic-graph', weight: 0.08000000000000002 },
    ]);
    expect(context).toMatchObject({
      requestedSeedNodes: 2,
      ignoredNegativeItems: 1,
      projectionAvailable: true,
      projectionAlgorithmVersions: ['interest-v1'],
      projectionWatermark: '2026-08-11T12:00:00.000Z',
    });
    expect(context.cacheFragment).toContain('interest-v1');
  });

  test('does not promote negative, invalid, or unmapped projection items', () => {
    const context = buildGraphPersonalization([
      snapshot('SHORT', null, [
        item({ key: 'negative', brainNodeId: 'topic-negative', score: -1 }),
        item({ key: 'missing', brainNodeId: null, score: 1 }),
        item({ key: 'invalid', brainNodeId: 'topic-invalid', score: Number.NaN }),
      ]),
    ]);

    expect(context.seeds).toEqual([]);
    expect(context.requestedSeedNodes).toBe(0);
    expect(context.ignoredNegativeItems).toBe(1);
  });

  test('changes the cache fragment when effective scores change at the same watermark', () => {
    const first = buildGraphPersonalization([
      snapshot('SHORT', '2026-08-11T12:00:00.000Z', [
        item({ key: 'agents', brainNodeId: 'topic-agents', score: 0.8 }),
      ]),
    ]);
    const decayed = buildGraphPersonalization([
      snapshot('SHORT', '2026-08-11T12:00:00.000Z', [
        item({ key: 'agents', brainNodeId: 'topic-agents', score: 0.4 }),
      ]),
    ]);

    expect(first.projectionWatermark).toBe(decayed.projectionWatermark);
    expect(first.projectionAlgorithmVersions).toEqual(decayed.projectionAlgorithmVersions);
    expect(first.cacheFragment).not.toBe(decayed.cacheFragment);
  });
});
