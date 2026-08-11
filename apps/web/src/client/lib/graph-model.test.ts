import { describe, expect, test } from 'bun:test';
import type { GraphCommunityDetection } from '../../shared/graph-community';
import { communitySelectionId } from './graph-community-model';
import {
  buildGraphCommunities,
  filterGraphData,
  type GraphEdge,
  type GraphNode,
  type GraphResp,
} from './graph-model';

const node = (id: string): GraphNode => ({
  id,
  key: id,
  label: `Node ${id.toUpperCase()}`,
  description: null,
  type: 'topic',
  sourceType: 'TRANSCRIPT',
  sourceId: 'transcript-1',
  weight: 1,
  updatedAt: '2026-08-11T00:00:00.000Z',
});

const edge = (from: string, to: string): GraphEdge => ({
  id: `${from}-${to}`,
  from,
  to,
  kind: 'related_to',
  method: 'test',
  confidence: '1',
  evidence: 'EXTRACTED',
});

const detection: GraphCommunityDetection = {
  method: 'leiden',
  algorithmVersion: 'leiden-modularity-v1',
  objective: 'modularity',
  resolution: 1,
  seed: 17,
  quality: 0.42,
  eligibleNodes: 6,
  eligibleEdges: 7,
  singletonNodes: 0,
  fallbackReason: null,
};

const response = (): GraphResp => {
  const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map(node);
  const edges = [
    edge('a', 'b'),
    edge('a', 'c'),
    edge('b', 'c'),
    edge('c', 'd'),
    edge('d', 'e'),
    edge('d', 'f'),
    edge('e', 'f'),
  ];
  return {
    nodes,
    edges,
    totalNodes: nodes.length,
    totalEdges: edges.length,
    insights: {
      hubs: [],
      communities: [
        {
          id: 0,
          size: 3,
          label: 'Node A',
          nodeIds: ['a', 'b', 'c'],
          representativeNodeId: 'a',
          internalWeight: 3,
          boundaryWeight: 1,
          cohesion: 0.75,
        },
        {
          id: 1,
          size: 3,
          label: 'Node D',
          nodeIds: ['d', 'e', 'f'],
          representativeNodeId: 'd',
          internalWeight: 3,
          boundaryWeight: 1,
          cohesion: 0.75,
        },
      ],
      communityDetection: detection,
      edgeEvidence: { extracted: 7, inferred: 0, ambiguous: 0 },
    },
  };
};

describe('graph community projection', () => {
  test('selects the representative even when stable membership order starts elsewhere', () => {
    const community = response().insights!.communities[0]!;
    community.representativeNodeId = 'c';

    expect(community.nodeIds[0]).toBe('a');
    expect(communitySelectionId(community)).toBe('c');
  });

  test('preserves the server Leiden partition despite a bridge between communities', () => {
    expect(buildGraphCommunities(response()).map((community) => community.nodeIds)).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
  });

  test('intersects detected membership when the visible graph is filtered', () => {
    const data = response();
    data.nodes[0] = { ...data.nodes[0]!, label: 'Selected topic' };
    const filtered = filterGraphData(data, 'selected', new Set(['topic']));

    expect(filtered.insights?.communityDetection).toEqual(detection);
    expect(filtered.insights?.communities).toEqual([
      expect.objectContaining({ nodeIds: ['a', 'b', 'c'], size: 3 }),
    ]);
  });

  test('keeps connected-components compatibility for older API responses', () => {
    const data = response();
    delete data.insights?.communityDetection;
    data.edges = [edge('a', 'b'), edge('c', 'd')];

    expect(buildGraphCommunities(data)).toEqual([
      expect.objectContaining({ nodeIds: ['a', 'b'], internalWeight: 1 }),
      expect.objectContaining({ nodeIds: ['c', 'd'], internalWeight: 1 }),
    ]);
  });
});
