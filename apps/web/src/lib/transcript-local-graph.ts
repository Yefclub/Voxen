import type { BrainCompilationStatus } from '../../prisma-generated/client';
import { db } from './db';
import {
  readGraphSlice,
  toGraphReadEdge,
  toGraphReadNode,
  type GraphReadEdge,
  type GraphReadNode,
} from './graph-read-model';

export type TranscriptGraphScope = 'content' | 'connections';
export type TranscriptGraphState = 'NOT_INDEXED' | 'INDEXING' | 'PARTIAL' | 'FAILED' | 'READY';

export interface TranscriptGraphEvidence {
  id: string;
  nodeId: string | null;
  edgeId: string | null;
  sourceType: string;
  sourceId: string;
  excerpt: string | null;
  startLine: number | null;
  endLine: number | null;
  startSec: number | null;
  endSec: number | null;
  anchor: string | null;
}

export interface TranscriptLocalGraphResponse {
  transcriptId: string;
  focusId: string | null;
  scope: TranscriptGraphScope;
  hops: number;
  state: TranscriptGraphState;
  nodes: GraphReadNode[];
  edges: GraphReadEdge[];
  evidence: TranscriptGraphEvidence[];
  truncated: boolean;
  compilation: {
    status: BrainCompilationStatus;
    totalSegments: number;
    completedSegments: number;
    lastError: string | null;
    updatedAt: string;
  } | null;
}

type EvidenceCoordinates = Pick<
  TranscriptGraphEvidence,
  'startLine' | 'endLine' | 'startSec' | 'endSec'
>;

const CONTENT_NODE_LIMIT = 240;
const CONTENT_EDGE_LIMIT = 500;
const EVIDENCE_LIMIT = 800;

export function parseTranscriptGraphScope(raw: string | null | undefined): TranscriptGraphScope {
  return raw === 'connections' ? 'connections' : 'content';
}

export function parseTranscriptGraphHops(raw: string | null | undefined): number {
  const parsed = Number(raw ?? 1);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(2, Math.max(1, Math.trunc(parsed)));
}

export function transcriptGraphState(
  status: BrainCompilationStatus | null,
  hasFocus: boolean,
): TranscriptGraphState {
  if (status === 'PENDING' || status === 'RUNNING' || status === 'RETRY') return 'INDEXING';
  if (status === 'PARTIAL') return 'PARTIAL';
  if (status === 'FAILED') return 'FAILED';
  if (hasFocus) return 'READY';
  return 'NOT_INDEXED';
}

export function evidenceAnchor(evidence: EvidenceCoordinates): string | null {
  if (evidence.startLine !== null) {
    return `#l=${evidence.startLine}-${evidence.endLine ?? evidence.startLine}`;
  }
  if (evidence.startSec !== null) {
    return `#t=${evidence.startSec}-${evidence.endSec ?? evidence.startSec}`;
  }
  return null;
}

