import { describe, expect, test } from 'bun:test';
import {
  ALL_GRAPH_NODE_TYPES,
  buildGraphCommunities,
  buildGraphInsights,
  buildGraphLayout,
  buildGraphPositions3D,
  filterGraphData,
  resolveGraphPalette,
  type GraphResp,
} from '../src/client/lib/graph-model';

const NOW = '2026-07-15T12:00:00.000Z';

const DATA = {
  totalNodes: 5,
  totalEdges: 3,
  indexing: false,
  generatedAt: NOW,
  insights: {
    hubs: [],
    communities: [],
    edgeEvidence: { extracted: 1, inferred: 2, ambiguous: 0 },
  },
  nodes: [
    node('source-alpha', 'Alpha em produção', 'transcript', 'TRANSCRIPT', 'source-alpha'),
    node('topic-alpha', 'Arquitetura Alpha', 'topic'),
    node('entity-second-hop', 'Equipe distante', 'entity'),
    node('note-beta', 'Nota Beta', 'note', 'NOTE', 'note-beta'),
    node('isolated', 'Conteúdo isolado', 'content'),
  ],
  edges: [
    edge('edge-alpha', 'source-alpha', 'topic-alpha', 'mentions'),
    edge('edge-second-hop', 'topic-alpha', 'entity-second-hop', 'related_to'),
    edge('edge-beta', 'note-beta', 'topic-alpha', 'links_to'),
  ],
} satisfies GraphResp;

function node(
  id: string,
  label: string,
  type: GraphResp['nodes'][number]['type'],
  sourceType: GraphResp['nodes'][number]['sourceType'] = 'MANUAL',
  sourceId: string | null = null,
): GraphResp['nodes'][number] {
  return {
    id,
    key: id,
    label,
    description: null,
    type,
    sourceType,
    sourceId,
    weight: 1,
    updatedAt: NOW,
  };
}

function edge(
  id: string,
  from: string,
  to: string,
  kind: GraphResp['edges'][number]['kind'],
): GraphResp['edges'][number] {
  return {
    id,
    from,
    to,
    kind,
    method: 'test',
    confidence: '0.9',
    evidence: kind === 'links_to' ? 'EXTRACTED' : 'INFERRED',
  };
}

describe('filterGraphData', () => {
  test('keeps direct search matches plus exactly one neighbor hop', () => {
    const filtered = filterGraphData(DATA, 'produção', new Set(ALL_GRAPH_NODE_TYPES));

    expect(filtered.nodes.map((item) => item.id).sort()).toEqual(['source-alpha', 'topic-alpha']);
    expect(filtered.edges.map((item) => item.id)).toEqual(['edge-alpha']);
  });

  test('applies type filters and never leaves dangling edges', () => {
    const filtered = filterGraphData(DATA, '', new Set(['note', 'topic']));

    expect(filtered.nodes.map((item) => item.id).sort()).toEqual(['note-beta', 'topic-alpha']);
    expect(filtered.edges.map((item) => item.id)).toEqual(['edge-beta']);
    expect(filtered.totalNodes).toBe(2);
    expect(filtered.totalEdges).toBe(1);
  });
});

describe('graph insights and deterministic layout', () => {
  test('derives sorted communities and hubs from the visible graph', () => {
    const communities = buildGraphCommunities(DATA);
    const insights = buildGraphInsights(DATA);

    expect(communities[0]?.nodeIds.sort()).toEqual([
      'entity-second-hop',
      'note-beta',
      'source-alpha',
      'topic-alpha',
    ]);
    expect(communities.at(-1)?.nodeIds).toEqual(['isolated']);
    expect(insights.hubs[0]).toMatchObject({ id: 'topic-alpha', degree: 3 });
    expect(insights.communities).toHaveLength(2);
  });

  test('produces stable finite coordinates without a continuous simulation', () => {
    const first = buildGraphLayout(DATA);
    const second = buildGraphLayout(DATA);

    expect(first.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(
      second.nodes.map(({ id, x, y }) => ({ id, x, y })),
    );
    expect(first.nodes.every((item) => Number.isFinite(item.x) && Number.isFinite(item.y))).toBe(
      true,
    );
  });

  test('anchors the primary 3D community at the origin and orbits satellites', () => {
    const communities = buildGraphCommunities(DATA);
    const positions = buildGraphPositions3D(DATA);
    const primaryHub = communities[0]?.nodeIds[0];

    expect(primaryHub).toBe('topic-alpha');
    expect(positions.get(primaryHub ?? '')).toEqual({ x: 0, y: 0, z: 0 });
    expect(positions.get('isolated')).not.toEqual({ x: 0, y: 0, z: 0 });
  });

  test('lays out the defensive cap of 500 nodes and 1,500 edges with finite coordinates', () => {
    const nodes = Array.from({ length: 500 }, (_, index) =>
      node(`node-${index}`, `Nó ${index}`, index % 5 === 0 ? 'transcript' : 'topic'),
    );
    const edges = Array.from({ length: 1_500 }, (_, index) =>
      edge(
        `edge-${index}`,
        `node-${index % nodes.length}`,
        `node-${(index * 17 + 1) % nodes.length}`,
        index % 3 === 0 ? 'mentions' : 'related_to',
      ),
    );
    const large = {
      ...DATA,
      nodes,
      edges,
      totalNodes: nodes.length,
      totalEdges: edges.length,
    } satisfies GraphResp;

    const layout = buildGraphLayout(large);
    const positions3d = buildGraphPositions3D(large);

    expect(layout.nodes).toHaveLength(500);
    expect(layout.edges).toHaveLength(1_500);
    expect(positions3d.size).toBe(500);
    expect(
      [...positions3d.values()].every(
        (item) => Number.isFinite(item.x) && Number.isFinite(item.y) && Number.isFinite(item.z),
      ),
    ).toBe(true);
    expect(layout.nodes.every((item) => Number.isFinite(item.x) && Number.isFinite(item.y))).toBe(
      true,
    );
  });
});

describe('graph palettes', () => {
  test('uses readable, distinct palettes for light and dark themes', () => {
    const dark = resolveGraphPalette('zinc');
    const emerald = resolveGraphPalette('emerald');
    const light = resolveGraphPalette('light');

    expect(dark.label).not.toBe(light.label);
    expect(dark.selected).not.toBe(light.selected);
    expect(dark.nodes.transcript).not.toBe(light.nodes.transcript);
    expect(emerald.canvas).not.toBe(light.canvas);
    expect(light.canvas).toBe('#f7f7f8');
  });
});
