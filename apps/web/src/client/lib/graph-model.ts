import Graph from 'graphology';
import type { GraphEdge as ReagraphEdge, GraphNode as ReagraphNode } from 'reagraph';
import type { AppTheme } from './theme';
import type { TranslateFn } from './i18n';
import type { GraphIndexStatus } from '../../shared/graph-index';

export type GraphNodeType =
  | 'transcript'
  | 'note'
  | 'folder'
  | 'entity'
  | 'topic'
  | 'claim'
  | 'event'
  | 'cluster'
  | 'content';

export type GraphEdgeKind =
  | 'belongs_to'
  | 'links_to'
  | 'mentions'
  | 'supports'
  | 'contradicts'
  | 'same_as'
  | 'part_of'
  | 'related_to'
  | 'next_to';

export type GraphEvidence = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';

export interface GraphNode {
  id: string;
  key: string;
  label: string;
  description: string | null;
  type: GraphNodeType;
  source?: 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK' | 'X' | 'WEB' | 'UPLOAD';
  sourceType: 'TRANSCRIPT' | 'NOTE' | 'FOLDER' | 'JOB' | 'CHAT' | 'MANUAL' | null;
  sourceId: string | null;
  weight: number;
  updatedAt: string;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: GraphEdgeKind;
  method: string;
  confidence: string;
  evidence?: GraphEvidence;
}

export interface GraphHub {
  id: string;
  label: string;
  type: GraphNodeType;
  degree: number;
}

export interface GraphCommunity {
  id: number;
  size: number;
  label: string;
  nodeIds: string[];
}

export interface GraphInsights {
  hubs: GraphHub[];
  communities: GraphCommunity[];
  edgeEvidence: { extracted: number; inferred: number; ambiguous: number };
}

export interface GraphResp {
  nodes: GraphNode[];
  edges: GraphEdge[];
  totalNodes: number;
  totalEdges: number;
  insights?: GraphInsights;
  indexing?: boolean;
  indexStatus?: GraphIndexStatus;
  generatedAt?: string;
}

export interface GraphLayoutNode extends GraphNode {
  x: number;
  y: number;
  radius: number;
  labelLines: string[];
  communityId: number;
}

export interface GraphLayoutEdge extends GraphEdge {
  fromNode: GraphLayoutNode;
  toNode: GraphLayoutNode;
}

export interface GraphLayout {
  nodes: GraphLayoutNode[];
  edges: GraphLayoutEdge[];
  viewBox: { width: number; height: number };
}

export interface SigmaNodeAttributes {
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  type: 'circle';
  nodeType: GraphNodeType;
  communityId: number;
  zIndex: number;
  original: GraphNode;
}

export interface SigmaEdgeAttributes {
  size: number;
  color: string;
  kind: GraphEdgeKind;
  from: string;
  to: string;
  original: GraphEdge;
}

export interface SigmaGraphModel {
  data: GraphResp;
  graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>;
  layout: GraphLayout;
  neighborhoods: Map<string, Set<string>>;
  reagraphNodes: ReagraphNode[];
  reagraphEdges: ReagraphEdge[];
  positions3d: Map<string, GraphPosition3D>;
  topologyKey: string;
  nodeById: Map<string, GraphNode>;
}

export interface GraphPosition3D {
  x: number;
  y: number;
  z: number;
}

export interface GraphLayoutOptions {
  viewBox?: { width: number; height: number };
  minNodeRadius?: number;
  maxNodeRadius?: number;
}

export interface GraphPalette {
  canvas: string;
  label: string;
  selected: string;
  labelStroke: string;
  dimNode: string;
  dimEdge: string;
  neutralEdge: string;
  nodes: Record<GraphNodeType, string>;
  edges: Record<GraphEdgeKind, string>;
}

export const ALL_GRAPH_NODE_TYPES = [
  'transcript',
  'note',
  'folder',
  'entity',
  'topic',
  'claim',
  'event',
  'cluster',
  'content',
] as const satisfies readonly GraphNodeType[];

