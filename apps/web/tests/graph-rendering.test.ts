import { describe, expect, test } from 'bun:test';
import { EDGE_COLORS, NODE_COLORS, buildGraphLayout } from '../src/client/pages/grafo';

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
    const layout = buildGraphLayout({
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
    });

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
});
