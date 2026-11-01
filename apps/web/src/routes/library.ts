import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from '../lib/auth';
import { reindexLibraryFolderBrain } from '../lib/brain';
import { db } from '../lib/db';
import { invalidateGraphCache } from '../lib/graph-cache';
import { enqueueKnowledgeDeletion, knowledgeDeletionHttpError } from '../lib/knowledge-deletion';
import { libraryTagRoutes } from './library-tags';

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

libraryRoutes.route('/', libraryTagRoutes);

libraryRoutes.get('/folders', async (c) => {
  const userId = c.get('userId');
  const [folders, memberCounts] = await Promise.all([
    db.libraryFolder.findMany({
      where: { userId },
      orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        parentId: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { children: true } },
      },
    }),
    db.$queryRaw<Array<{ id: string; count: bigint }>>`
      SELECT f.id, COUNT(m.id)::bigint AS count
      FROM "LibraryFolder" f
      LEFT JOIN LATERAL (
        SELECT t.id FROM "Transcript" t
        WHERE t."userId" = ${userId} AND t."folderId" = f.id
        UNION
        SELECT tt."transcriptId" AS id
        FROM "TranscriptTag" tt
        JOIN "Tag" tag ON tag.id = tt."tagId"
        JOIN "Transcript" t ON t.id = tt."transcriptId" AND t."userId" = ${userId}
        WHERE tag."userId" = ${userId} AND tag."folderId" = f.id
      ) m ON TRUE
      WHERE f."userId" = ${userId}
      GROUP BY f.id
    `,
  ]);
  const counts = new Map(memberCounts.map((item) => [item.id, Number(item.count)]));
  return c.json({
    folders: folders.map((folder) => ({
      ...folder,
      _count: { children: folder._count.children, transcripts: counts.get(folder.id) ?? 0 },
    })),
  });
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
  await reindexLibraryFolderBrain(userId, folder.id);
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
  await reindexLibraryFolderBrain(userId, folder.id);
  await invalidateGraphCache(userId);
  return c.json({ folder });
});

libraryRoutes.post('/folders/clear', async (c) => {
  const userId = c.get('userId');
  const folders = await db.libraryFolder.findMany({
    where: { userId },
    select: { id: true },
  });
  if (folders.length === 0) {
    return c.json({ ok: true, deleted: 0, affectedTranscripts: 0 });
  }
  const folderIds = folders.map((f) => f.id);
  const affectedCount = await db.transcript.count({
    where: { userId, folderId: { in: folderIds } },
  });
  try {
    const result = await enqueueKnowledgeDeletion({
      userId,
      type: 'LIBRARY_FOLDER',
      id: '*',
      allowAllLibraryFolders: true,
    });
    return c.json(
      {
        ok: true,
        queued: true,
        jobId: result.job.id,
        reused: !result.created,
        deleted: folderIds.length,
        affectedTranscripts: affectedCount,
      },
      202,
    );
  } catch (error) {
    return knowledgeDeletionHttpError(error) ?? Promise.reject(error);
  }
});

libraryRoutes.delete('/folders/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  try {
    const result = await enqueueKnowledgeDeletion({ userId, type: 'LIBRARY_FOLDER', id });
    return c.json(
      {
        ok: true,
        queued: true,
        jobId: result.job.id,
        target: result.target,
        reused: !result.created,
      },
      202,
    );
  } catch (error) {
    return knowledgeDeletionHttpError(error) ?? Promise.reject(error);
  }
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
