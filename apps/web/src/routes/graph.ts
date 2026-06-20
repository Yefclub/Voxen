// ============================================================================
// /api/graph — visualização do Voxen Brain
// ============================================================================
// Retorna nodes + edges materializados pelo Brain indexer:
//   - Transcript/note/folder como fontes canônicas
//   - Relações explícitas: wiki-links, hierarquia, pastas e evidências
//
// Spec: .specs/020-brain-knowledge-harness.md
// Limite: 500 nós por user (cap defensivo — KBs maiores precisam paginação)
// Cache: 60s em Redis (key voxen:graph:<userId>) — refresh manual disponível
// ============================================================================

import { Hono } from 'hono';
import { auth } from '../lib/auth';
import {
  BRAIN_INDEX_VERSION,
  reindexLibraryFoldersBrain,
  reindexNotesBrain,
  reindexTranscriptsBrain,
} from '../lib/brain';
import { db } from '../lib/db';
import { graphCacheKey } from '../lib/graph-cache';
import { getRedisPublisher } from '../lib/redis';

type Vars = { userId: string };

export const graphRoutes = new Hono<{ Variables: Vars }>();

graphRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'Não autenticado.' }, 401);
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { status: true },
  });
  if (!user || user.status !== 'APPROVED') {
    return c.json({ error: 'Acesso negado.' }, 403);
  }
  c.set('userId', session.user.id);
  return next();
});

interface GraphNode {
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
  sourceType: 'TRANSCRIPT' | 'NOTE' | 'FOLDER' | 'JOB' | 'CHAT' | 'MANUAL' | null;
  sourceId: string | null;
  weight: number;
  updatedAt: string;
}

interface GraphEdge {
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
}

const NODE_LIMIT = 500;
const EDGE_LIMIT = 1_500;
const CACHE_TTL_SEC = 60;

graphRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const force = c.req.query('force') === '1';

  // Cache em Redis 60s
  const cacheKey = graphCacheKey(userId);
  if (!force) {
    try {
      const cached = await getRedisPublisher().get(cacheKey);
      if (cached) {
        return c.json(JSON.parse(cached));
      }
    } catch {
      // ignora — cache miss não bloqueia
    }
  }

  await ensureBrainCoverage(userId, force);

  const rawNodes = await db.brainNode.findMany({
    where: { userId, status: 'ACTIVE' },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    take: NODE_LIMIT,
    select: {
      id: true,
      key: true,
      type: true,
      label: true,
      description: true,
      sourceType: true,
      sourceId: true,
      metadata: true,
      updatedAt: true,
    },
  });
  const nodeIds = new Set(rawNodes.map((node) => node.id));
  const rawEdges = (
    await db.brainEdge.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        fromNodeId: { in: [...nodeIds] },
        toNodeId: { in: [...nodeIds] },
        from: { status: 'ACTIVE' },
        to: { status: 'ACTIVE' },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: EDGE_LIMIT,
      select: {
        id: true,
        fromNodeId: true,
        toNodeId: true,
        kind: true,
        method: true,
        confidence: true,
      },
    })
  ).filter((edge) => nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId));

  const degree = new Map<string, number>();
  for (const edge of rawEdges) {
    degree.set(edge.fromNodeId, (degree.get(edge.fromNodeId) ?? 0) + 1);
    degree.set(edge.toNodeId, (degree.get(edge.toNodeId) ?? 0) + 1);
  }

  const nodes = rawNodes.map<GraphNode>((node) => ({
    id: node.id,
    key: node.key,
    label: node.label.slice(0, 120),
    description: node.description,
    type: graphNodeType(node),
    source: graphSource(node),
    sourceType: node.sourceType,
    sourceId: node.sourceId,
    weight: 1 + Math.min(degree.get(node.id) ?? 0, 8),
    updatedAt: node.updatedAt.toISOString(),
  }));
  const edges = rawEdges.map<GraphEdge>((edge) => ({
    id: edge.id,
    from: edge.fromNodeId,
    to: edge.toNodeId,
    kind: edge.kind.toLowerCase() as GraphEdge['kind'],
    method: edge.method,
    confidence: edge.confidence.toString(),
  }));

  const response = { nodes, edges, totalNodes: nodes.length, totalEdges: edges.length };
  try {
    await getRedisPublisher().set(cacheKey, JSON.stringify(response), 'EX', CACHE_TTL_SEC);
  } catch {
    // ignora
  }
  return c.json(response);
});

async function ensureBrainCoverage(userId: string, force: boolean): Promise<void> {
  const [transcripts, notes, folders, brainNodes, staleSourceNodes] = await Promise.all([
    db.transcript.count({ where: { userId, status: 'ACTIVE' } }),
    db.note.count({ where: { userId } }),
    db.libraryFolder.count({ where: { userId } }),
    db.brainNode.count({
      where: {
        userId,
        status: 'ACTIVE',
        sourceType: { in: ['TRANSCRIPT', 'NOTE', 'FOLDER'] },
      },
    }),
    countStaleBrainSourceNodes(userId),
  ]);
  const expectedSourceNodes = transcripts + notes + folders;
  if (
    !force &&
    (expectedSourceNodes === 0 || (brainNodes >= expectedSourceNodes && staleSourceNodes === 0))
  ) {
    return;
  }

  await reindexLibraryFoldersBrain(userId);
  await reindexNotesBrain(userId);
  await reindexTranscriptsBrain(userId);
}

async function countStaleBrainSourceNodes(userId: string): Promise<number> {
  const rows = await db.$queryRaw<Array<{ count: number | bigint }>>`
    SELECT count(*)::int AS count
    FROM "BrainNode"
    WHERE "userId" = ${userId}
      AND status = 'ACTIVE'::"ContentStatus"
      AND "sourceType"::text IN ('TRANSCRIPT', 'NOTE')
      AND coalesce(metadata->>'brainIndexVersion', '0') <> ${String(BRAIN_INDEX_VERSION)}
  `;
  const count = rows[0]?.count ?? 0;
  return typeof count === 'bigint' ? Number(count) : count;
}

function graphNodeType(node: {
  type: string;
  sourceType: string | null;
  metadata: unknown;
}): GraphNode['type'] {
  if (node.sourceType === 'TRANSCRIPT') return 'transcript';
  if (node.sourceType === 'FOLDER') return 'folder';
  if (node.sourceType === 'NOTE') {
    const metadata = node.metadata && typeof node.metadata === 'object' ? node.metadata : {};
    if ('kind' in metadata && metadata.kind === 'FOLDER') return 'folder';
    return 'note';
  }
  switch (node.type) {
    case 'ENTITY':
      return 'entity';
    case 'TOPIC':
      return 'topic';
    case 'CLAIM':
      return 'claim';
    case 'EVENT':
      return 'event';
    case 'CLUSTER':
      return 'cluster';
    case 'FOLDER':
      return 'folder';
    default:
      return 'content';
  }
}

function graphSource(node: { sourceType: string | null; metadata: unknown }): GraphNode['source'] {
  if (node.sourceType !== 'TRANSCRIPT') return undefined;
  if (!node.metadata || typeof node.metadata !== 'object' || !('source' in node.metadata)) {
    return undefined;
  }
  const source = node.metadata.source;
  if (
    source === 'YOUTUBE' ||
    source === 'INSTAGRAM' ||
    source === 'TIKTOK' ||
    source === 'X' ||
    source === 'WEB' ||
    source === 'UPLOAD'
  ) {
    return source;
  }
  return undefined;
}
