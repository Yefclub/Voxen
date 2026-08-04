// ============================================================================
// /api/graph — visualização do Voxen Brain
// ============================================================================
// Retorna nodes + edges materializados pelo Brain indexer:
//   - Transcript/note/folder como fontes canônicas
//   - Relações explícitas: wiki-links, hierarquia, pastas e evidências
//
// Spec: .specs/020-brain-knowledge-harness.md
// Limite full: 500 nós / 1500 arestas (defensivo).
// Full view (default): universo completo dentro dos caps defensivos — ver graph-slice.ts.
// Cache: 60s em Redis (key voxen:graph:<userId>:<view>[:focus]) — refresh manual.
// ============================================================================

import { Hono } from 'hono';
import { auth } from '../lib/auth';
import {
  BRAIN_INDEX_VERSION,
  deleteOrphanedBrainSourceNodes,
  reindexLibraryFoldersBrain,
  reindexNotesBrain,
  reindexTranscriptsBrain,
} from '../lib/brain';
import { db } from '../lib/db';
import { graphCacheKey, graphInvalidationChannel, invalidateGraphCache } from '../lib/graph-cache';
import {
  GRAPH_INDEX_ERROR_COOLDOWN_MS,
  GRAPH_INDEX_HEARTBEAT_MS,
  GRAPH_INDEX_LEASE_TTL_MS,
  acquireGraphIndexLease,
  graphIndexRedisUnavailableStatus,
  readGraphIndexStatus,
  reconcileGraphIndexStatus,
  releaseGraphIndexLease,
  renewGraphIndexLease,
  shouldStartGraphIndex,
  writeGraphIndexStatus,
  writeGraphIndexStatusWithoutLease,
  writeOwnedGraphIndexStatus,
} from '../lib/graph-index-coordinator';
import { shouldScheduleGraphReindex } from '../lib/graph-index-state';
import {
  FULL_EDGE_LIMIT,
  FULL_NODE_LIMIT,
  parseGraphHops,
  parseGraphView,
  selectGraphSlice,
} from '../lib/graph-slice';
import { createSubscriber, getRedisPublisher } from '../lib/redis';
import type { GraphIndexErrorReason, GraphIndexStatus } from '../shared/graph-index';

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

const NODE_LIMIT = FULL_NODE_LIMIT;
const EDGE_LIMIT = FULL_EDGE_LIMIT;
const CACHE_TTL_SEC = 60;

graphRoutes.get('/status', async (c) => {
  const userId = c.get('userId');
  const force = c.req.query('force') === '1';
  return c.json(
    force ? await ensureBrainCoverage(userId, true) : await currentGraphIndexStatus(userId),
  );
});

