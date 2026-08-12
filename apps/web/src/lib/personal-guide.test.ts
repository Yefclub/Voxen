import { describe, expect, test } from 'bun:test';
import type {
  InterestProjectionHorizon,
  InterestProjectionSnapshot,
} from './personal-interest-projections';
import { buildPersonalGuide, type PersonalGuideSource } from './personal-guide';

const now = new Date('2026-08-11T18:00:00.000Z');

function item(input: {
  key: string;
  label?: string;
  brainNodeId?: string | null;
  score: number;
  explicitScore?: number;
  inferredScore?: number;
  transcriptIds?: string[];
}): InterestProjectionSnapshot['items'][number] {
  return {
    dimension: 'TOPIC',
    key: input.key,
    label: input.label ?? input.key,
    brainNodeId: input.brainNodeId ?? `topic-${input.key}`,
    explicitScore: input.explicitScore ?? 0,
    inferredScore: input.inferredScore ?? Math.max(0, input.score),
    score: input.score,
    evidence: {
      observedEvents: input.inferredScore ? 3 : 0,
      explicitTranscripts: input.explicitScore ? 1 : 0,
      transcriptIds: input.transcriptIds ?? ['source-a'],
    },
    lastEventAt: now.toISOString(),
  };
}

function snapshot(
  horizon: InterestProjectionHorizon,
  items: InterestProjectionSnapshot['items'],
): InterestProjectionSnapshot {
  return {
    horizon,
    algorithmVersion: 'interest-v1',
    windowDays: horizon === 'SHORT' ? 14 : horizon === 'MEDIUM' ? 90 : 365,
    halfLifeDays: horizon === 'SHORT' ? 3 : horizon === 'MEDIUM' ? 21 : 90,
    items,
    eventCount: items.length,
    eventWatermark: now.toISOString(),
    computedAt: now.toISOString(),
  };
}

const sources = new Map<string, PersonalGuideSource>([
  [
    'source-a',
    {
      transcriptId: 'source-a',
      title: 'Agents in production',
      description: 'A practical source',
      source: 'YOUTUBE',
      thumbnailUrl: null,
      createdAt: now.toISOString(),
    },
  ],
  [
    'source-b',
    {
      transcriptId: 'source-b',
      title: 'Graph retrieval',
      description: null,
      source: 'WEB',
      thumbnailUrl: null,
      createdAt: now.toISOString(),
    },
  ],
]);

const graphNodes = [
  {
    id: 'topic-agents',
    key: 'topic:agents',
    label: 'AI Agents',
    description: null,
    type: 'topic' as const,
    sourceType: 'MANUAL' as const,
    sourceId: null,
    weight: 2,
    updatedAt: now.toISOString(),
  },
  {
    id: 'content-a',
    key: 'transcript:source-a',
    label: 'Agents in production',
    description: 'A practical source',
    type: 'transcript' as const,
    source: 'YOUTUBE' as const,
    sourceType: 'TRANSCRIPT' as const,
    sourceId: 'source-a',
    transcriptId: 'source-a',
    weight: 3,
    updatedAt: now.toISOString(),
  },
  {
    id: 'content-b',
    key: 'transcript:source-b',
    label: 'Graph retrieval',
    description: null,
    type: 'transcript' as const,
    source: 'WEB' as const,
    sourceType: 'TRANSCRIPT' as const,
    sourceId: 'source-b',
    transcriptId: 'source-b',
    weight: 2,
    updatedAt: now.toISOString(),
  },
];

const graphEdges = [
  {
    id: 'edge-a',
    from: 'content-a',
    to: 'topic-agents',
    kind: 'mentions' as const,
    method: 'brain-extraction',
    confidence: '0.9',
    evidence: 'EXTRACTED' as const,
  },
];

