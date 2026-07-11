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
import { graphCacheKey, invalidateGraphCache } from '../lib/graph-cache';
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
  /** EXTRACTED = evidência explícita; INFERRED = heurística/keyword. */
  evidence: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
}

interface GraphHub {
  id: string;
  label: string;
  type: GraphNode['type'];
  degree: number;
}

interface GraphInsights {
  hubs: GraphHub[];
  communities: Array<{ id: number; size: number; label: string; nodeIds: string[] }>;
  edgeEvidence: { extracted: number; inferred: number; ambiguous: number };
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
    evidence: evidenceTag(edge.method, edge.kind),
  }));

  const insights = buildInsights(nodes, edges, degree);
  const response = {
    nodes,
    edges,
    totalNodes: nodes.length,
    totalEdges: edges.length,
    insights,
  };
  // Não cacheia enquanto um reindex está em andamento: o estado atual está
  // prestes a mudar e o reindex invalida o cache ao terminar.
  if (!isBrainReindexInFlight(userId)) {
    try {
      await getRedisPublisher().set(cacheKey, JSON.stringify(response), 'EX', CACHE_TTL_SEC);
    } catch {
      // ignora
    }
  }
  return c.json(response);
});

// Reindex do Brain em andamento, por usuário. Reindexar a biblioteca inteira
// leva dezenas de segundos; fazer isso SÍNCRONO dentro do GET estourava o
// proxy/healthcheck → 502. O guard evita empilhar reindexes concorrentes (cada
// GET sem cache dispararia um). Escopo do processo (o web roda single-instance).
const brainReindexInFlight = new Set<string>();

function isBrainReindexInFlight(userId: string): boolean {
  return brainReindexInFlight.has(userId);
}

// Dispara o reindex do Brain em BACKGROUND (fire-and-forget). O GET nunca
// bloqueia nesse trabalho. Ao terminar, invalida o cache do grafo para o
// próximo load servir o estado fresco. Um reindex por usuário por vez.
function scheduleBrainReindex(userId: string): void {
  if (brainReindexInFlight.has(userId)) return;
  brainReindexInFlight.add(userId);
  void (async () => {
    try {
      await reindexLibraryFoldersBrain(userId);
      await reindexNotesBrain(userId);
      await reindexTranscriptsBrain(userId);
      await invalidateGraphCache(userId);
    } catch (err) {
      console.warn('[graph] background reindex failed', { userId, err });
    } finally {
      brainReindexInFlight.delete(userId);
    }
  })();
}

// Acima deste número de fontes (transcrições + notas + pastas), reindexar de
// forma síncrona dentro do GET demora demais e estoura o proxy/healthcheck
// (502). Bibliotecas até esse tamanho reindexam na hora (resposta imediata já
// coberta); maiores vão para o background.
const SYNC_REINDEX_MAX_SOURCES = 25;

// Decide se o Brain precisa reindexar. Bibliotecas pequenas reindexam de forma
// síncrona (o grafo sai pronto na mesma resposta). Bibliotecas grandes agendam
// o reindex em BACKGROUND e o handler devolve o estado materializado atual na
// hora — o grafo se atualiza sozinho no próximo load (o cache é invalidado ao
// fim). Isso mata o 502 causado pelo reindex síncrono da biblioteca inteira.
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

  if (expectedSourceNodes > SYNC_REINDEX_MAX_SOURCES) {
    scheduleBrainReindex(userId);
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

function evidenceTag(method: string, kind: string): 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS' {
  const m = method.toLowerCase();
  if (
    m.includes('wikilink') ||
    m.includes('folder') ||
    m.includes('explicit') ||
    m === 'user' ||
    kind === 'BELONGS_TO' ||
    kind === 'LINKS_TO'
  ) {
    return 'EXTRACTED';
  }
  if (
    m.includes('keyword') ||
    m.includes('shared') ||
    m.includes('semantic') ||
    m.includes('timeline')
  ) {
    return 'INFERRED';
  }
  return 'AMBIGUOUS';
}

function buildInsights(
  nodes: GraphNode[],
  edges: GraphEdge[],
  degree: Map<string, number>,
): GraphInsights {
  const hubs = [...nodes]
    .map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type,
      degree: degree.get(n.id) ?? 0,
    }))
    .filter((h) => h.degree > 0)
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 12);

  // Comunidades: Union-Find em arestas RELATED_TO/MENTIONS (componentes conexos).
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let p = parent.get(x) ?? x;
    if (p !== x) {
      p = find(p);
      parent.set(x, p);
    }
    return p;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const n of nodes) parent.set(n.id, n.id);
  for (const e of edges) {
    if (e.kind === 'related_to' || e.kind === 'mentions' || e.kind === 'belongs_to') {
      union(e.from, e.to);
    }
  }
  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const root = find(n.id);
    const list = groups.get(root) ?? [];
    list.push(n.id);
    groups.set(root, list);
  }
  const labelById = new Map(nodes.map((n) => [n.id, n.label]));
  const communities = [...groups.entries()]
    .map(([, ids], i) => {
      // label = nó de maior grau no cluster
      let best = ids[0] ?? '';
      let bestDeg = -1;
      for (const id of ids) {
        const d = degree.get(id) ?? 0;
        if (d > bestDeg) {
          bestDeg = d;
          best = id;
        }
      }
      return {
        id: i,
        size: ids.length,
        label: labelById.get(best) ?? best,
        nodeIds: ids.slice(0, 40),
      };
    })
    .filter((c) => c.size >= 2)
    .sort((a, b) => b.size - a.size)
    .slice(0, 20);

  const edgeEvidence = { extracted: 0, inferred: 0, ambiguous: 0 };
  for (const e of edges) {
    if (e.evidence === 'EXTRACTED') edgeEvidence.extracted += 1;
    else if (e.evidence === 'INFERRED') edgeEvidence.inferred += 1;
    else edgeEvidence.ambiguous += 1;
  }

  return { hubs, communities, edgeEvidence };
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