graphRoutes.get('/events', async (c) => {
  const userId = c.get('userId');
  const subscriber = createSubscriber();
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  const cleanup = async (): Promise<void> => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    await subscriber.quit().catch(() => undefined);
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          closed = true;
        }
      };
      subscriber.on('message', (_channel, payload) => send('invalidated', payload));
      subscriber.on('error', () => {
        closed = true;
        void cleanup();
        try {
          controller.close();
        } catch {
          // Client or proxy already closed the stream.
        }
      });
      try {
        await subscriber.subscribe(graphInvalidationChannel(userId));
        send('connected', '{}');
        heartbeat = setInterval(() => send('ping', String(Date.now())), 10_000);
      } catch (error) {
        closed = true;
        await cleanup();
        controller.error(error);
      }
    },
    async cancel() {
      closed = true;
      await cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

graphRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const force = c.req.query('force') === '1';
  const refresh = c.req.query('refresh') === '1';
  const view = parseGraphView(c.req.query('view'));
  const focusId = c.req.query('focus')?.trim() || null;
  const hops = parseGraphHops(c.req.query('hops'));

  // Cache em Redis 60s — chave por view/focus para não misturar recortes.
  const cacheKey = `${graphCacheKey(userId)}:${view}${focusId ? `:f:${focusId}:h${hops}` : ''}`;
  if (!force && !refresh) {
    try {
      const cached = await getRedisPublisher().get(cacheKey);
      if (cached) {
        return c.json(JSON.parse(cached));
      }
    } catch {
      // ignora — cache miss não bloqueia
    }
  }

  const indexStatus = force
    ? await ensureBrainCoverage(userId, true)
    : await currentGraphIndexStatus(userId);

  // Busca o universo completo permitido pelos caps defensivos; `map` só existe
  // para URLs legadas e a UI sempre pede a visão completa.
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

  const allNodes = rawNodes.map<GraphNode>((node) => ({
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
  const allEdges = rawEdges.map<GraphEdge>((edge) => ({
    id: edge.id,
    from: edge.fromNodeId,
    to: edge.toNodeId,
    kind: edge.kind.toLowerCase() as GraphEdge['kind'],
    method: edge.method,
    confidence: edge.confidence.toString(),
    evidence: evidenceTag(edge.method, edge.kind),
  }));

  const sliced = selectGraphSlice({
    nodes: allNodes,
    edges: allEdges,
    view,
    focusId,
    hops,
  });

  const sliceDegree = new Map<string, number>();
  for (const edge of sliced.edges) {
    sliceDegree.set(edge.from, (sliceDegree.get(edge.from) ?? 0) + 1);
    sliceDegree.set(edge.to, (sliceDegree.get(edge.to) ?? 0) + 1);
  }

  const insights = buildInsights(sliced.nodes, sliced.edges, sliceDegree);
  const latestStatus = await currentGraphIndexStatus(userId);
  const indexing = indexStatus.state === 'running' || latestStatus.state === 'running';
  const response = {
    nodes: sliced.nodes,
    edges: sliced.edges,
    totalNodes: sliced.nodes.length,
    totalEdges: sliced.edges.length,
    candidateNodes: allNodes.length,
    candidateEdges: allEdges.length,
    view: sliced.view,
    truncated: sliced.truncated,
    focusId,
    hops: focusId ? hops : null,
    insights,
    indexing,
    indexStatus: latestStatus,
    generatedAt: new Date().toISOString(),
  };
  // Não cacheia enquanto um reindex está em andamento: o estado atual está
  // prestes a mudar e o reindex invalida o cache ao terminar.
  if (!indexing) {
    try {
      await getRedisPublisher().set(cacheKey, JSON.stringify(response), 'EX', CACHE_TTL_SEC);
    } catch {
      // ignora
    }
  }
  return c.json(response);
});

// O Set evita duplicidade apenas depois que esta instância adquiriu o lease.
// Sem Redis não há mutação do Brain nem fallback local de exclusão.
const brainReindexInFlight = new Set<string>();
const localGraphIndexStatus = new Map<string, GraphIndexStatus>();

interface BrainCoverage {
  expectedSourceNodes: number;
  indexedSourceNodes: number;
  staleSourceNodes: number;
}

async function currentGraphIndexStatus(userId: string): Promise<GraphIndexStatus> {
  try {
    const remoteStatus = await readGraphIndexStatus(userId);
    const localStatus = localGraphIndexStatus.get(userId);
    const status = reconcileGraphIndexStatus(
      remoteStatus,
      localStatus,
      brainReindexInFlight.has(userId),
    );
    if (
      status === localStatus &&
      status !== remoteStatus &&
      (status.state === 'ready' || status.state === 'error')
    ) {
      try {
        if (!(await writeGraphIndexStatusWithoutLease(userId, status))) {
          const latestStatus = await readGraphIndexStatus(userId);
          localGraphIndexStatus.set(userId, latestStatus);
          return latestStatus;
        }
      } catch {
        // Mantém o terminal local enquanto o Redis ainda não estiver acessível.
      }
    }
    localGraphIndexStatus.set(userId, status);
    return status;
  } catch {
    const localStatus = localGraphIndexStatus.get(userId);
    if (brainReindexInFlight.has(userId) && localStatus?.state === 'running') {
      return localStatus;
    }
    const unavailable = graphIndexRedisUnavailableStatus(localStatus);
    localGraphIndexStatus.set(userId, unavailable);
    return unavailable;
  }
}

async function persistGraphIndexStatus(userId: string, status: GraphIndexStatus): Promise<void> {
  localGraphIndexStatus.set(userId, status);
  try {
    await writeGraphIndexStatus(userId, status);
  } catch {
    // O snapshot continua legível; apenas o status terminal fica local até recuperar.
  }
}

async function scheduleBrainReindex(
  userId: string,
  currentStatus: GraphIndexStatus,
): Promise<GraphIndexStatus> {
  if (brainReindexInFlight.has(userId)) return currentGraphIndexStatus(userId);
  const runId = crypto.randomUUID();
  try {
    if (!(await acquireGraphIndexLease(userId, runId))) {
      return currentGraphIndexStatus(userId);
    }
  } catch {
    const unavailable = graphIndexRedisUnavailableStatus(currentStatus);
    localGraphIndexStatus.set(userId, unavailable);
    return unavailable;
  }

  brainReindexInFlight.add(userId);
  const now = new Date().toISOString();
  const running: GraphIndexStatus = {
    state: 'running',
    runId,
    startedAt: currentStatus.state === 'running' ? currentStatus.startedAt : now,
    updatedAt: now,
  };
  localGraphIndexStatus.set(userId, running);
  let runningStatusPublished = false;
  try {
    runningStatusPublished = await writeOwnedGraphIndexStatus(userId, runId, running);
    if (!runningStatusPublished) {
      brainReindexInFlight.delete(userId);
      await releaseGraphIndexLease(userId, runId).catch(() => false);
      return currentGraphIndexStatus(userId);
    }
  } catch {
    // O lease vivo continua sendo autoridade mesmo sem o payload de status.
  }

  void (async () => {
    let leaseLost = false;
    let leaseExpiresAt = Date.now() + GRAPH_INDEX_LEASE_TTL_MS;
    let nextRunningStatusPublishAttemptAt = Date.now() + GRAPH_INDEX_HEARTBEAT_MS;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    const markLeaseLost = (): void => {
      leaseLost = true;
      const failedAt = Date.now();
      localGraphIndexStatus.set(userId, {
        state: 'error',
        runId,
        startedAt: running.startedAt,
        updatedAt: new Date(failedAt).toISOString(),
        retryAfter: new Date(failedAt + GRAPH_INDEX_ERROR_COOLDOWN_MS).toISOString(),
        reason: 'lease-lost',
        recoverable: true,
      });
    };
    const renewOwnedLease = async (): Promise<void> => {
      if (leaseLost) throw new GraphIndexRunError('lease-lost');
      try {
        if (!(await renewGraphIndexLease(userId, runId))) {
          markLeaseLost();
          throw new GraphIndexRunError('lease-lost');
        }
        leaseExpiresAt = Date.now() + GRAPH_INDEX_LEASE_TTL_MS;
      } catch (err) {
        if (err instanceof GraphIndexRunError) throw err;
        if (Date.now() >= leaseExpiresAt) {
          markLeaseLost();
          throw new GraphIndexRunError('lease-lost');
        }
      }
    };
    const startHeartbeat = (): void => {
      if (heartbeat) return;
      heartbeat = setInterval(() => {
        void renewOwnedLease().catch(() => {});
      }, GRAPH_INDEX_HEARTBEAT_MS);
    };
    const assertLeaseOwnership = async (): Promise<void> => {
      if (leaseLost || Date.now() >= leaseExpiresAt) {
        markLeaseLost();
        throw new GraphIndexRunError('lease-lost');
      }
      if (!runningStatusPublished && Date.now() >= nextRunningStatusPublishAttemptAt) {
        nextRunningStatusPublishAttemptAt = Date.now() + GRAPH_INDEX_HEARTBEAT_MS;
        try {
          runningStatusPublished = await writeOwnedGraphIndexStatus(userId, runId, running);
          if (!runningStatusPublished) {
            markLeaseLost();
            throw new GraphIndexRunError('lease-lost');
          }
        } catch (err) {
          if (err instanceof GraphIndexRunError) throw err;
          if (Date.now() >= leaseExpiresAt) {
            markLeaseLost();
            throw new GraphIndexRunError('lease-lost');
          }
        }
      }
      if (Date.now() >= leaseExpiresAt - GRAPH_INDEX_HEARTBEAT_MS) {
        await renewOwnedLease();
      }
    };
    const publishOwnedStatus = async (status: GraphIndexStatus): Promise<boolean> => {
      try {
        const published = await writeOwnedGraphIndexStatus(userId, runId, status);
        if (published) localGraphIndexStatus.set(userId, status);
        return published;
      } catch {
        if (leaseLost || Date.now() >= leaseExpiresAt) return false;
        // O lease ainda vive pelo TTL; preserva o terminal local até o Redis recuperar.
        localGraphIndexStatus.set(userId, status);
        return true;
      }
    };
    startHeartbeat();
    try {
      await assertLeaseOwnership();
      await deleteOrphanedBrainSourceNodes(userId, assertLeaseOwnership);
      await assertLeaseOwnership();
      await reindexLibraryFoldersBrain(userId, assertLeaseOwnership);
      await assertLeaseOwnership();
      await reindexNotesBrain(userId, assertLeaseOwnership);
      await assertLeaseOwnership();
      await reindexTranscriptsBrain(userId, undefined, assertLeaseOwnership);
      await assertLeaseOwnership();

      const coverage = await readBrainCoverage(userId);
      if (shouldScheduleGraphReindex({ force: false, ...coverage })) {
        throw new GraphIndexRunError('coverage-incomplete');
      }
      await assertLeaseOwnership();
      await invalidateGraphCache(userId);
      await assertLeaseOwnership();
      const ready: GraphIndexStatus = {
        state: 'ready',
        runId,
        startedAt: running.startedAt,
        updatedAt: new Date().toISOString(),
      };
      if (!(await publishOwnedStatus(ready))) {
        throw new GraphIndexRunError('lease-lost');
      }
    } catch (err) {
      const reason: GraphIndexErrorReason =
        err instanceof GraphIndexRunError ? err.reason : 'failed';
      if (reason !== 'coverage-incomplete') {
        console.warn('[graph] background reindex failed', { userId, err });
      }
      if (reason !== 'lease-lost') {
        const failedAt = Date.now();
        const failed: GraphIndexStatus = {
          state: 'error',
          runId,
          startedAt: running.startedAt,
          updatedAt: new Date(failedAt).toISOString(),
          retryAfter: new Date(failedAt + GRAPH_INDEX_ERROR_COOLDOWN_MS).toISOString(),
          reason,
          recoverable: reason === 'coverage-incomplete',
        };
        await publishOwnedStatus(failed);
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      await releaseGraphIndexLease(userId, runId).catch(() => false);
      brainReindexInFlight.delete(userId);
      const localStatus = localGraphIndexStatus.get(userId);
      if (localStatus?.state === 'running' && localStatus.runId === runId) {
        localGraphIndexStatus.delete(userId);
      }
    }
  })();
  return running;
}

// Decide se o Brain precisa reindexar e sempre agenda o passe em background.
// O GET devolve o snapshot materializado atual inclusive em bibliotecas
// pequenas: o caminho interativo nunca executa ingestão ou extração completa.
async function ensureBrainCoverage(userId: string, force: boolean): Promise<GraphIndexStatus> {
  const status = await currentGraphIndexStatus(userId);
  if (!shouldStartGraphIndex(status, force)) return status;
  const coverage = await readBrainCoverage(userId);
  if (shouldScheduleGraphReindex({ force, ...coverage })) {
    return scheduleBrainReindex(userId, status);
  }
  const ready: GraphIndexStatus = {
    state: 'ready',
    runId: status.runId,
    updatedAt: new Date().toISOString(),
  };
  await persistGraphIndexStatus(userId, ready);
  return ready;
}

let graphUsersReconciliationInFlight = false;

/**
 * Mantém o Brain atualizado independentemente de alguém abrir /grafo.
 * O lease Redis já existente torna a rotina segura entre múltiplas réplicas.
 */
export async function reconcileGraphUsers(): Promise<void> {
  if (graphUsersReconciliationInFlight) return;
  graphUsersReconciliationInFlight = true;
  try {
    const users = await db.user.findMany({
      where: { status: 'APPROVED' },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const user of users) {
      await ensureBrainCoverage(user.id, false);
    }
  } finally {
    graphUsersReconciliationInFlight = false;
  }
}

async function readBrainCoverage(userId: string): Promise<BrainCoverage> {
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
  return {
    expectedSourceNodes: transcripts + notes + folders,
    indexedSourceNodes: brainNodes,
    staleSourceNodes,
  };
}

class GraphIndexRunError extends Error {
  constructor(readonly reason: GraphIndexErrorReason) {
    super(reason);
  }
}

async function countStaleBrainSourceNodes(userId: string): Promise<number> {
  const rows = await db.$queryRaw<Array<{ count: number | bigint }>>`
    SELECT count(*)::int AS count
    FROM "BrainNode" n
    LEFT JOIN "Transcript" t
      ON n."sourceType" = 'TRANSCRIPT'::"BrainSourceType"
     AND t.id = n."sourceId"
     AND t."userId" = n."userId"
    LEFT JOIN "Note" note
      ON n."sourceType" = 'NOTE'::"BrainSourceType"
     AND note.id = n."sourceId"
     AND note."userId" = n."userId"
    LEFT JOIN "LibraryFolder" folder
      ON n."sourceType" = 'FOLDER'::"BrainSourceType"
     AND folder.id = n."sourceId"
     AND folder."userId" = n."userId"
    WHERE n."userId" = ${userId}
      AND n."sourceType"::text IN ('TRANSCRIPT', 'NOTE', 'FOLDER')
      AND (
        (n."sourceType" = 'TRANSCRIPT'::"BrainSourceType" AND t.id IS NULL)
        OR (n."sourceType" = 'NOTE'::"BrainSourceType" AND note.id IS NULL)
        OR (n."sourceType" = 'FOLDER'::"BrainSourceType" AND folder.id IS NULL)
        OR (
          n.status = 'ACTIVE'::"ContentStatus"
          AND (
            coalesce(n.metadata->>'brainIndexVersion', '0') <>
              ${String(BRAIN_INDEX_VERSION)}
            OR (
              n."sourceType" = 'TRANSCRIPT'::"BrainSourceType"
              AND coalesce(n.metadata->>'updatedAt', '') <>
                  to_char(t."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            )
            OR (
              n."sourceType" = 'NOTE'::"BrainSourceType"
              AND coalesce(n.metadata->>'updatedAt', '') <>
                  to_char(note."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            )
            OR (
              n."sourceType" = 'FOLDER'::"BrainSourceType"
              AND coalesce(n.metadata->>'updatedAt', '') <>
                  to_char(folder."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            )
          )
        )
      )
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
    m.includes('timeline') ||
    m.includes('community')
  ) {
    return 'INFERRED';
  }
  if (m.includes('llm-grounded') || m.includes('grounded')) {
    return 'EXTRACTED';
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
