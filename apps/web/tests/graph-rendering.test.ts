import { describe, expect, test } from 'bun:test';
import {
  EDGE_COLORS,
  NODE_COLORS,
  buildGraphLayout,
  buildGraphPositions3D,
  buildSigmaGraphModel,
  nodePath,
} from '../src/client/lib/graph-model';
import { DEFAULT_GRAPH_MODE, resolveGraphRenderProfile } from '../src/client/lib/graph-renderer';

const SVG_SAFE_COLOR = /^(#[0-9a-f]{6}|rgba?\([^)]+\))$/i;

describe('graph rendering helpers', () => {
  test('uses SVG-compatible colors for graph styles', () => {
    const colors = [...Object.values(NODE_COLORS), ...Object.values(EDGE_COLORS)];

    expect(colors.length).toBeGreaterThan(0);
    for (const color of colors) {
      expect(color.toLowerCase()).not.toContain('oklch');
      expect(color).toMatch(SVG_SAFE_COLOR);
    }
  });

  test('creates finite positions and connects rendered edges to nodes', () => {
    const fixture = {
      totalNodes: 3,
      totalEdges: 2,
      nodes: [
        {
          id: 'transcript-1',
          key: 'transcript:1',
          label: 'Transcricao de teste',
          description: null,
          type: 'transcript',
          sourceType: 'TRANSCRIPT',
          sourceId: '1',
          source: 'YOUTUBE',
          weight: 3,
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'topic-1',
          key: 'topic:1',
          label: 'Conhecimento conectado',
          description: null,
          type: 'topic',
          sourceType: 'MANUAL',
          sourceId: null,
          weight: 2,
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'entity-1',
          key: 'entity:1',
          label: 'Voxen',
          description: null,
          type: 'entity',
          sourceType: 'MANUAL',
          sourceId: null,
          weight: 1,
          updatedAt: new Date().toISOString(),
        },
      ],
      edges: [
        {
          id: 'edge-1',
          from: 'transcript-1',
          to: 'topic-1',
          kind: 'mentions',
          method: 'test',
          confidence: '1',
        },
        {
          id: 'edge-2',
          from: 'topic-1',
          to: 'entity-1',
          kind: 'related_to',
          method: 'test',
          confidence: '1',
        },
      ],
    } satisfies Parameters<typeof buildGraphLayout>[0];
    const layout = buildGraphLayout(fixture);

    expect(layout.nodes).toHaveLength(3);
    expect(layout.edges).toHaveLength(2);
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(node.radius).toBeGreaterThan(0);
      expect(node.labelLines.length).toBeGreaterThan(0);
    }
    for (const edge of layout.edges) {
      expect(edge.fromNode.id).toBe(edge.from);
      expect(edge.toNode.id).toBe(edge.to);
    }
  });

  test('builds a Graphology model for the WebGL renderer', () => {
    const model = buildSigmaGraphModel({
      totalNodes: 2,
      totalEdges: 1,
      nodes: [
        {
          id: 'note-1',
          key: 'note:1',
          label: 'Nota conectada',
          description: null,
          type: 'note',
          sourceType: 'NOTE',
          sourceId: '1',
          weight: 2,
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'topic-1',
          key: 'topic:1',
          label: 'Topico',
          description: null,
          type: 'topic',
          sourceType: 'MANUAL',
          sourceId: null,
          weight: 1,
          updatedAt: new Date().toISOString(),
        },
      ],
      edges: [
        {
          id: 'edge-1',
          from: 'note-1',
          to: 'topic-1',
          kind: 'mentions',
          method: 'test',
          confidence: '1',
        },
      ],
    });

    expect(model.graph.order).toBe(2);
    expect(model.graph.size).toBe(1);
    expect(model.graph.getNodeAttribute('note-1', 'label')).toBe('Nota conectada');
    expect(model.graph.getNodeAttribute('topic-1', 'type')).toBe('circle');
    expect(model.graph.getNodeAttribute('topic-1', 'nodeType')).toBe('topic');
    expect(model.neighborhoods.get('note-1')?.has('topic-1')).toBe(true);
    expect(model.reagraphNodes).toHaveLength(2);
    expect(model.reagraphEdges).toHaveLength(1);
    expect(model.reagraphEdges[0]?.source).toBe('note-1');
    expect(model.reagraphEdges[0]?.target).toBe('topic-1');
    expect(model.nodeById.get('note-1')?.label).toBe('Nota conectada');
  });

  test('creates stable finite 3D positions with actual depth', () => {
    const data = {
      totalNodes: 5,
      totalEdges: 3,
      nodes: Array.from({ length: 5 }, (_, index) => ({
        id: `node-${index}`,
        key: `node:${index}`,
        label: `Node ${index}`,
        description: null,
        type: index === 0 ? ('topic' as const) : ('entity' as const),
        sourceType: 'MANUAL' as const,
        sourceId: null,
        weight: 5 - index,
        updatedAt: '2026-07-15T00:00:00.000Z',
      })),
      edges: [
        {
          id: 'e-1',
          from: 'node-0',
          to: 'node-1',
          kind: 'related_to' as const,
          method: 'test',
          confidence: '1',
        },
        {
          id: 'e-2',
          from: 'node-0',
          to: 'node-2',
          kind: 'related_to' as const,
          method: 'test',
          confidence: '1',
        },
        {
          id: 'e-3',
          from: 'node-3',
          to: 'node-4',
          kind: 'related_to' as const,
          method: 'test',
          confidence: '1',
        },
      ],
    };

    const first = buildGraphPositions3D(data);
    const second = buildGraphPositions3D(data);

    expect([...first.entries()]).toEqual([...second.entries()]);
    expect(first.size).toBe(5);
    for (const position of first.values()) {
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
      expect(Number.isFinite(position.z)).toBe(true);
    }
    expect(
      new Set([...first.values()].map((position) => position.z.toFixed(3))).size,
    ).toBeGreaterThan(1);
  });

  test('defaults to 3D and scales visual work down for dense graphs', () => {
    expect(DEFAULT_GRAPH_MODE).toBe('3d');

    const detailed = resolveGraphRenderProfile(60, 120, false);
    expect(detailed.tier).toBe('detailed');
    expect(detailed.animated).toBe(true);
    expect(detailed.edgeInterpolation).toBe('curved');

    const balanced = resolveGraphRenderProfile(220, 650, false);
    expect(balanced.tier).toBe('balanced');
    expect(balanced.animated).toBe(false);

    const dense = resolveGraphRenderProfile(500, 1_500, false);
    expect(dense.tier).toBe('dense');
    expect(dense.labelType).toBe('none');
    expect(dense.edgeInterpolation).toBe('linear');
    expect(dense.draggable).toBe(false);
  });
});

describe('nodePath', () => {
  function makeNode(over: Partial<Parameters<typeof nodePath>[0]>): Parameters<typeof nodePath>[0] {
    return {
      id: 'n',
      key: 'k',
      label: 'L',
      description: null,
      type: 'transcript',
      sourceType: null,
      sourceId: null,
      weight: 1,
      updatedAt: '2026-01-01T00:00:00Z',
      ...over,
    };
  }

  test('maps transcript/note sources to routes and returns null otherwise', () => {
    expect(nodePath(makeNode({ sourceType: 'TRANSCRIPT', sourceId: 't1' }))).toBe(
      '/transcricoes/t1',
    );
    expect(nodePath(makeNode({ sourceType: 'NOTE', sourceId: 'n2' }))).toBe('/notas/n2');
    // sourceType sem rota dedicada → null, mesmo com sourceId
    expect(nodePath(makeNode({ sourceType: 'FOLDER', sourceId: 'f1' }))).toBeNull();
    expect(nodePath(makeNode({ sourceType: null, sourceId: 's1' }))).toBeNull();
    // sem sourceId → null
    expect(nodePath(makeNode({ sourceType: 'TRANSCRIPT', sourceId: null }))).toBeNull();
  });
});