export async function readTranscriptLocalGraph(input: {
  userId: string;
  transcriptId: string;
  scope: TranscriptGraphScope;
  hops: number;
}): Promise<TranscriptLocalGraphResponse | null> {
  const transcript = await db.transcript.findFirst({
    where: { id: input.transcriptId, userId: input.userId, status: { not: 'TRASH' } },
    select: { id: true },
  });
  if (!transcript) return null;

  const [focus, compilation] = await Promise.all([
    db.brainNode.findFirst({
      where: {
        userId: input.userId,
        sourceType: 'TRANSCRIPT',
        sourceId: input.transcriptId,
        status: 'ACTIVE',
      },
      orderBy: [{ type: 'asc' }, { updatedAt: 'desc' }],
    }),
    db.brainCompilation.findFirst({
      where: { userId: input.userId, transcriptId: input.transcriptId },
      select: {
        status: true,
        totalSegments: true,
        completedSegments: true,
        lastError: true,
        updatedAt: true,
      },
    }),
  ]);

  const compilationResult = compilation
    ? { ...compilation, updatedAt: compilation.updatedAt.toISOString() }
    : null;
  if (!focus) {
    return {
      transcriptId: input.transcriptId,
      focusId: null,
      scope: input.scope,
      hops: input.hops,
      state: transcriptGraphState(compilation?.status ?? null, false),
      nodes: [],
      edges: [],
      evidence: [],
      truncated: false,
      compilation: compilationResult,
    };
  }

  if (input.scope === 'connections') {
    const graph = await readGraphSlice({
      userId: input.userId,
      view: 'full',
      focusId: focus.id,
      hops: input.hops,
    });
    const evidence = await readEvidence(
      input.userId,
      graph.nodes.map((node) => node.id),
      graph.edges.map((edge) => edge.id),
    );
    return {
      transcriptId: input.transcriptId,
      focusId: focus.id,
      scope: input.scope,
      hops: input.hops,
      state: transcriptGraphState(compilation?.status ?? null, true),
      nodes: graph.nodes,
      edges: graph.edges,
      evidence,
      truncated: graph.truncated,
      compilation: compilationResult,
    };
  }

  const sourceEvidence = await db.brainSource.findMany({
    where: {
      userId: input.userId,
      sourceType: 'TRANSCRIPT',
      sourceId: input.transcriptId,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: EVIDENCE_LIMIT + 1,
  });
  const evidencedEdgeIds = sourceEvidence
    .map((source) => source.edgeId)
    .filter((id): id is string => id !== null);
  const evidencedEdges =
    evidencedEdgeIds.length === 0
      ? []
      : await db.brainEdge.findMany({
          where: {
            id: { in: evidencedEdgeIds },
            userId: input.userId,
            status: 'ACTIVE',
            from: { userId: input.userId, status: 'ACTIVE' },
            to: { userId: input.userId, status: 'ACTIVE' },
          },
          take: CONTENT_EDGE_LIMIT,
        });
  const nodeIds = new Set<string>([focus.id]);
  for (const source of sourceEvidence) {
    if (source.nodeId) nodeIds.add(source.nodeId);
  }
  for (const edge of evidencedEdges) {
    nodeIds.add(edge.fromNodeId);
    nodeIds.add(edge.toNodeId);
  }
  const boundedNodeIds = [...nodeIds].slice(0, CONTENT_NODE_LIMIT);
  const nodes = await db.brainNode.findMany({
    where: {
      id: { in: boundedNodeIds },
      userId: input.userId,
      status: 'ACTIVE',
      OR: [{ id: focus.id }, { type: { in: ['ENTITY', 'TOPIC', 'CLAIM', 'EVENT', 'CLUSTER'] } }],
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
  });
  const visibleIds = new Set(nodes.map((node) => node.id));
  const edges = await db.brainEdge.findMany({
    where: {
      userId: input.userId,
      status: 'ACTIVE',
      fromNodeId: { in: [...visibleIds] },
      toNodeId: { in: [...visibleIds] },
      from: { userId: input.userId, status: 'ACTIVE' },
      to: { userId: input.userId, status: 'ACTIVE' },
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    take: CONTENT_EDGE_LIMIT,
  });
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.fromNodeId, (degree.get(edge.fromNodeId) ?? 0) + 1);
    degree.set(edge.toNodeId, (degree.get(edge.toNodeId) ?? 0) + 1);
  }
  const visibleEdgeIds = new Set(edges.map((edge) => edge.id));
  const evidence = sourceEvidence
    .filter(
      (source) =>
        (source.nodeId !== null && visibleIds.has(source.nodeId)) ||
        (source.edgeId !== null && visibleEdgeIds.has(source.edgeId)),
    )
    .slice(0, EVIDENCE_LIMIT)
    .map(toTranscriptGraphEvidence);
  return {
    transcriptId: input.transcriptId,
    focusId: focus.id,
    scope: input.scope,
    hops: input.hops,
    state: transcriptGraphState(compilation?.status ?? null, true),
    nodes: nodes.map((node) => toGraphReadNode(node, degree.get(node.id) ?? 0)),
    edges: edges.map(toGraphReadEdge),
    evidence,
    truncated:
      sourceEvidence.length > EVIDENCE_LIMIT ||
      nodeIds.size > CONTENT_NODE_LIMIT ||
      evidencedEdges.length >= CONTENT_EDGE_LIMIT ||
      edges.length >= CONTENT_EDGE_LIMIT,
    compilation: compilationResult,
  };
}

async function readEvidence(
  userId: string,
  nodeIds: string[],
  edgeIds: string[],
): Promise<TranscriptGraphEvidence[]> {
  if (nodeIds.length === 0 && edgeIds.length === 0) return [];
  const sources = await db.brainSource.findMany({
    where: {
      userId,
      OR: [
        ...(nodeIds.length > 0 ? [{ nodeId: { in: nodeIds } }] : []),
        ...(edgeIds.length > 0 ? [{ edgeId: { in: edgeIds } }] : []),
      ],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: EVIDENCE_LIMIT,
  });
  return sources.map(toTranscriptGraphEvidence);
}

function toTranscriptGraphEvidence(source: {
  id: string;
  nodeId: string | null;
  edgeId: string | null;
  sourceType: string;
  sourceId: string;
  excerpt: string | null;
  startLine: number | null;
  endLine: number | null;
  startSec: number | null;
  endSec: number | null;
}): TranscriptGraphEvidence {
  const coordinates = {
    startLine: source.startLine,
    endLine: source.endLine,
    startSec: source.startSec,
    endSec: source.endSec,
  };
  return { ...source, ...coordinates, anchor: evidenceAnchor(coordinates) };
}