const GRAPH_VIEWBOX = { width: 1000, height: 620 };
const SOURCE_NODE_TYPES = new Set<GraphNodeType>(['transcript', 'note', 'folder']);
const MIN_VIEWBOX_ASPECT_RATIO = 0.4;
const MAX_VIEWBOX_ASPECT_RATIO = 2.5;
const DEFAULT_MIN_NODE_RADIUS = 13;
const DEFAULT_MAX_NODE_RADIUS = 32;
const TOUCH_MIN_NODE_RADIUS = 17;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export const NODE_COLORS: Record<GraphNodeType, string> = {
  transcript: '#a78bfa',
  note: '#34d399',
  folder: '#fbbf24',
  entity: '#38bdf8',
  topic: '#fb7185',
  claim: '#f472b6',
  event: '#2dd4bf',
  cluster: '#a3e635',
  content: '#94a3b8',
};

export const EDGE_COLORS: Record<GraphEdgeKind, string> = {
  belongs_to: 'rgba(251, 191, 36, 0.72)',
  links_to: 'rgba(167, 139, 250, 0.78)',
  mentions: 'rgba(56, 189, 248, 0.72)',
  supports: 'rgba(52, 211, 153, 0.76)',
  contradicts: 'rgba(248, 113, 113, 0.78)',
  same_as: 'rgba(203, 213, 225, 0.7)',
  part_of: 'rgba(45, 212, 191, 0.72)',
  related_to: 'rgba(148, 163, 184, 0.68)',
  next_to: 'rgba(163, 230, 53, 0.7)',
};

