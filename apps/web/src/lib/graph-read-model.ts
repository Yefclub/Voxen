import type { Prisma } from '../../prisma-generated/client';
import { db } from './db';
import {
  FULL_EDGE_LIMIT,
  FULL_NODE_LIMIT,
  type GraphSliceView,
  selectGraphSlice,
} from './graph-slice';

export interface GraphReadNode {
  id: string;
  key: string;
  label: string;
  description: string | null;
  type:
    | 'transcript'
    | 'note'
    | 'folder'
    | 'entity'
    | 'topic'
    | 'claim'
    | 'event'
    | 'cluster'
    | 'content';
  source?: 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK' | 'X' | 'WEB' | 'UPLOAD';
  sourceType:
    | 'TRANSCRIPT'
    | 'NOTE'
    | 'FOLDER'
    | 'JOB'
    | 'CHAT'
    | 'MANUAL'
    | 'EXTERNAL_ENRICHMENT'
    | null;
  sourceId: string | null;
  transcriptId?: string;
  weight: number;
  updatedAt: string;
}

export interface GraphReadEdge {
  id: string;
  from: string;
  to: string;
  kind:
    | 'belongs_to'
    | 'links_to'
    | 'mentions'
    | 'supports'
    | 'contradicts'
    | 'same_as'
    | 'part_of'
    | 'related_to'
    | 'next_to';
  method: string;
  confidence: string;
  evidence: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
}

const graphNodeSelect = {
  id: true,
  key: true,
  type: true,
  label: true,
  description: true,
  sourceType: true,
  sourceId: true,
  metadata: true,
  updatedAt: true,
} satisfies Prisma.BrainNodeSelect;

const graphEdgeSelect = {
  id: true,
  fromNodeId: true,
  toNodeId: true,
  kind: true,
  method: true,
  confidence: true,
} satisfies Prisma.BrainEdgeSelect;

type RawNode = Prisma.BrainNodeGetPayload<{ select: typeof graphNodeSelect }>;
type RawEdge = Prisma.BrainEdgeGetPayload<{ select: typeof graphEdgeSelect }>;
const CANONICAL_NODE_BUDGET = Math.floor(FULL_NODE_LIMIT * 0.72);

export interface GraphReadResult {
  nodes: GraphReadNode[];
  edges: GraphReadEdge[];
  candidateNodes: number;
  candidateEdges: number;
  truncated: boolean;
  view: GraphSliceView;
}

export async function readGraphSlice(input: {
  userId: string;
  view: GraphSliceView;
  focusId?: string | null;
  hops: number;
  includeArchived?: boolean;
}): Promise<GraphReadResult> {
  const { userId, view, hops } = input;
  const focusId = input.focusId?.trim() || null;
  const visibleStatus = input.includeArchived ? { not: 'TRASH' as const } : ('ACTIVE' as const);
  const [candidateNodes, candidateEdges] = await Promise.all([
    db.brainNode.count({ where: { userId, status: visibleStatus } }),
    db.brainEdge.count({
      where: {
        userId,
        status: visibleStatus,
        from: { status: visibleStatus, userId },
        to: { status: visibleStatus, userId },
      },
    }),
  ]);
  const bounded = focusId
    ? await readFocusedRecords(userId, focusId, hops, input.includeArchived ?? false)
    : await readRepresentativeRecords(userId);
  const degree = new Map<string, number>();
  for (const edge of bounded.edges) {
    degree.set(edge.fromNodeId, (degree.get(edge.fromNodeId) ?? 0) + 1);
    degree.set(edge.toNodeId, (degree.get(edge.toNodeId) ?? 0) + 1);
  }
  const allNodes = bounded.nodes.map((node) => toGraphReadNode(node, degree.get(node.id) ?? 0));
  const allEdges = bounded.edges.map(toGraphReadEdge);
  const sliced = selectGraphSlice({ nodes: allNodes, edges: allEdges, view, focusId, hops });
  return {
    nodes: sliced.nodes,
    edges: sliced.edges,
    candidateNodes,
    candidateEdges,
    truncated:
      bounded.truncated ||
      sliced.truncated ||
      (!focusId && (candidateNodes > sliced.nodes.length || candidateEdges > sliced.edges.length)),
    view: sliced.view,
  };
}

