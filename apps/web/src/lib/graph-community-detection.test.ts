import { describe, expect, test } from 'bun:test';
import { detectGraphCommunities, effectiveCommunityEdgeWeight } from './graph-community-detection';

const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({
  id,
  label: `Node ${id.toUpperCase()}`,
}));

const strongEdge = (from: string, to: string) => ({
  from,
  to,
  kind: 'supports',
  confidence: '1',
  evidence: 'EXTRACTED' as const,
});

describe('weighted Leiden graph communities', () => {
  test('separates dense groups connected by a weak bridge', () => {
    const result = detectGraphCommunities(nodes, [
      strongEdge('a', 'b'),
      strongEdge('a', 'c'),
      strongEdge('b', 'c'),
      strongEdge('d', 'e'),
      strongEdge('d', 'f'),
      strongEdge('e', 'f'),
      {
        from: 'c',
        to: 'd',
        kind: 'contradicts',
        confidence: '0.2',
        evidence: 'AMBIGUOUS',
      },
    ]);

    expect(result.detection).toMatchObject({
      method: 'leiden',
      objective: 'modularity',
      resolution: 1,
      seed: 17,
      eligibleNodes: 6,
      eligibleEdges: 7,
      singletonNodes: 0,
      fallbackReason: null,
    });
    expect(result.detection.quality).toBeGreaterThan(0);
    expect(result.communities.map((community) => community.nodeIds)).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
    expect(result.communities.every((community) => community.cohesion > 0.95)).toBe(true);
  });

  test('is deterministic for the same weighted graph', () => {
    const edges = [
      strongEdge('a', 'b'),
      strongEdge('a', 'c'),
      strongEdge('b', 'c'),
      strongEdge('d', 'e'),
      strongEdge('d', 'f'),
      strongEdge('e', 'f'),
      strongEdge('c', 'd'),
    ];
    expect(detectGraphCommunities(nodes, edges)).toEqual(
      detectGraphCommunities([...nodes].reverse(), [...edges].reverse()),
    );
  });

  test('weights confidence, evidence, and relation semantics', () => {
    const extractedHierarchy = effectiveCommunityEdgeWeight({
      from: 'a',
      to: 'b',
      kind: 'belongs_to',
      confidence: '0.8',
      evidence: 'EXTRACTED',
    });
    const inferredRelation = effectiveCommunityEdgeWeight({
      from: 'a',
      to: 'b',
      kind: 'related_to',
      confidence: '0.8',
      evidence: 'INFERRED',
    });
    const invalidConfidence = effectiveCommunityEdgeWeight({
      from: 'a',
      to: 'b',
      kind: 'unknown',
      confidence: 'not-a-number',
      evidence: 'AMBIGUOUS',
    });
    const invalidEvidence = effectiveCommunityEdgeWeight({
      from: 'a',
      to: 'b',
      kind: 'supports',
      confidence: '0.8',
      evidence: 'BROKEN',
    });
    expect(extractedHierarchy).toBe(0.88);
    expect(inferredRelation).toBe(0.364);
    expect(invalidConfidence).toBe(0.1);
    expect(invalidEvidence).toBe(0.32);
    expect(Number.isFinite(invalidEvidence)).toBe(true);

    const malformedResult = detectGraphCommunities(nodes.slice(0, 2), [
      { ...strongEdge('a', 'b'), evidence: 'BROKEN' },
    ]);
    expect(Number.isFinite(malformedResult.communities[0]!.internalWeight)).toBe(true);
    expect(JSON.parse(JSON.stringify(malformedResult)).communities[0].internalWeight).toBe(0.4);
  });

  test('aggregates parallel and reciprocal edges before detection', () => {
    let receivedEdges: Array<{ from: string; to: string; weight: number }> = [];
    const result = detectGraphCommunities(
      nodes.slice(0, 3),
      [
        strongEdge('a', 'b'),
        { ...strongEdge('b', 'a'), confidence: '0.5' },
        strongEdge('a', 'missing'),
        strongEdge('a', 'a'),
      ],
      {
        detectMembership: (_nodeCount, edges) => {
          receivedEdges = edges;
          return { membership: [0, 0], quality: 0.25 };
        },
      },
    );
    expect(receivedEdges).toEqual([{ from: 'a', to: 'b', weight: 1 }]);
    expect(result.detection).toMatchObject({
      eligibleNodes: 2,
      eligibleEdges: 1,
      singletonNodes: 1,
    });
    expect(result.communities[0]).toMatchObject({ nodeIds: ['a', 'b'], internalWeight: 1 });
  });

  test('splits a disconnected detector result into connected communities', () => {
    const result = detectGraphCommunities(
      nodes.slice(0, 4),
      [strongEdge('a', 'b'), strongEdge('c', 'd')],
      { detectMembership: () => ({ membership: [0, 0, 0, 0], quality: 0.1 }) },
    );
    expect(result.communities.map((community) => community.nodeIds)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  test('falls back to deterministic connected components when detection fails', () => {
    const result = detectGraphCommunities(
      nodes.slice(0, 3),
      [strongEdge('a', 'b'), strongEdge('b', 'c')],
      {
        detectMembership: () => {
          throw new Error('controlled failure');
        },
      },
    );
    expect(result.detection).toMatchObject({
      method: 'connected-components',
      quality: null,
      fallbackReason: 'detector-error',
    });
    expect(result.communities.map((community) => community.nodeIds)).toEqual([['a', 'b', 'c']]);
  });

  test('returns a valid empty partition for isolated or empty inputs', () => {
    expect(detectGraphCommunities([], []).communities).toEqual([]);
    const isolated = detectGraphCommunities(nodes.slice(0, 2), []);
    expect(isolated.communities).toEqual([]);
    expect(isolated.detection).toMatchObject({
      method: 'leiden',
      eligibleNodes: 0,
      eligibleEdges: 0,
      singletonNodes: 2,
    });
  });
});