const centrality = {
  nodes: [
    {
      id: 'content-a',
      degree: 1,
      weightedDegree: 0.8,
      weightedDegreeCentrality: 1,
      pageRank: 0.2,
      personalizedPageRank: 0.5,
      personalizationLift: 0.86,
    },
    {
      id: 'content-b',
      degree: 0,
      weightedDegree: 0,
      weightedDegreeCentrality: 0,
      pageRank: 0.3,
      personalizedPageRank: 0.1,
      personalizationLift: -1,
    },
    {
      id: 'topic-agents',
      degree: 1,
      weightedDegree: 0.8,
      weightedDegreeCentrality: 1,
      pageRank: 0.5,
      personalizedPageRank: 0.4,
      personalizationLift: -0.22,
    },
  ],
  metadata: {
    algorithmVersion: 'weighted-pagerank-v1',
    dampingFactor: 0.85,
    tolerance: 1e-10,
    maxIterations: 100,
    structuralIterations: 12,
    personalizedIterations: 13,
    structuralConverged: true,
    personalizedConverged: true,
    personalizationMode: 'durable-interest' as const,
    requestedSeedNodes: 1,
    matchedSeedNodes: 1,
    ignoredNegativeItems: 0,
    projectionAvailable: true,
    projectionAlgorithmVersions: ['interest-v1'],
    projectionWatermark: now.toISOString(),
    horizonWeights: { SHORT: 0.5, MEDIUM: 0.3, LONG: 0.2 },
    snapshotTruncated: false,
  },
};