export function toOpaqueGraphColor(color: string): string {
  const match = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (!match) return color;
  return `#${match
    .slice(1, 4)
    .map((channel) =>
      Math.max(0, Math.min(255, Math.round(Number(channel))))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

const LIGHT_NODE_COLORS: Record<GraphNodeType, string> = {
  transcript: '#7c3aed',
  note: '#059669',
  folder: '#d97706',
  entity: '#0284c7',
  topic: '#e11d48',
  claim: '#db2777',
  event: '#0f766e',
  cluster: '#65a30d',
  content: '#64748b',
};

const LIGHT_EDGE_COLORS: Record<GraphEdgeKind, string> = {
  belongs_to: 'rgba(180, 83, 9, 0.62)',
  links_to: 'rgba(109, 40, 217, 0.66)',
  mentions: 'rgba(3, 105, 161, 0.62)',
  supports: 'rgba(4, 120, 87, 0.64)',
  contradicts: 'rgba(190, 18, 60, 0.68)',
  same_as: 'rgba(71, 85, 105, 0.56)',
  part_of: 'rgba(15, 118, 110, 0.62)',
  related_to: 'rgba(100, 116, 139, 0.52)',
  next_to: 'rgba(77, 124, 15, 0.6)',
};

export function resolveGraphPalette(theme: AppTheme): GraphPalette {
  if (theme === 'light') {
    return {
      canvas: '#f7f7f8',
      label: '#18181b',
      selected: '#18181b',
      labelStroke: '#f7f7f8',
      dimNode: 'rgba(161, 161, 170, 0.4)',
      dimEdge: 'rgba(161, 161, 170, 0.16)',
      neutralEdge: 'rgba(113, 113, 122, 0.28)',
      nodes: LIGHT_NODE_COLORS,
      edges: LIGHT_EDGE_COLORS,
    };
  }
  return {
    canvas: theme === 'emerald' ? '#19211f' : '#212121',
    label: '#ececec',
    selected: '#fafafa',
    labelStroke: theme === 'emerald' ? '#19211f' : '#212121',
    dimNode: 'rgba(82, 82, 91, 0.42)',
    dimEdge: 'rgba(82, 82, 91, 0.14)',
    neutralEdge: 'rgba(148, 163, 184, 0.34)',
    nodes: NODE_COLORS,
    edges: EDGE_COLORS,
  };
}

export function filterGraphData(
  data: GraphResp,
  query: string,
  activeTypes: ReadonlySet<GraphNodeType>,
): GraphResp {
  const allowedNodes = data.nodes.filter((node) => activeTypes.has(node.type));
  const allowedIds = new Set(allowedNodes.map((node) => node.id));
  const needle = query.trim().toLocaleLowerCase();
  let visibleIds = allowedIds;

  if (needle) {
    const directIds = new Set(
      allowedNodes
        .filter((node) => searchableNodeText(node).includes(needle))
        .map((node) => node.id),
    );
    visibleIds = new Set(directIds);
    for (const edge of data.edges) {
      if (directIds.has(edge.from) && allowedIds.has(edge.to)) visibleIds.add(edge.to);
      if (directIds.has(edge.to) && allowedIds.has(edge.from)) visibleIds.add(edge.from);
    }
  }

  const nodes = allowedNodes.filter((node) => visibleIds.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = data.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const filtered: GraphResp = {
    ...data,
    nodes,
    edges,
    totalNodes: nodes.length,
    totalEdges: edges.length,
  };
  return { ...filtered, insights: buildGraphInsights(filtered) };
}

export function buildGraphCommunities(data: GraphResp): GraphCommunity[] {
  const nodeIds = new Set(data.nodes.map((node) => node.id));
  const parent = new Map<string, string>(data.nodes.map((node) => [node.id, node.id]));
  const degree = graphDegrees(data.edges);

  const find = (id: string): string => {
    let root = parent.get(id) ?? id;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root) ?? root;
    let cursor = id;
    while ((parent.get(cursor) ?? cursor) !== root) {
      const next = parent.get(cursor) ?? root;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (from: string, to: string): void => {
    const fromRoot = find(from);
    const toRoot = find(to);
    if (fromRoot !== toRoot) parent.set(toRoot, fromRoot);
  };

  for (const edge of data.edges) {
    if (nodeIds.has(edge.from) && nodeIds.has(edge.to)) union(edge.from, edge.to);
  }

  const groups = new Map<string, GraphNode[]>();
  for (const node of data.nodes) {
    const root = find(node.id);
    const group = groups.get(root) ?? [];
    group.push(node);
    groups.set(root, group);
  }

  return [...groups.values()]
    .map((nodes) => {
      const ordered = [...nodes].sort(
        (a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || compareGraphNodes(a, b),
      );
      return { label: ordered[0]?.label ?? '', nodeIds: ordered.map((node) => node.id) };
    })
    .sort((a, b) => b.nodeIds.length - a.nodeIds.length || a.label.localeCompare(b.label))
    .map((community, id) => ({
      id,
      size: community.nodeIds.length,
      label: community.label,
      nodeIds: community.nodeIds,
    }));
}

export function buildGraphInsights(data: GraphResp): GraphInsights {
  const degree = graphDegrees(data.edges);
  const hubs = [...data.nodes]
    .map<GraphHub>((node) => ({
      id: node.id,
      label: node.label,
      type: node.type,
      degree: degree.get(node.id) ?? 0,
    }))
    .filter((hub) => hub.degree > 0)
    .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label))
    .slice(0, 12);
  const edgeEvidence = { extracted: 0, inferred: 0, ambiguous: 0 };
  for (const edge of data.edges) {
    const evidence = edge.evidence ?? inferEdgeEvidence(edge);
    if (evidence === 'EXTRACTED') edgeEvidence.extracted += 1;
    else if (evidence === 'INFERRED') edgeEvidence.inferred += 1;
    else edgeEvidence.ambiguous += 1;
  }
  return { hubs, communities: buildGraphCommunities(data), edgeEvidence };
}

export function buildSigmaGraphModel(
  data: GraphResp,
  translate?: TranslateFn,
  layoutOptions: GraphLayoutOptions = {},
  palette: GraphPalette = resolveGraphPalette('zinc'),
): SigmaGraphModel {
  const layout = buildGraphLayout(data, layoutOptions);
  const graph = new Graph<SigmaNodeAttributes, SigmaEdgeAttributes>({
    multi: true,
    type: 'undirected',
  });
  const neighborhoods = new Map<string, Set<string>>();
  const nodeById = new Map(layout.nodes.map((node) => [node.id, node as GraphNode]));
  const positions3d = buildGraphPositions3D(data);
  const reagraphNodes: ReagraphNode[] = layout.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    subLabel: translate ? translate(`graph.node.${node.type}`) : node.type,
    fill: palette.nodes[node.type],
    size: Math.max(3.5, Math.min(10, 4 + Math.sqrt(node.weight) * 1.25)),
    data: node,
  }));
  const reagraphEdges: ReagraphEdge[] = layout.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    label: translate ? translate(`graph.edge.${edge.kind}`) : edge.kind,
    size: edge.kind === 'links_to' ? 1.8 : edge.kind === 'related_to' ? 1.25 : 1,
    fill: toOpaqueGraphColor(palette.edges[edge.kind]),
    data: edge,
  }));

  for (const node of layout.nodes) {
    neighborhoods.set(node.id, new Set([node.id]));
    graph.addNode(node.id, {
      x: (node.x - layout.viewBox.width / 2) / 150,
      y: (node.y - layout.viewBox.height / 2) / 150,
      size: Math.max(3.5, Math.min(10, node.radius / 3)),
      color: palette.nodes[node.type],
      label: node.label,
      type: 'circle',
      nodeType: node.type,
      communityId: node.communityId,
      zIndex: SOURCE_NODE_TYPES.has(node.type) ? 2 : 1,
      original: node,
    });
  }

  for (const edge of layout.edges) {
    if (!graph.hasNode(edge.from) || !graph.hasNode(edge.to)) continue;
    neighborhoods.get(edge.from)?.add(edge.to);
    neighborhoods.get(edge.to)?.add(edge.from);
    graph.addUndirectedEdgeWithKey(edge.id, edge.from, edge.to, {
      size: edge.kind === 'links_to' ? 1.7 : 1,
      color: palette.edges[edge.kind],
      kind: edge.kind,
      from: edge.from,
      to: edge.to,
      original: edge,
    });
  }

  return {
    data,
    graph,
    layout,
    neighborhoods,
    reagraphNodes,
    reagraphEdges,
    positions3d,
    topologyKey: graphTopologyKey(data),
    nodeById,
  };
}

export function buildGraphPositions3D(data: GraphResp): Map<string, GraphPosition3D> {
  const communities = buildGraphCommunities(data);
  const positions = new Map<string, GraphPosition3D>();
  const communityPhase = hashAngle(communities.map((community) => community.label).join('|'));
  const communityOrbit =
    communities.length <= 1
      ? 0
      : Math.min(1_150, 420 + Math.sqrt(Math.max(data.nodes.length, 1)) * 24);

  for (const community of communities) {
    const center = fibonacciSpherePoint(
      community.id,
      communities.length,
      communityOrbit,
      communityPhase,
    );
    const localExtent = Math.min(330, 90 + Math.sqrt(community.size) * 15);
    const angleOffset = hashAngle(community.label);

    community.nodeIds.forEach((nodeId, index) => {
      if (index === 0) {
        positions.set(nodeId, center);
        return;
      }

      const progress = Math.cbrt(index / Math.max(community.size - 1, 1));
      const localRadius = localExtent * (0.22 + progress * 0.78);
      const direction = fibonacciSpherePoint(
        index - 1,
        Math.max(community.size - 1, 1),
        localRadius,
        hashAngle(nodeId) + angleOffset,
      );
      positions.set(nodeId, {
        x: center.x + direction.x,
        y: center.y + direction.y,
        z: center.z + direction.z,
      });
    });
  }

  for (const node of data.nodes) {
    if (!positions.has(node.id)) positions.set(node.id, { x: 0, y: 0, z: 0 });
  }
  if (positions.size > 0) {
    const values = [...positions.values()];
    const center = {
      x:
        (Math.min(...values.map((position) => position.x)) +
          Math.max(...values.map((position) => position.x))) /
        2,
      y:
        (Math.min(...values.map((position) => position.y)) +
          Math.max(...values.map((position) => position.y))) /
        2,
      z:
        (Math.min(...values.map((position) => position.z)) +
          Math.max(...values.map((position) => position.z))) /
        2,
    };
    for (const position of positions.values()) {
      position.x -= center.x;
      position.y -= center.y;
      position.z -= center.z;
    }
  }
  return positions;
}

export function buildGraphLayout(data: GraphResp, options: GraphLayoutOptions = {}): GraphLayout {
  const viewBox = options.viewBox ?? GRAPH_VIEWBOX;
  const minNodeRadius = options.minNodeRadius ?? DEFAULT_MIN_NODE_RADIUS;
  const maxNodeRadius = Math.max(minNodeRadius, options.maxNodeRadius ?? DEFAULT_MAX_NODE_RADIUS);
  const degree = graphDegrees(data.edges);
  const communities = buildGraphCommunities(data);
  const positions = new Map<string, { x: number; y: number; communityId: number }>();
  const aspect = viewBox.width / viewBox.height;
  const columns = Math.max(
    1,
    Math.min(communities.length, Math.ceil(Math.sqrt(communities.length * aspect))),
  );
  const rows = Math.max(1, Math.ceil(communities.length / columns));
  const cellWidth = viewBox.width / columns;
  const cellHeight = viewBox.height / rows;

  for (const community of communities) {
    const column = community.id % columns;
    const row = Math.floor(community.id / columns);
    const center = { x: (column + 0.5) * cellWidth, y: (row + 0.5) * cellHeight };
    const maxRadius = Math.max(24, Math.min(cellWidth, cellHeight) * 0.38);
    const angleOffset = ((hashString(community.label) % 360) * Math.PI) / 180;
    community.nodeIds.forEach((nodeId, index) => {
      if (index === 0) {
        positions.set(nodeId, { ...center, communityId: community.id });
        return;
      }
      const progress = Math.sqrt(index / Math.max(community.nodeIds.length - 1, 1));
      const angle = angleOffset + index * GOLDEN_ANGLE;
      const point = polarPoint(center, maxRadius * progress, angle);
      positions.set(nodeId, { ...point, communityId: community.id });
    });
  }

  const layoutNodes = [...data.nodes].sort(compareGraphNodes).map<GraphLayoutNode>((node) => {
    const point = positions.get(node.id) ?? {
      x: viewBox.width / 2,
      y: viewBox.height / 2,
      communityId: 0,
    };
    const radius = clamp(
      11 + Math.min(degree.get(node.id) ?? 0, 8) * 2.3,
      minNodeRadius,
      maxNodeRadius,
    );
    return {
      ...node,
      ...clampPoint(point, 58, viewBox.width - 58, 56, viewBox.height - 74),
      communityId: point.communityId,
      radius: radius + (SOURCE_NODE_TYPES.has(node.type) ? 3 : 0),
      labelLines: splitGraphLabel(node.label),
    };
  });
  const layoutById = new Map(layoutNodes.map((node) => [node.id, node]));
  const layoutEdges = data.edges
    .map<GraphLayoutEdge | null>((edge) => {
      const fromNode = layoutById.get(edge.from);
      const toNode = layoutById.get(edge.to);
      return fromNode && toNode ? { ...edge, fromNode, toNode } : null;
    })
    .filter((edge): edge is GraphLayoutEdge => edge !== null);
  return { nodes: layoutNodes, edges: layoutEdges, viewBox };
}

export function nodePath(node: GraphNode): string | null {
  if (!node.sourceId) return null;
  if (node.sourceType === 'TRANSCRIPT') return `/transcricoes/${node.sourceId}`;
  if (node.sourceType === 'NOTE') return `/notas/${node.sourceId}`;
  return null;
}

export function resolveGraphViewBox(
  containerWidth: number,
  containerHeight: number,
): { width: number; height: number } {
  if (!(containerWidth > 0) || !(containerHeight > 0)) return GRAPH_VIEWBOX;
  const area = GRAPH_VIEWBOX.width * GRAPH_VIEWBOX.height;
  const aspect = clamp(
    containerWidth / containerHeight,
    MIN_VIEWBOX_ASPECT_RATIO,
    MAX_VIEWBOX_ASPECT_RATIO,
  );
  const height = Math.sqrt(area / aspect);
  return { width: Math.round(aspect * height), height: Math.round(height) };
}

export function resolveNodeRadiusBounds(coarsePointer: boolean): { min: number; max: number } {
  return {
    min: coarsePointer ? TOUCH_MIN_NODE_RADIUS : DEFAULT_MIN_NODE_RADIUS,
    max: DEFAULT_MAX_NODE_RADIUS,
  };
}

export function edgePath(edge: GraphLayoutEdge): string {
  const { fromNode, toNode } = edge;
  const midX = (fromNode.x + toNode.x) / 2;
  const midY = (fromNode.y + toNode.y) / 2;
  const dx = toNode.x - fromNode.x;
  const dy = toNode.y - fromNode.y;
  const length = Math.hypot(dx, dy) || 1;
  const curve = ((hashString(edge.id) % 7) - 3) * 5;
  const cx = midX + (-dy / length) * curve;
  const cy = midY + (dx / length) * curve;
  return `M ${fromNode.x.toFixed(1)} ${fromNode.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${toNode.x.toFixed(1)} ${toNode.y.toFixed(1)}`;
}

function graphDegrees(edges: GraphEdge[]): Map<string, number> {
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  return degree;
}

function fibonacciSpherePoint(
  index: number,
  total: number,
  radius: number,
  phase: number,
): GraphPosition3D {
  if (radius === 0) return { x: 0, y: 0, z: 0 };
  if (total <= 1) return { x: Math.cos(phase) * radius, y: 0, z: Math.sin(phase) * radius };
  const normalized = (index + 0.5) / total;
  const y = 1 - normalized * 2;
  const radial = Math.sqrt(Math.max(0, 1 - y * y));
  const angle = phase + index * GOLDEN_ANGLE;
  return {
    x: Math.cos(angle) * radial * radius,
    y: y * radius,
    z: Math.sin(angle) * radial * radius,
  };
}

function graphTopologyKey(data: GraphResp): string {
  let hash = 2_166_136_261;
  const add = (value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619) >>> 0;
    }
  };
  for (const node of data.nodes) add(node.id);
  for (const edge of data.edges) add(`${edge.id}:${edge.from}:${edge.to}`);
  return `${data.nodes.length}:${data.edges.length}:${hash.toString(36)}`;
}

function hashAngle(value: string): number {
  return ((hashString(value) % 360) * Math.PI) / 180;
}

function searchableNodeText(node: GraphNode): string {
  return [node.label, node.description, node.key, node.type, node.source, node.sourceType]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
}

function inferEdgeEvidence(edge: GraphEdge): GraphEvidence {
  const method = edge.method.toLocaleLowerCase();
  if (
    method.includes('wikilink') ||
    method.includes('folder') ||
    edge.kind === 'links_to' ||
    edge.kind === 'belongs_to'
  )
    return 'EXTRACTED';
  if (method.includes('keyword') || method.includes('shared') || edge.kind === 'related_to')
    return 'INFERRED';
  return 'AMBIGUOUS';
}

function compareGraphNodes(a: GraphNode, b: GraphNode): number {
  const priority: Record<GraphNodeType, number> = {
    transcript: 0,
    folder: 1,
    note: 2,
    topic: 3,
    entity: 4,
    claim: 5,
    event: 6,
    cluster: 7,
    content: 8,
  };
  return (
    priority[a.type] - priority[b.type] || b.weight - a.weight || a.label.localeCompare(b.label)
  );
}

function polarPoint(
  center: { x: number; y: number },
  radius: number,
  angle: number,
): { x: number; y: number } {
  return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
}

function clampPoint(
  point: { x: number; y: number },
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): { x: number; y: number } {
  return { x: clamp(point.x, minX, maxX), y: clamp(point.y, minY, maxY) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function splitGraphLabel(label: string): string[] {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || current.length + word.length + 1 > 20) lines.push(word.slice(0, 22));
    else lines[lines.length - 1] = `${current} ${word}`;
    if (lines.length === 2) break;
  }
  if (lines.length === 0) return ['Sem título'];
  if (words.join(' ').length > lines.join(' ').length)
    lines[lines.length - 1] = `${lines.at(-1)?.replace(/\.*$/, '')}...`;
  return lines;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1)
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash;
}
