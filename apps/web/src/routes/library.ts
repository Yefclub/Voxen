// ============================================================================
// /api/library — organização da biblioteca (pastas compartilhadas)
// ============================================================================
// Endpoints sempre escopados por userId:
//   GET    /api/library/folders
//   POST   /api/library/folders
//   PATCH  /api/library/folders/:id
//   DELETE /api/library/folders/:id
// ============================================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { invalidateGraphCache } from '../lib/graph-cache';

type Vars = { userId: string };

export const libraryRoutes = new Hono<{ Variables: Vars }>();

libraryRoutes.use('*', async (c, next) => {
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

const FolderBody = z.object({
  parentId: z.string().nullable().optional(),
  name: z.string().min(1).max(120),
});

const PatchFolderBody = z.object({
  parentId: z.string().nullable().optional(),
  name: z.string().min(1).max(120).optional(),
});

libraryRoutes.get('/folders', async (c) => {
  const userId = c.get('userId');
  const folders = await db.libraryFolder.findMany({
    where: { userId },
    orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      parentId: true,
      name: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: { transcripts: true, children: true },
      },
    },
  });
  return c.json({ folders });
});

libraryRoutes.post('/folders', async (c) => {
  const userId = c.get('userId');
  const parsed = FolderBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Payload inválido.' }, 400);
  const { parentId, name } = parsed.data;

  if (parentId) {
    const parent = await db.libraryFolder.findFirst({
      where: { id: parentId, userId },
      select: { id: true },
    });
    if (!parent) return c.json({ error: 'Pasta pai não encontrada.' }, 400);
  }

  const folder = await db.libraryFolder.create({
    data: {
      userId,
      parentId: parentId ?? null,
      name: name.trim(),
    },
    select: {
      id: true,
      parentId: true,
      name: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  await invalidateGraphCache(userId);
  return c.json({ folder }, 201);
});

libraryRoutes.patch('/folders/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const existing = await db.libraryFolder.findFirst({
    where: { id, userId },
    select: { id: true, parentId: true },
  });
  if (!existing) return c.json({ error: 'Pasta não encontrada.' }, 404);

  const parsed = PatchFolderBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Payload inválido.' }, 400);
  const { parentId, name } = parsed.data;

  if (parentId !== undefined && parentId !== existing.parentId) {
    if (parentId === id) {
      return c.json({ error: 'Não pode mover pasta para dentro dela mesma.' }, 400);
    }
    if (parentId !== null) {
      const dest = await db.libraryFolder.findFirst({
        where: { id: parentId, userId },
        select: { id: true },
      });
      if (!dest) return c.json({ error: 'Destino não encontrado.' }, 400);
      const descendants = await getDescendantIds(userId, id);
      if (descendants.has(parentId)) {
        return c.json({ error: 'Não pode mover pasta para uma descendente.' }, 400);
      }
    }
  }

  const folder = await db.libraryFolder.update({
    where: { id },
    data: {
      ...(parentId !== undefined ? { parentId } : {}),
      ...(name !== undefined ? { name: name.trim() } : {}),
    },
    select: {
      id: true,
      parentId: true,
      name: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  await invalidateGraphCache(userId);
  return c.json({ folder });
});

libraryRoutes.delete('/folders/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const existing = await db.libraryFolder.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) return c.json({ error: 'Pasta não encontrada.' }, 404);

  await db.libraryFolder.delete({ where: { id } });
  await invalidateGraphCache(userId);
  return c.json({ ok: true });
});

async function getDescendantIds(userId: string, rootId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const batch = queue.splice(0, queue.length);
    const children = await db.libraryFolder.findMany({
      where: { userId, parentId: { in: batch } },
      select: { id: true },
    });
    for (const child of children) {
      if (!ids.has(child.id)) {
        ids.add(child.id);
        queue.push(child.id);
      }
    }
  }
  return ids;
}
