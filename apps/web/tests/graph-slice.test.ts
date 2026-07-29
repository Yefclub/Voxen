import { describe, expect, test } from 'bun:test';
import {
  MAP_EDGE_LIMIT,
  MAP_NODE_LIMIT,
  isStructuralEdge,
  isWeakInferredEdge,
  parseGraphHops,
  parseGraphView,
  selectGraphSlice,
} from '../src/lib/graph-slice';

function node(id: string, type: string, weight = 1, updatedAt = '2026-07-01T00:00:00.000Z') {
  return { id, type, weight, updatedAt };
}

function edge(
  id: string,
  from: string,
  to: string,
  opts: { kind?: string; method?: string; confidence?: number } = {},
) {
  return {
    id,
    from,
    to,
    kind: opts.kind ?? 'related_to',
    method: opts.method ?? 'shared-concepts',
    confidence: opts.confidence ?? 0.4,
  };
}

describe('graph-slice parsers', () => {
  test('view defaults to full while preserving explicit legacy map requests', () => {
    expect(parseGraphView(undefined)).toBe('full');
    expect(parseGraphView('full')).toBe('full');
    expect(parseGraphView('map')).toBe('map');
    expect(parseGraphView('nope')).toBe('full');
  });

  test('hops clamps 1..2', () => {
    expect(parseGraphHops(undefined)).toBe(1);
    expect(parseGraphHops('0')).toBe(1);
    expect(parseGraphHops('2')).toBe(2);
    expect(parseGraphHops('9')).toBe(2);
  });
});

describe('edge strength', () => {
  test('wikilink and folder are structural', () => {
    expect(isStructuralEdge({ kind: 'links_to', method: 'wikilink' })).toBe(true);
    expect(isStructuralEdge({ kind: 'belongs_to', method: 'folder' })).toBe(true);
  });

  test('low-confidence shared-concepts is weak', () => {
    expect(
      isWeakInferredEdge({
        kind: 'related_to',
        method: 'shared-concepts',
        confidence: 0.4,
      }),
    ).toBe(true);
    expect(
      isWeakInferredEdge({
        kind: 'related_to',
        method: 'shared-concepts',
        confidence: 0.8,
      }),
    ).toBe(false);
  });
});

describe('selectGraphSlice', () => {
  test('map drops isolated topics and weak edges', () => {
    const nodes = [
      node('t1', 'transcript', 5),
      node('t2', 'transcript', 4),
      node('topic-noise', 'topic', 1),
      node('topic-hub', 'topic', 2),
    ];
    const edges = [
      edge('e1', 't1', 't2', { method: 'shared-concepts', confidence: 0.8 }),
      edge('e2', 't1', 'topic-hub', { method: 'keyword', confidence: 0.7 }),
      edge('e3', 't2', 'topic-hub', { method: 'keyword', confidence: 0.7 }),
      edge('e4', 't1', 'topic-noise', { method: 'keyword', confidence: 0.3 }),
    ];
    const result = selectGraphSlice({ nodes, edges, view: 'map' });
    expect(result.view).toBe('map');
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain('t1');
    expect(ids).toContain('t2');
    expect(ids).toContain('topic-hub');
    expect(ids).not.toContain('topic-noise');
    expect(result.edges.some((e) => e.id === 'e4')).toBe(false);
    expect(result.edges.length).toBeGreaterThan(0);
  });

  test('map respects node/edge caps', () => {
    const nodes = Array.from({ length: MAP_NODE_LIMIT + 40 }, (_, i) =>
      node(`n${i}`, i % 5 === 0 ? 'topic' : 'transcript', 10 - (i % 3)),
    );
    const edges = Array.from({ length: MAP_EDGE_LIMIT + 80 }, (_, i) =>
      edge(`e${i}`, `n${i % nodes.length}`, `n${(i + 1) % nodes.length}`, {
        method: 'wikilink',
        confidence: 0.9,
        kind: 'links_to',
      }),
    );
    const result = selectGraphSlice({ nodes, edges, view: 'map' });
    // Budget + margem para hubs de cluster virtuais.
    expect(result.nodes.length).toBeLessThanOrEqual(MAP_NODE_LIMIT + 24);
    expect(result.edges.length).toBeLessThanOrEqual(MAP_EDGE_LIMIT + 48);
    expect(result.truncated).toBe(true);
  });

  test('focus returns ego-network with structural neighbors', () => {
    const nodes = [node('a', 'transcript'), node('b', 'note'), node('c', 'transcript')];
    const edges = [
      edge('ab', 'a', 'b', { method: 'wikilink', kind: 'links_to', confidence: 0.9 }),
      edge('bc', 'b', 'c', { method: 'wikilink', kind: 'links_to', confidence: 0.9 }),
    ];
    const hop1 = selectGraphSlice({ nodes, edges, view: 'map', focusId: 'a', hops: 1 });
    expect(hop1.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    const hop2 = selectGraphSlice({ nodes, edges, view: 'map', focusId: 'a', hops: 2 });
    expect(hop2.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
  });

  test('unknown focus yields empty graph', () => {
    const result = selectGraphSlice({
      nodes: [node('a', 'transcript')],
      edges: [],
      view: 'map',
      focusId: 'missing',
    });
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  test('map injects cluster hubs for communities with 3+ members', () => {
    const nodes = [
      node('a', 'transcript', 5),
      node('b', 'transcript', 4),
      node('c', 'transcript', 3),
    ];
    const edges = [
      edge('ab', 'a', 'b', { method: 'wikilink', kind: 'links_to', confidence: 0.9 }),
      edge('bc', 'b', 'c', { method: 'wikilink', kind: 'links_to', confidence: 0.9 }),
    ];
    const result = selectGraphSlice({ nodes, edges, view: 'map' });
    expect(result.nodes.some((n) => n.type === 'cluster')).toBe(true);
    expect(result.edges.some((e) => e.method === 'community')).toBe(true);
  });
});