async function readRepresentativeRecords(userId: string): Promise<{
  nodes: RawNode[];
  edges: RawEdge[];
  truncated: boolean;
}> {
  const canonical = await db.brainNode.findMany({
    where: { userId, status: 'ACTIVE', type: { in: ['CONTENT', 'FOLDER'] } },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
    take: CANONICAL_NODE_BUDGET,
    select: graphNodeSelect,
  });
  const conceptBudget = FULL_NODE_LIMIT - canonical.length;
  const concepts = await db.brainNode.findMany({
    where: { userId, status: 'ACTIVE', type: { notIn: ['CONTENT', 'FOLDER'] } },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
    take: conceptBudget,
    select: graphNodeSelect,
  });
  const fillBudget = FULL_NODE_LIMIT - canonical.length - concepts.length;
  const canonicalFill =
    fillBudget > 0 && canonical.length === CANONICAL_NODE_BUDGET
      ? await db.brainNode.findMany({
          where: { userId, status: 'ACTIVE', type: { in: ['CONTENT', 'FOLDER'] } },
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
          skip: CANONICAL_NODE_BUDGET,
          take: fillBudget,
          select: graphNodeSelect,
        })
      : [];
  const nodes = [...canonical, ...concepts, ...canonicalFill];
  const nodeIds = nodes.map((node) => node.id);
  const edges =
    nodeIds.length === 0
      ? []
      : await db.brainEdge.findMany({
          where: {
            userId,
            status: 'ACTIVE',
            fromNodeId: { in: nodeIds },
            toNodeId: { in: nodeIds },
            from: { status: 'ACTIVE', userId },
            to: { status: 'ACTIVE', userId },
          },
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
          take: FULL_EDGE_LIMIT,
          select: graphEdgeSelect,
        });
  return { nodes, edges, truncated: false };
}