describe('explainable personal Guide', () => {
  test('classifies emerging, steady, and cooling trends across separate horizons', () => {
    const guide = buildPersonalGuide({
      projections: [
        snapshot('SHORT', [
          item({ key: 'agents', score: 0.8, explicitScore: 0.8 }),
          item({ key: 'steady', score: 0.6 }),
          item({ key: 'cooling', score: 0.05 }),
        ]),
        snapshot('MEDIUM', [
          item({ key: 'agents', score: 0.4, explicitScore: 0.4 }),
          item({ key: 'steady', score: 0.58 }),
          item({ key: 'cooling', score: 0.4 }),
        ]),
        snapshot('LONG', [
          item({ key: 'agents', score: 0.1, explicitScore: 0.1 }),
          item({ key: 'steady', score: 0.55 }),
          item({ key: 'cooling', score: 0.75 }),
        ]),
      ],
      graph: { nodes: graphNodes, edges: graphEdges, truncated: false },
      centrality,
      communities: [],
      sourcesByTranscriptId: sources,
      now,
    });

    expect(guide.trends.map((trend) => [trend.key, trend.classification])).toEqual([
      ['agents', 'EMERGING'],
      ['steady', 'STEADY'],
      ['cooling', 'COOLING'],
    ]);
    expect(guide.trends[0]).toMatchObject({
      scores: { short: 0.8, medium: 0.4, long: 0.1 },
      evidence: { explicitTranscripts: 1 },
    });
  });

  test('keeps every trend class visible and omits unsupported medium-only signals', () => {
    const emerging = Array.from({ length: 25 }, (_, index) =>
      item({ key: `emerging-${index}`, score: 0.8 - index * 0.01 }),
    );
    const guide = buildPersonalGuide({
      projections: [
        snapshot('SHORT', [...emerging, item({ key: 'steady-visible', score: 0.49 })]),
        snapshot('MEDIUM', [
          item({ key: 'steady-visible', score: 0.5 }),
          item({ key: 'medium-only', score: 0.7 }),
        ]),
        snapshot('LONG', [
          item({ key: 'steady-visible', score: 0.48 }),
          item({ key: 'cooling-visible', score: 0.75 }),
        ]),
      ],
      graph: { nodes: graphNodes, edges: graphEdges, truncated: false },
      centrality,
      communities: [],
      sourcesByTranscriptId: sources,
      now,
    });

    expect(guide.trends.filter((trend) => trend.classification === 'EMERGING')).toHaveLength(8);
    expect(guide.trends).toContainEqual(
      expect.objectContaining({ key: 'steady-visible', classification: 'STEADY' }),
    );
    expect(guide.trends).toContainEqual(
      expect.objectContaining({ key: 'cooling-visible', classification: 'COOLING' }),
    );
    expect(guide.trends.some((trend) => trend.key === 'medium-only')).toBe(false);
  });

  test('ranks personalized sources and exposes inspectable evidence', () => {
    const guide = buildPersonalGuide({
      projections: [
        snapshot('SHORT', [
          item({
            key: 'agents',
            label: 'AI Agents',
            score: 0.8,
            explicitScore: 0.8,
            transcriptIds: ['source-a'],
          }),
        ]),
      ],
      graph: { nodes: graphNodes, edges: graphEdges, truncated: false },
      centrality,
      communities: [
        {
          id: 0,
          size: 2,
          label: 'AI Agents',
          nodeIds: ['topic-agents', 'content-a'],
          representativeNodeId: 'topic-agents',
          internalWeight: 1,
          boundaryWeight: 0,
          cohesion: 1,
        },
      ],
      sourcesByTranscriptId: sources,
      now,
    });

    expect(guide.metadata.personalizationMode).toBe('durable-interest');
    expect(guide.recommendations[0]).toMatchObject({
      transcriptId: 'source-a',
      title: 'Agents in production',
      score: 1,
    });
    expect(guide.recommendations[0]?.reasons.map((reason) => reason.kind)).toEqual([
      'INTEREST',
      'COMMUNITY',
      'PERSONALIZATION',
    ]);
    expect(guide.evidenceSources).toEqual([expect.objectContaining({ transcriptId: 'source-a' })]);
  });

  test('never promotes negative projections and uses an explicit structural fallback', () => {
    const fallbackCentrality = {
      ...centrality,
      metadata: { ...centrality.metadata, personalizationMode: 'uniform' as const },
    };
    const guide = buildPersonalGuide({
      projections: [
        snapshot('SHORT', [
          item({ key: 'blocked', score: -1, explicitScore: -1, brainNodeId: 'topic-agents' }),
        ]),
      ],
      graph: { nodes: graphNodes, edges: graphEdges, truncated: true },
      centrality: fallbackCentrality,
      communities: [],
      sourcesByTranscriptId: sources,
      now,
    });

    expect(guide.trends).toEqual([]);
    expect(guide.recommendations[0]?.transcriptId).toBe('source-b');
    expect(guide.recommendations[0]?.reasons).toEqual([
      expect.objectContaining({ kind: 'STRUCTURAL' }),
    ]);
    expect(guide.metadata.graphTruncated).toBe(true);
  });

  test('omits graph sources that were not authorized by the caller', () => {
    const guide = buildPersonalGuide({
      projections: [],
      graph: { nodes: graphNodes, edges: graphEdges, truncated: false },
      centrality,
      communities: [],
      sourcesByTranscriptId: new Map([['source-a', sources.get('source-a')!]]),
      now,
    });

    expect(guide.recommendations.map((item) => item.transcriptId)).toEqual(['source-a']);
    expect(guide.recommendations.some((item) => item.transcriptId === 'source-b')).toBe(false);
  });

  test('is deterministic when graph and projection input order changes', () => {
    const projections = [
      snapshot('SHORT', [item({ key: 'agents', score: 0.8, explicitScore: 0.8 })]),
      snapshot('LONG', [item({ key: 'agents', score: 0.4, explicitScore: 0.4 })]),
    ];
    const build = (reverse: boolean) =>
      buildPersonalGuide({
        projections: reverse
          ? [...projections].reverse().map((projection) => ({
              ...projection,
              items: [...projection.items].reverse(),
            }))
          : projections,
        graph: {
          nodes: reverse ? [...graphNodes].reverse() : graphNodes,
          edges: reverse ? [...graphEdges].reverse() : graphEdges,
          truncated: false,
        },
        centrality: {
          ...centrality,
          nodes: reverse ? [...centrality.nodes].reverse() : centrality.nodes,
        },
        communities: [],
        sourcesByTranscriptId: sources,
        now,
      });

    expect(build(true)).toEqual(build(false));
  });
});
