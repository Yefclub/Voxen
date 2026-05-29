// ============================================================================
// /api/graph — visualização da KB em árvore + arestas
// ============================================================================
// Retorna nodes (transcripts + notes + folders) + edges (descobertas):
//   1. Wiki-links explícitas no content das notas: `[[título alvo]]`
//   2. Parent-child em pastas de notas
//
// Spec: .specs/006-graph-viz.md
// Limite: 500 nós por user (cap defensivo — KBs maiores precisam paginação)
// Cache: 60s em Redis (key voxen:graph:<userId>) — refresh manual disponível
// ============================================================================

import { Hono } from 'hono';
import { auth } from '../lib/auth';
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
  label: string;
  type: 'transcript' | 'note' | 'folder';
  source?: 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK' | 'X' | 'WEB' | 'UPLOAD';
  weight: number;
}

interface GraphEdge {
  from: string;
  to: string;
  kind: 'wikilink' | 'parent';
}

const NODE_LIMIT = 500;
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

  const [transcripts, notes] = await Promise.all([
    db.transcript.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      take: NODE_LIMIT,
      select: { id: true, title: true, source: true },
    }),
    db.note.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: NODE_LIMIT,
      select: {
        id: true,
        title: true,
        kind: true,
        parentId: true,
        content: true,
      },
    }),
  ]);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const t of transcripts) {
    nodes.push({
      id: `t:${t.id}`,
      label: t.title.slice(0, 80),
      type: 'transcript',
      source: t.source,
      weight: 1,
    });
  }
  // Index pra resolver wikilinks por título (case-insensitive)
  const noteByTitle = new Map<string, string>();
  for (const n of notes) {
    noteByTitle.set(n.title.trim().toLowerCase(), `n:${n.id}`);
  }
  for (const n of notes) {
    nodes.push({
      id: `n:${n.id}`,
      label: n.title.slice(0, 80),
      type: n.kind === 'FOLDER' ? 'folder' : 'note',
      weight: 1,
    });
    if (n.parentId) {
      edges.push({ from: `n:${n.parentId}`, to: `n:${n.id}`, kind: 'parent' });
    }
    if (n.kind === 'NOTE' && n.content) {
      const wikilinks = n.content.matchAll(/\[\[([^\]]+)\]\]/g);
      for (const m of wikilinks) {
        const target = m[1]?.trim().toLowerCase();
        if (!target) continue;
        const targetId = noteByTitle.get(target);
        if (targetId && targetId !== `n:${n.id}`) {
          edges.push({ from: `n:${n.id}`, to: targetId, kind: 'wikilink' });
        }
      }
    }
  }

  const response = { nodes, edges, totalNodes: nodes.length, totalEdges: edges.length };
  try {
    await getRedisPublisher().set(cacheKey, JSON.stringify(response), 'EX', CACHE_TTL_SEC);
  } catch {
    // ignora
  }
  return c.json(response);
});
