import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  EDGE_COLORS,
  NODE_COLORS,
  buildGraphLayout,
  buildGraphPositions3D,
  buildSigmaGraphModel,
  nodePath,
  toOpaqueGraphColor,
} from '../src/client/lib/graph-model';
import { DEFAULT_GRAPH_MODE, resolveGraphRenderProfile } from '../src/client/lib/graph-renderer';

const SVG_SAFE_COLOR = /^(#[0-9a-f]{6}|rgba?\([^)]+\))$/i;
const GRAPH_PAGE_SOURCE = readFileSync(
  new URL('../src/client/pages/grafo.tsx', import.meta.url),
  'utf8',
);
const REAGRAPH_PATCH_SOURCE = readFileSync(
  new URL('../../../patches/reagraph@4.32.0.patch', import.meta.url),
  'utf8',
);
const ROOT_DOCKERFILE_SOURCE = readFileSync(
  new URL('../../../Dockerfile', import.meta.url),
  'utf8',
);
const WEB_DOCKERFILE_SOURCE = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

describe('graph rendering helpers', () => {
  test('uses SVG-compatible colors for graph styles', () => {
    const colors = [...Object.values(NODE_COLORS), ...Object.values(EDGE_COLORS)];

    expect(colors.length).toBeGreaterThan(0);
    for (const color of colors) {
      expect(color.toLowerCase()).not.toContain('oklch');
      expect(color).toMatch(SVG_SAFE_COLOR);
    }
  });

  test('converts transparent CSS colors to opaque RGB for Three.js', () => {
    expect(toOpaqueGraphColor('rgba(56, 189, 248, 0.72)')).toBe('#38bdf8');
    expect(toOpaqueGraphColor('rgb(148, 163, 184)')).toBe('#94a3b8');
    expect(toOpaqueGraphColor('#a78bfa')).toBe('#a78bfa');
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
    expect(model.reagraphEdges[0]?.fill).toBe('#38bdf8');
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
    expect(first.get('node-0')).toEqual({ x: 0, y: 0, z: 0 });
    expect(first.get('node-3')).not.toEqual({ x: 0, y: 0, z: 0 });
    for (const position of first.values()) {
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
      expect(Number.isFinite(position.z)).toBe(true);
    }
    expect(
      new Set([...first.values()].map((position) => position.z.toFixed(3))).size,
    ).toBeGreaterThan(1);

    const model = buildSigmaGraphModel(data);
    expect(model.primaryNodeIds).toEqual(['node-0', 'node-1', 'node-2']);
  });

  test('defaults to 2D and scales visual work down for dense graphs', () => {
    // Spec 103: 2D-first; 3D only on demand.
    expect(DEFAULT_GRAPH_MODE).toBe('2d');
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

describe('graph renderer lifecycle contracts', () => {
  test('keeps the 3D renderer persistent across data and theme updates', () => {
    expect(GRAPH_PAGE_SOURCE).toContain('void loadReagraph()');
    expect(GRAPH_PAGE_SOURCE).not.toContain('setReagraph(null)');
    expect(GRAPH_PAGE_SOURCE).toContain('}, [onFallback]);');
    expect(GRAPH_PAGE_SOURCE).toContain('nodes={model?.reagraphNodes ?? EMPTY_REAGRAPH_NODES}');
  });

  test('uses manual rotation and falls back on WebGL2 creation or context failures', () => {
    expect(GRAPH_PAGE_SOURCE).toContain('cameraMode="rotate"');
    expect(GRAPH_PAGE_SOURCE).not.toContain('cameraMode="orbit"');
    expect(GRAPH_PAGE_SOURCE).toContain("canvas.getContext('webgl2', GRAPH_GL_OPTIONS)");
    expect(GRAPH_PAGE_SOURCE).not.toContain("canvas.getContext('webgl')");
    expect(GRAPH_PAGE_SOURCE).toContain("addEventListener('webglcontextcreationerror'");
    expect(GRAPH_PAGE_SOURCE).toContain('<GraphRendererBoundary onFailure={onFallback}>');
  });

  test('reuses Sigma and applies caller WebGL options after Reagraph defaults', () => {
    expect(GRAPH_PAGE_SOURCE).toContain('renderer.setGraph(model.graph)');
    expect(GRAPH_PAGE_SOURCE).toContain(
      '[SigmaConstructor, hasModel, onOpen, onSelect, webglFailed]',
    );
    expect(REAGRAPH_PATCH_SOURCE.indexOf('+\t\t...GL_DEFAULTS')).toBeLessThan(
      REAGRAPH_PATCH_SOURCE.indexOf('+\t\t...glOptions'),
    );
  });

  test('copies pnpm patches before dependency installation in every image stage', () => {
    for (const source of [ROOT_DOCKERFILE_SOURCE, WEB_DOCKERFILE_SOURCE]) {
      expect(source.match(/COPY patches \.\/patches/g)?.length).toBe(2);
      const stages = source.split(/(?=FROM )/).filter((stage) => stage.includes('pnpm install'));
      expect(stages).toHaveLength(2);
      for (const stage of stages) {
        expect(stage.indexOf('COPY patches ./patches')).toBeLessThan(
          stage.indexOf('RUN pnpm install'),
        );
      }
    }
  });
});
