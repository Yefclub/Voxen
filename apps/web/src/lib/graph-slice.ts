/**
 * Recorte do grafo para UI rápida (spec 103).
 * Funções puras — testáveis sem DB/Redis.
 */

export type GraphSliceView = 'map' | 'full';

export type SliceNode = {
  id: string;
  type: string;
  weight: number;
  updatedAt: string;
};

export type SliceEdge = {
  id: string;
  from: string;
  to: string;
  kind: string;
  method: string;
  confidence: string | number;
};

export const MAP_NODE_LIMIT = 180;
export const MAP_EDGE_LIMIT = 400;
export const FULL_NODE_LIMIT = 500;
export const FULL_EDGE_LIMIT = 1_500;
/** RELATED_TO fracos abaixo disso somem do map view. */
export const MAP_MIN_RELATED_CONFIDENCE = 0.55;

const STRUCTURAL_METHODS = [
  'wikilink',
  'folder',
  'belongs',
  'manual',
  'hierarchy',
  'llm-grounded',
  'community',
];
const WEAK_METHODS = [
  'keyword',
  'shared-concepts',
  'shared_concepts',
  'semantic-profile',
  'semantic_profile',
  'timeline-adjacent',
  'timeline_adjacent',
  'entity-heuristic',
];

export function parseGraphView(raw: string | undefined | null): GraphSliceView {
  return raw === 'map' ? 'map' : 'full';
}

export function parseGraphHops(raw: string | undefined | null): number {
  const n = Number(raw ?? 1);
  if (!Number.isFinite(n)) return 1;
  return Math.min(2, Math.max(1, Math.trunc(n)));
}

export function isStructuralEdge(edge: Pick<SliceEdge, 'kind' | 'method'>): boolean {
  const method = edge.method.toLowerCase();
  const kind = edge.kind.toLowerCase();
  if (kind === 'links_to' || kind === 'belongs_to' || kind === 'part_of') return true;
  return STRUCTURAL_METHODS.some((token) => method.includes(token));
}

export function isWeakInferredEdge(
  edge: Pick<SliceEdge, 'kind' | 'method' | 'confidence'>,
): boolean {
  if (isStructuralEdge(edge)) return false;
  const method = edge.method.toLowerCase();
  const conf = typeof edge.confidence === 'number' ? edge.confidence : Number(edge.confidence);
  const confOk = Number.isFinite(conf) ? conf : 0;
  const weakMethod = WEAK_METHODS.some((token) => method.includes(token));
  const related =
    edge.kind.toLowerCase() === 'related_to' || edge.kind.toLowerCase() === 'mentions';
  if (!related && !weakMethod) return confOk < MAP_MIN_RELATED_CONFIDENCE;
  return weakMethod && confOk < MAP_MIN_RELATED_CONFIDENCE;
}

function nodePriority(type: string): number {
  switch (type) {
    case 'transcript':
    case 'content':
      return 0;
    case 'note':
      return 1;
    case 'folder':
      return 2;
    case 'cluster':
      return 3;
    case 'topic':
      return 4;
    case 'entity':
      return 5;
    default:
      return 6;
  }
}

function isConceptType(type: string): boolean {
  return type === 'topic' || type === 'entity' || type === 'claim' || type === 'event';
}

/**
 * Seleciona o subgrafo para a UI.
 * - map: conteúdos/pastas + conceitos com grau≥2 + arestas fortes
 * - full: só aplica caps defensivos
 * - focus: ego-network a N hops
 */
