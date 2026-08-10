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
  deleteOrphanedBrainSourceNodes,
  reindexLibraryFoldersBrain,
  reindexNotesBrain,
  reindexTranscriptsBrain,
} from '../lib/brain';
import { reindexTranscriptEnrichmentsBrain } from '../lib/brain-enrichments';
import { readBrainCoverage } from '../lib/graph-brain-coverage';
import {
  type GraphReadEdge,
  type GraphReadNode,
  readGraphSlice,
  toGraphReadNode,
} from '../lib/graph-read-model';
import { searchBrainNodes } from '../lib/brain-search';
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
  GraphIndexRunError,
  createGraphIndexFailureStatus,
  reportGraphIndexRunFailure,
} from '../lib/graph-index-run-error';
import { parseGraphHops, parseGraphView } from '../lib/graph-slice';
import { createSubscriber, getRedisPublisher } from '../lib/redis';
import { graphIndexCoverage, type GraphIndexStatus } from '../shared/graph-index';

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

type GraphNode = GraphReadNode;
type GraphEdge = GraphReadEdge;

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

const CACHE_TTL_SEC = 60;

graphRoutes.get('/status', async (c) => {
  const userId = c.get('userId');
  const force = c.req.query('force') === '1';
  const status = force
    ? await ensureBrainCoverage(userId, true)
    : await currentGraphIndexStatus(userId);
  return c.json(await withFreshGraphCoverage(userId, status));
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

graphRoutes.get('/search', async (c) => {
  const userId = c.get('userId');
  const query = (c.req.query('q') ?? '').trim().slice(0, 160);
  if (query.length < 2) return c.json({ query, results: [] });
  const requestedLimit = Number(c.req.query('limit') ?? 12);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(30, Math.max(1, Math.trunc(requestedLimit)))
    : 12;
  const results = await searchBrainNodes(userId, query, limit);
  return c.json({ query, results: results.map((node) => toGraphReadNode(node)) });
});

graphRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const force = c.req.query('force') === '1';
  const refresh = c.req.query('refresh') === '1';
  const view = parseGraphView(c.req.query('view'));
  const focusId = c.req.query('focus')?.trim().slice(0, 160) || null;
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

  const sliced = await readGraphSlice({
    userId,
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
    candidateNodes: sliced.candidateNodes,
    candidateEdges: sliced.candidateEdges,
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

async function withFreshGraphCoverage(
  userId: string,
  status: GraphIndexStatus,
): Promise<GraphIndexStatus> {
  const coverage = await readBrainCoverage(userId);
  return { ...status, coverage: graphIndexCoverage(coverage) };
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
      await reindexTranscriptEnrichmentsBrain(userId, assertLeaseOwnership);
      await assertLeaseOwnership();

      const coverage = await readBrainCoverage(userId);
      if (shouldScheduleGraphReindex({ force: false, ...coverage })) {
        throw new GraphIndexRunError('coverage-incomplete', coverage);
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
      const reason = reportGraphIndexRunFailure(userId, err);
      if (reason !== 'lease-lost') {
        const failedAt = Date.now();
        const failed = createGraphIndexFailureStatus(
          running,
          reason,
          failedAt,
          GRAPH_INDEX_ERROR_COOLDOWN_MS,
        );
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