async function readFocusedRecords(
  userId: string,
  focusId: string,
  hops: number,
  includeArchived: boolean,
): Promise<{ nodes: RawNode[]; edges: RawEdge[]; truncated: boolean }> {
  const visibleStatus = includeArchived ? { not: 'TRASH' as const } : ('ACTIVE' as const);
  const focus = await db.brainNode.findFirst({
    where: { id: focusId, userId, status: visibleStatus },
    select: graphNodeSelect,
  });
  if (!focus) return { nodes: [], edges: [], truncated: false };
  const nodeIds = new Set([focus.id]);
  const edges = new Map<string, RawEdge>();
  let frontier = [focus.id];
  let truncated = false;
  for (let depth = 0; depth < hops && frontier.length > 0; depth += 1) {
    const remainingEdges = FULL_EDGE_LIMIT - edges.size;
    if (remainingEdges <= 0) {
      truncated = true;
      break;
    }
    const batch = await db.brainEdge.findMany({
      where: {
        userId,
        status: visibleStatus,
        ...(edges.size > 0 ? { id: { notIn: [...edges.keys()] } } : {}),
        OR: [{ fromNodeId: { in: frontier } }, { toNodeId: { in: frontier } }],
        from: { status: visibleStatus, userId },
        to: { status: visibleStatus, userId },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      take: remainingEdges + 1,
      select: graphEdgeSelect,
    });
    if (batch.length > remainingEdges) truncated = true;
    const next = new Set<string>();
    for (const edge of batch.slice(0, remainingEdges)) {
      edges.set(edge.id, edge);
      for (const id of [edge.fromNodeId, edge.toNodeId]) {
        if (nodeIds.has(id)) continue;
        if (nodeIds.size >= FULL_NODE_LIMIT) {
          truncated = true;
          continue;
        }
        nodeIds.add(id);
        next.add(id);
      }
    }
    frontier = [...next];
  }
  const neighbors = await db.brainNode.findMany({
    where: {
      id: { in: [...nodeIds].filter((id) => id !== focus.id) },
      userId,
      status: visibleStatus,
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
    select: graphNodeSelect,
  });
  const visibleIds = new Set([focus.id, ...neighbors.map((node) => node.id)]);
  return {
    nodes: [focus, ...neighbors],
    edges: [...edges.values()].filter(
      (edge) => visibleIds.has(edge.fromNodeId) && visibleIds.has(edge.toNodeId),
    ),
    truncated,
  };
}

export function toGraphReadNode(node: RawNode, degree = 0): GraphReadNode {
  return {
    id: node.id,
    key: node.key,
    label: node.label.slice(0, 120),
    description: node.description,
    type: graphNodeType(node),
    source: graphSource(node),
    sourceType: node.sourceType,
    sourceId: node.sourceId,
    transcriptId: graphTranscriptId(node),
    weight: 1 + Math.min(degree, 8),
    updatedAt: node.updatedAt.toISOString(),
  };
}

export function toGraphReadEdge(edge: RawEdge): GraphReadEdge {
  return {
    id: edge.id,
    from: edge.fromNodeId,
    to: edge.toNodeId,
    kind: edge.kind.toLowerCase() as GraphReadEdge['kind'],
    method: edge.method,
    confidence: edge.confidence.toString(),
    evidence: evidenceTag(edge.method, edge.kind),
  };
}

function graphNodeType(
  node: Pick<RawNode, 'type' | 'sourceType' | 'metadata'>,
): GraphReadNode['type'] {
  if (node.sourceType === 'TRANSCRIPT') return 'transcript';
  if (node.sourceType === 'FOLDER') return 'folder';
  if (node.sourceType === 'NOTE') {
    const metadata = node.metadata && typeof node.metadata === 'object' ? node.metadata : {};
    if ('kind' in metadata && metadata.kind === 'FOLDER') return 'folder';
    return 'note';
  }
  return node.type.toLowerCase() as GraphReadNode['type'];
}

function graphSource(node: Pick<RawNode, 'sourceType' | 'metadata'>): GraphReadNode['source'] {
  if (node.sourceType !== 'TRANSCRIPT') return undefined;
  if (!node.metadata || typeof node.metadata !== 'object' || !('source' in node.metadata)) {
    return undefined;
  }
  const source = node.metadata.source;
  return source === 'YOUTUBE' ||
    source === 'INSTAGRAM' ||
    source === 'TIKTOK' ||
    source === 'X' ||
    source === 'WEB' ||
    source === 'UPLOAD'
    ? source
    : undefined;
}

function graphTranscriptId(node: Pick<RawNode, 'sourceType' | 'metadata'>): string | undefined {
  if (node.sourceType !== 'EXTERNAL_ENRICHMENT') return undefined;
  if (!node.metadata || typeof node.metadata !== 'object' || !('transcriptId' in node.metadata)) {
    return undefined;
  }
  return typeof node.metadata.transcriptId === 'string' ? node.metadata.transcriptId : undefined;
}

function evidenceTag(method: string, kind: string): GraphReadEdge['evidence'] {
  const normalized = method.toLowerCase();
  if (
    normalized.includes('manual') ||
    normalized.includes('wikilink') ||
    normalized.includes('folder') ||
    normalized.includes('explicit') ||
    normalized.includes('llm-grounded') ||
    normalized === 'user' ||
    kind === 'LINKS_TO' ||
    kind === 'BELONGS_TO'
  ) {
    return 'EXTRACTED';
  }
  if (
    normalized.includes('keyword') ||
    normalized.includes('shared') ||
    normalized.includes('semantic') ||
    normalized.includes('timeline') ||
    normalized.includes('community') ||
    normalized.includes('heuristic')
  ) {
    return 'INFERRED';
  }
  return 'AMBIGUOUS';
}
