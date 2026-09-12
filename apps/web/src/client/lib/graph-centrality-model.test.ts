import { describe, expect, test } from 'bun:test';
import { buildClientGraphCentrality } from './graph-centrality-model';

const nodes = ['a', 'b', 'c'].map((id) => ({ id, label: id.toUpperCase(), type: 'topic' }));
const edges = [
  {
    from: 'a',
    to: 'b',
    kind: 'same_as',
    confidence: '1',
    evidence: 'EXTRACTED',
  },
  {
    from: 'b',
    to: 'c',
    kind: 'contradicts',
    confidence: '0.2',
    evidence: 'AMBIGUOUS',
  },
];

describe('client weighted graph hubs', () => {
  test('orders equal raw degrees by weighted centrality', () => {
    const result = buildClientGraphCentrality({ nodes, edges });

    expect(result.hubs.map((hub) => hub.id)).toEqual(['b', 'a', 'c']);
    expect(result.hubs[0]).toMatchObject({ degree: 2, weightedDegreeCentrality: 1 });
    expect(result.hubs[1]!.degree).toBe(result.hubs[2]!.degree);
    expect(result.hubs[1]!.weightedDegree).toBeGreaterThan(result.hubs[2]!.weightedDegree);
  });

  test('projects server PageRank metrics onto only visible nodes', () => {
    const data = {
      nodes: nodes.slice(0, 2),
      edges: edges.slice(0, 1),
      insights: {
        nodeCentrality: [score('a', 0.4, 0.7), score('b', 0.5, 0.2), score('hidden', 0.1, 0.1)],
      },
    };
    const result = buildClientGraphCentrality(data);

    expect(result.nodeCentrality?.map((item) => item.id)).toEqual(['a', 'b']);
    expect(result.hubs.find((hub) => hub.id === 'a')).toMatchObject({
      pageRank: 0.4,
      personalizedPageRank: 0.7,
    });
  });
});

function score(id: string, pageRank: number, personalizedPageRank: number) {
  return {
    id,
    degree: 1,
    weightedDegree: 1,
    weightedDegreeCentrality: 1,
    pageRank,
    personalizedPageRank,
    personalizationLift: 0,
  };
}