export function selectGraphSlice<N extends SliceNode, E extends SliceEdge>(input: {
  nodes: N[];
  edges: E[];
  view: GraphSliceView;
  focusId?: string | null;
  hops?: number;
}): { nodes: N[]; edges: E[]; truncated: boolean; view: GraphSliceView } {
  const { nodes, edges, view } = input;
  const focusId = input.focusId?.trim() || null;
  const hops = input.hops ?? 1;

  if (focusId) {
    const neighborhood = egoNetwork(nodes, edges, focusId, hops);
    return { ...neighborhood, truncated: false, view };
  }

  if (view === 'full') {
    const cappedNodes = nodes.slice(0, FULL_NODE_LIMIT);
    const ids = new Set(cappedNodes.map((n) => n.id));
    const cappedEdges = edges
      .filter((e) => ids.has(e.from) && ids.has(e.to))
      .slice(0, FULL_EDGE_LIMIT);
    return {
      nodes: cappedNodes,
      edges: cappedEdges,
      truncated: nodes.length > cappedNodes.length || edges.length > cappedEdges.length,
      view,
    };
  }

  // --- map view ---
  const degree = new Map<string, number>();
  for (const edge of edges) {
    if (isWeakInferredEdge(edge)) continue;
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }

  const candidates = nodes.filter((node) => {
    if (!isConceptType(node.type)) return true;
    return (degree.get(node.id) ?? 0) >= 2 || node.weight >= 3;
  });

  const ranked = [...candidates].sort((a, b) => {
    const pa = nodePriority(a.type);
    const pb = nodePriority(b.type);
    if (pa !== pb) return pa - pb;
    const da = degree.get(a.id) ?? 0;
    const db = degree.get(b.id) ?? 0;
    if (db !== da) return db - da;
    if (b.weight !== a.weight) return b.weight - a.weight;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  const selected = ranked.slice(0, MAP_NODE_LIMIT);
  const ids = new Set(selected.map((n) => n.id));
  const strongEdges = edges
    .filter((e) => ids.has(e.from) && ids.has(e.to) && !isWeakInferredEdge(e))
    .sort((a, b) => {
      const ca = Number(a.confidence) || 0;
      const cb = Number(b.confidence) || 0;
      return cb - ca;
    })
    .slice(0, MAP_EDGE_LIMIT);

  // Remove conceitos que ficaram isolados após o corte de arestas.
  const liveDegree = new Map<string, number>();
  for (const edge of strongEdges) {
    liveDegree.set(edge.from, (liveDegree.get(edge.from) ?? 0) + 1);
    liveDegree.set(edge.to, (liveDegree.get(edge.to) ?? 0) + 1);
  }
  const finalNodes = selected.filter((node) => {
    if (!isConceptType(node.type)) return true;
    return (liveDegree.get(node.id) ?? 0) >= 1;
  });
  const finalIds = new Set(finalNodes.map((n) => n.id));
  const finalEdges = strongEdges.filter((e) => finalIds.has(e.from) && finalIds.has(e.to));

  const withClusters = injectClusterHubs(finalNodes, finalEdges);
  // Cap final após hubs virtuais (clusters contam no budget do mapa).
  const cappedNodes = withClusters.nodes.slice(0, MAP_NODE_LIMIT + 24);
  const cappedIds = new Set(cappedNodes.map((n) => n.id));
  const cappedEdges = withClusters.edges
    .filter((e) => cappedIds.has(e.from) && cappedIds.has(e.to))
    .slice(0, MAP_EDGE_LIMIT + 48);
  return {
    nodes: cappedNodes,
    edges: cappedEdges,
    truncated:
      nodes.length > finalNodes.length ||
      edges.length > finalEdges.length ||
      ranked.length > MAP_NODE_LIMIT ||
      withClusters.nodes.length > cappedNodes.length,
    view,
  };
}

/**
 * Comunidades com ≥3 nós viram um hub virtual `cluster` (spec 104).
 * Union-Find simples sobre arestas do recorte.
 */
export function injectClusterHubs<N extends SliceNode, E extends SliceEdge>(
  nodes: N[],
  edges: E[],
): { nodes: N[]; edges: E[] } {
  if (nodes.length < 3) return { nodes, edges };
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let p = parent.get(x) ?? x;
    if (p !== x) {
      p = find(p);
      parent.set(x, p);
    }
    return p;
  };
  for (const n of nodes) parent.set(n.id, n.id);
  for (const e of edges) {
    if (!parent.has(e.from) || !parent.has(e.to)) continue;
    const a = find(e.from);
    const b = find(e.to);
    if (a !== b) parent.set(a, b);
  }
  const groups = new Map<string, N[]>();
  for (const n of nodes) {
    const root = find(n.id);
    const list = groups.get(root) ?? [];
    list.push(n);
    groups.set(root, list);
  }

  const extraNodes: N[] = [];
  const extraEdges: E[] = [];
  let clusterIdx = 0;
  for (const members of groups.values()) {
    if (members.length < 3) continue;
    const hub = [...members].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))[0]!;
    const clusterId = `cluster:virtual:${clusterIdx}`;
    clusterIdx += 1;
    const clusterNode = {
      ...hub,
      id: clusterId,
      type: 'cluster',
      weight: Math.max(hub.weight, members.length),
    } as N;
    extraNodes.push(clusterNode);
    for (const member of members.slice(0, 12)) {
      if (member.id === hub.id) continue;
      extraEdges.push({
        id: `cluster-edge:${clusterId}:${member.id}`,
        from: clusterId,
        to: member.id,
        kind: 'part_of',
        method: 'community',
        confidence: 0.85,
      } as E);
    }
  }
  if (extraNodes.length === 0) return { nodes, edges };
  return { nodes: [...nodes, ...extraNodes], edges: [...edges, ...extraEdges] };
}

function egoNetwork<N extends SliceNode, E extends SliceEdge>(
  nodes: N[],
  edges: E[],
  focusId: string,
  hops: number,
): { nodes: N[]; edges: E[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (!byId.has(focusId)) return { nodes: [], edges: [] };

  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    if (isWeakInferredEdge(edge)) continue;
    const a = adj.get(edge.from) ?? [];
    a.push(edge.to);
    adj.set(edge.from, a);
    const b = adj.get(edge.to) ?? [];
    b.push(edge.from);
    adj.set(edge.to, b);
  }

  const keep = new Set<string>([focusId]);
  let frontier = [focusId];
  for (let depth = 0; depth < hops; depth += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (keep.has(nb)) continue;
        keep.add(nb);
        next.push(nb);
      }
    }
    frontier = next;
  }

  const outNodes = nodes.filter((n) => keep.has(n.id));
  const outEdges = edges.filter(
    (e) => keep.has(e.from) && keep.has(e.to) && !isWeakInferredEdge(e),
  );
  return { nodes: outNodes, edges: outEdges };
}
