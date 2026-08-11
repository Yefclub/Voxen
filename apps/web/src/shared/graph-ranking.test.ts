import { describe, expect, test } from 'bun:test';
import { calculateGraphCentrality } from './graph-ranking';

const nodes = ['a', 'b', 'c', 'isolated'].map((id) => ({ id, label: id.toUpperCase() }));

function edge(
  from: string,
  to: string,
  confidence: string | number = 1,
  evidence = 'EXTRACTED',
  kind = 'supports',
) {
  return { from, to, confidence, evidence, kind };
}

describe('weighted graph centrality and personalized PageRank', () => {
  test('returns finite normalized structural and personalized distributions', () => {
    const result = calculateGraphCentrality({
      nodes,
      edges: [edge('a', 'b'), edge('b', 'c', 0.4, 'INFERRED')],
      personalSeeds: [{ nodeId: 'a', weight: 1 }],
      snapshotTruncated: true,
    });

    expect(result.nodes).toHaveLength(4);
    expect(
      result.nodes.every((node) =>
        Object.entries(node).every(([key, value]) => key === 'id' || Number.isFinite(value)),
      ),
    ).toBe(true);
    expect(result.nodes.reduce((sum, node) => sum + node.pageRank, 0)).toBeCloseTo(1, 9);
    expect(result.nodes.reduce((sum, node) => sum + node.personalizedPageRank, 0)).toBeCloseTo(
      1,
      9,
    );
    expect(result.metadata).toMatchObject({
      personalizationMode: 'durable-interest',
      matchedSeedNodes: 1,
      snapshotTruncated: true,
    });
  });

  test('weights strong evidence above weak ambiguous relationships', () => {
    const result = calculateGraphCentrality({
      nodes,
      edges: [
        edge('a', 'b', 1, 'EXTRACTED', 'same_as'),
        edge('b', 'c', 0.3, 'AMBIGUOUS', 'contradicts'),
      ],
    });
    const byId = new Map(result.nodes.map((node) => [node.id, node]));

    expect(byId.get('a')!.weightedDegree).toBeGreaterThan(byId.get('c')!.weightedDegree);
    expect(byId.get('b')!.weightedDegreeCentrality).toBe(1);
    expect(byId.get('a')!.pageRank).toBeGreaterThan(byId.get('c')!.pageRank);
  });

  test('raises a seeded topic and its neighborhood without overwriting structural PageRank', () => {
    const result = calculateGraphCentrality({
      nodes: nodes.slice(0, 3),
      edges: [edge('a', 'b'), edge('b', 'c')],
      personalSeeds: [{ nodeId: 'a', weight: 2 }],
    });
    const byId = new Map(result.nodes.map((node) => [node.id, node]));

    expect(byId.get('a')!.pageRank).toBeCloseTo(byId.get('c')!.pageRank, 10);
    expect(byId.get('a')!.personalizedPageRank).toBeGreaterThan(
      byId.get('c')!.personalizedPageRank,
    );
    expect(byId.get('a')!.personalizationLift).toBeGreaterThan(0);
    expect(byId.get('c')!.personalizationLift).toBeLessThan(0);
  });

  test('uses explicit uniform fallback when seeds are invalid or outside the slice', () => {
    const result = calculateGraphCentrality({
      nodes: nodes.slice(0, 3),
      edges: [edge('a', 'b'), edge('b', 'c')],
      personalSeeds: [
        { nodeId: 'outside', weight: 1 },
        { nodeId: 'a', weight: -1 },
        { nodeId: 'b', weight: Number.NaN },
      ],
      personalization: { requestedSeedNodes: 2, ignoredNegativeItems: 4 },
    });

    expect(result.metadata).toMatchObject({
      personalizationMode: 'uniform',
      requestedSeedNodes: 2,
      matchedSeedNodes: 0,
      ignoredNegativeItems: 4,
    });
    for (const node of result.nodes) {
      expect(node.personalizedPageRank).toBe(node.pageRank);
      expect(node.personalizationLift).toBe(0);
    }
  });

  test('is deterministic, ignores malformed edges, and handles empty slices', () => {
    const input = {
      nodes,
      edges: [edge('a', 'b', 'not-a-number', 'UNKNOWN'), edge('missing', 'b'), edge('a', 'a')],
      personalSeeds: [{ nodeId: 'isolated', weight: 1 }],
    };
    const first = calculateGraphCentrality(input);
    const second = calculateGraphCentrality(input);

    expect(first).toEqual(second);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(calculateGraphCentrality({ nodes: [], edges: [] })).toMatchObject({
      nodes: [],
      metadata: {
        structuralIterations: 0,
        personalizedIterations: 0,
        personalizationMode: 'uniform',
      },
    });
  });
});
