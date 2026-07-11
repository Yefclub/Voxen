// ============================================================================
// /api/library — organização da biblioteca (pastas compartilhadas)
// ============================================================================
// Endpoints sempre escopados por userId:
//   GET    /api/library/folders
//   POST   /api/library/folders
//   POST   /api/library/folders/clear — apaga todas as pastas (conteúdos ficam)
//   PATCH  /api/library/folders/:id
//   DELETE /api/library/folders/:id
//   POST   /api/library/reorganize — classifica com IA só o que não tem pasta
// ============================================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { auth } from '../lib/auth';
import {
  deleteBrainForSources,
  reindexLibraryFolderBrain,
  reindexTranscriptsBrain,
} from '../lib/brain';
import { db } from '../lib/db';
import { invalidateGraphCache } from '../lib/graph-cache';
import { classifyFolderForContent } from '../lib/folder-classify';
import { isSetupComplete } from '../lib/settings';

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

// POST /api/library/reorganize — só transcripts ACTIVE com folderId null.
// Processa em lotes (default 15) pra não estourar timeout do request.
libraryRoutes.post('/reorganize', async (c) => {
  const userId = c.get('userId');
  if (!(await isSetupComplete())) {
    return c.json({ error: 'Setup incompleto.' }, 412);
  }

  const body = (await c.req.json().catch(() => ({}))) as { limit?: number };
  const limitRaw = Number(body.limit ?? 15);
  const limit =
    Number.isFinite(limitRaw) && limitRaw >= 1 && limitRaw <= 40 ? Math.floor(limitRaw) : 15;

  const pendingTotal = await db.transcript.count({
    where: { userId, status: 'ACTIVE', folderId: null },
  });
  if (pendingTotal === 0) {
    return c.json({
      processed: 0,
      assigned: 0,
      skipped: 0,
      failed: 0,
      remaining: 0,
      pendingTotal: 0,
    });
  }

  const batch = await db.transcript.findMany({
    where: { userId, status: 'ACTIVE', folderId: null },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, title: true, plainText: true },
  });

  let assigned = 0;
  let skipped = 0;
  let failed = 0;
  const folderNames = (
    await db.libraryFolder.findMany({
      where: { userId },
      select: { name: true },
      orderBy: { name: 'asc' },
    })
  ).map((f) => f.name);

  const assignedIds: string[] = [];

  for (const item of batch) {
    try {
      const content = (item.plainText ?? '').trim();
      if (content.length < 40 && item.title.trim().length < 3) {
        skipped += 1;
        continue;
      }
      const result = await classifyFolderForContent({
        title: item.title,
        content: content || item.title,
        existingFolders: folderNames,
      });
      await db.costEvent.create({
        data: {
          userId,
          kind: 'CHAT',
          model: result.model,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          costUsd: result.costUsd,
          meta: {
            source: 'folder_classification_backfill',
            transcript_id: item.id,
            folder_name: result.folderName,
          },
        },
      });
      if (!result.folderName) {
        skipped += 1;
        continue;
      }
      const existing = await db.libraryFolder.findFirst({
        where: { userId, name: { equals: result.folderName, mode: 'insensitive' } },
        select: { id: true, name: true },
      });
      let folderId: string;
      let folderName: string;
      if (existing) {
        folderId = existing.id;
        folderName = existing.name;
      } else {
        const created = await db.libraryFolder.create({
          data: { userId, name: result.folderName.slice(0, 120), parentId: null },
          select: { id: true, name: true },
        });
        folderId = created.id;
        folderName = created.name;
        folderNames.push(folderName);
        await reindexLibraryFolderBrain(userId, folderId).catch(() => {});
      }
      await db.transcript.updateMany({
        where: { id: item.id, userId, folderId: null },
        data: { folderId },
      });
      assignedIds.push(item.id);
      assigned += 1;
    } catch {
      failed += 1;
    }
  }

  if (assignedIds.length > 0) {
    await reindexTranscriptsBrain(userId, assignedIds).catch(() => {});
    await invalidateGraphCache(userId).catch(() => {});
  }

  const remaining = await db.transcript.count({
    where: { userId, status: 'ACTIVE', folderId: null },
  });

  return c.json({
    processed: batch.length,
    assigned,
    skipped,
    failed,
    remaining,
    pendingTotal,
  });
});

// Limpa TODAS as pastas do usuário: conteúdos ficam (folderId → null via onDelete SetNull).
// Libera de novo o "Organizar com IA" (só classifica folderId null).
// Brain cleanup é best-effort e NÃO bloqueia a resposta (evita 502 por timeout
// quando há dezenas de pastas/conteúdos e reindex síncrono estoura o proxy).
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
  await db.libraryFolder.deleteMany({ where: { userId } });
  // folderId já vai null (onDelete SetNull). Nós FOLDER do brain + arestas
  // em cascata; não reindexa todos os transcripts síncrono.
  void deleteBrainForSources(userId, 'FOLDER', folderIds)
    .then(() => invalidateGraphCache(userId))
    .catch((err) => {
      console.warn('[library] clear folders brain cleanup failed', { userId, err });
    });
  return c.json({
    ok: true,
    deleted: folderIds.length,
    affectedTranscripts: affectedCount,
  });
});

libraryRoutes.delete('/folders/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const existing = await db.libraryFolder.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) return c.json({ error: 'Pasta não encontrada.' }, 404);

  const folderIds = [id, ...(await getDescendantIds(userId, id))];
  const affectedTranscripts = await db.transcript.findMany({
    where: { userId, folderId: { in: folderIds } },
    select: { id: true },
  });
  await db.libraryFolder.delete({ where: { id } });
  await deleteBrainForSources(userId, 'FOLDER', folderIds);
  await reindexTranscriptsBrain(
    userId,
    affectedTranscripts.map((item) => item.id),
  );
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
