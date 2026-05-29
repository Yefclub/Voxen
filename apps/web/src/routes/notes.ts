// ============================================================================
// /api/notes — KB manual em árvore (notas + pastas)
// ============================================================================
// Endpoints (sempre escopados por userId):
//   GET    /api/notes                  → árvore inteira (ordem por updatedAt)
//   GET    /api/notes/:id              → nota com conteúdo
//   POST   /api/notes                  → cria nota ou pasta
//   PATCH  /api/notes/:id              → renomeia, move (parentId), edita content
//   DELETE /api/notes/:id              → apaga (cascade pra children)
//   GET    /api/notes/search?q=...     → FTS na coluna searchVector
// ============================================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { deleteBrainForSources, reindexNotesBrain } from '../lib/brain';
import { db } from '../lib/db';
import { invalidateGraphCache } from '../lib/graph-cache';

type Vars = { userId: string };

export const notesRoutes = new Hono<{ Variables: Vars }>();

notesRoutes.use('*', async (c, next) => {
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

// GET /api/notes — lista todas as notas/pastas do user (front monta a árvore)
notesRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const notes = await db.note.findMany({
    where: { userId },
    orderBy: [{ kind: 'asc' }, { updatedAt: 'desc' }],
    select: {
      id: true,
      parentId: true,
      kind: true,
      title: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return c.json({ notes });
});

// GET /api/notes/search?q=...
notesRoutes.get('/search', async (c) => {
  const userId = c.get('userId');
  const query = (c.req.query('q') ?? '').trim();
  if (!query) return c.json({ results: [], query: '' });
  type Row = {
    id: string;
    title: string;
    snippet: string;
    rank: number;
    parentId: string | null;
  };
  const rows = await db.$queryRaw<Row[]>`
    SELECT
      id, title, "parentId",
      ts_headline(
        'portuguese',
        coalesce("content", ''),
        plainto_tsquery('portuguese', ${query}),
        'StartSel=«, StopSel=», MaxWords=22, MinWords=8, MaxFragments=1, FragmentDelimiter=" … "'
      ) AS snippet,
      ts_rank("searchVector", plainto_tsquery('portuguese', ${query})) AS rank
    FROM "Note"
    WHERE "userId" = ${userId}
      AND kind = 'NOTE'
      AND "searchVector" @@ plainto_tsquery('portuguese', ${query})
    ORDER BY rank DESC, "updatedAt" DESC
    LIMIT 50
  `;
  return c.json({ results: rows, query });
});

// GET /api/notes/:id
notesRoutes.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const note = await db.note.findFirst({
    where: { id, userId },
    select: {
      id: true,
      parentId: true,
      kind: true,
      title: true,
      content: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!note) return c.json({ error: 'Nota não encontrada.' }, 404);
  return c.json({ note });
});

const CreateBody = z.object({
  parentId: z.string().nullable().optional(),
  kind: z.enum(['NOTE', 'FOLDER']).default('NOTE'),
  title: z.string().min(1).max(200),
  content: z.string().max(200_000).optional(),
});

notesRoutes.post('/', async (c) => {
  const userId = c.get('userId');
  const parsed = CreateBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Payload inválido.' }, 400);
  const { parentId, kind, title, content } = parsed.data;

  // Validar parentId — só permite filhar de pasta do mesmo user
  if (parentId) {
    const parent = await db.note.findFirst({
      where: { id: parentId, userId },
      select: { kind: true },
    });
    if (!parent) return c.json({ error: 'Pasta pai não encontrada.' }, 400);
    if (parent.kind !== 'FOLDER') {
      return c.json({ error: 'Só é possível aninhar dentro de pastas.' }, 400);
    }
  }

  const note = await db.note.create({
    data: {
      userId,
      parentId: parentId ?? null,
      kind,
      title: title.trim(),
      content: kind === 'NOTE' ? (content ?? '') : '',
    },
    select: { id: true, parentId: true, kind: true, title: true, updatedAt: true },
  });
  await reindexNotesBrain(userId);
  await invalidateGraphCache(userId);
  return c.json({ note }, 201);
});

const PatchBody = z.object({
  parentId: z.string().nullable().optional(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(200_000).optional(),
});

notesRoutes.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const existing = await db.note.findFirst({
    where: { id, userId },
    select: { id: true, kind: true, parentId: true },
  });
  if (!existing) return c.json({ error: 'Nota não encontrada.' }, 404);

  const parsed = PatchBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Payload inválido.' }, 400);
  const { parentId, title, content } = parsed.data;

  // Mover: validar destino. parentId=null → root.
  if (parentId !== undefined && parentId !== existing.parentId) {
    if (parentId === id) {
      return c.json({ error: 'Não pode se mover pra dentro de si mesma.' }, 400);
    }
    if (parentId !== null) {
      const dest = await db.note.findFirst({
        where: { id: parentId, userId },
        select: { kind: true, parentId: true },
      });
      if (!dest) return c.json({ error: 'Destino não encontrado.' }, 400);
      if (dest.kind !== 'FOLDER') {
        return c.json({ error: 'Destino precisa ser uma pasta.' }, 400);
      }
      // Evita ciclo: se existing é FOLDER, garantir que dest não é descendente
      if (existing.kind === 'FOLDER') {
        const descendants = await getDescendantIds(id);
        if (descendants.has(parentId)) {
          return c.json({ error: 'Não pode mover pasta pra dentro dela mesma.' }, 400);
        }
      }
    }
  }

  const note = await db.note.update({
    where: { id },
    data: {
      ...(parentId !== undefined ? { parentId } : {}),
      ...(title !== undefined ? { title: title.trim() } : {}),
      ...(content !== undefined && existing.kind === 'NOTE' ? { content } : {}),
    },
    select: {
      id: true,
      parentId: true,
      kind: true,
      title: true,
      content: true,
      updatedAt: true,
    },
  });
  await reindexNotesBrain(userId);
  await invalidateGraphCache(userId);
  return c.json({ note });
});

notesRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const existing = await db.note.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) return c.json({ error: 'Nota não encontrada.' }, 404);
  const noteIds = [id, ...(await getDescendantIds(id))];
  await db.note.delete({ where: { id } });
  await deleteBrainForSources(userId, 'NOTE', noteIds);
  await reindexNotesBrain(userId);
  await invalidateGraphCache(userId);
  return c.json({ ok: true });
});

// Helper: coleta IDs dos descendentes (BFS) pra prevenir ciclo na move.
async function getDescendantIds(rootId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const batch = queue.splice(0, queue.length);
    const children = await db.note.findMany({
      where: { parentId: { in: batch } },
      select: { id: true },
    });
    for (const c of children) {
      if (!ids.has(c.id)) {
        ids.add(c.id);
        queue.push(c.id);
      }
    }
  }
  return ids;
}
