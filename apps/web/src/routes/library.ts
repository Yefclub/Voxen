import { Hono } from 'hono';
import { z } from 'zod';
import { Prisma } from '../../prisma-generated/client';
import { auth } from '../lib/auth';
import {
  deleteBrainForSources,
  reindexLibraryFolderBrain,
  reindexTranscriptsBrain,
} from '../lib/brain';
import { db } from '../lib/db';
import { invalidateGraphCache } from '../lib/graph-cache';
import { classifyFolderForContent } from '../lib/folder-classify';
import { generateTitleForContent } from '../lib/title-generate';
import { generateTagsForContent } from '../lib/tags-generate';
import { applyTagsToTranscript } from '../lib/tags';
import { effectiveTranscriptPlainText } from '../lib/transcript-content';
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

const DEFAULT_TAG_LIST_LIMIT = 6;
const MAX_TAG_LIST_LIMIT = 50;

function parseTagListLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TAG_LIST_LIMIT;
  return Math.min(parsed, MAX_TAG_LIST_LIMIT);
}

function parseTagListOffset(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 10_000);
}

function normalizeTagQuery(value: string | undefined): string | undefined {
  const query = value?.trim().slice(0, 120);
  return query || undefined;
}

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

// Tags com conteúdo ativo para os filtros da Biblioteca. O catálogo é paginado
// no servidor para não transferir/renderizar todas as tags em bases de conhecimento grandes.
libraryRoutes.get('/tags', async (c) => {
  const userId = c.get('userId');
  const limit = parseTagListLimit(c.req.query('limit'));
  const offset = parseTagListOffset(c.req.query('offset'));
  const query = normalizeTagQuery(c.req.query('q'));
  const searchClause = query ? Prisma.sql`AND tag.name ILIKE ${`%${query}%`}` : Prisma.empty;
  const [tags, totals] = await Promise.all([
    db.$queryRaw<Array<{ id: string; name: string; slug: string; count: bigint }>>`
    SELECT tag.id, tag.name, tag.slug, COUNT(tt."transcriptId")::bigint AS count
    FROM "Tag" tag
    JOIN "TranscriptTag" tt ON tt."tagId" = tag.id
    JOIN "Transcript" t ON t.id = tt."transcriptId"
    WHERE tag."userId" = ${userId}
      AND t."userId" = ${userId}
      AND t.status = 'ACTIVE'::"ContentStatus"
      ${searchClause}
    GROUP BY tag.id, tag.name, tag.slug
    ORDER BY count DESC, tag.name ASC, tag.id ASC
    LIMIT ${limit} OFFSET ${offset}
  `,
    db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(DISTINCT tag.id)::bigint AS count
      FROM "Tag" tag
      JOIN "TranscriptTag" tt ON tt."tagId" = tag.id
      JOIN "Transcript" t ON t.id = tt."transcriptId"
      WHERE tag."userId" = ${userId}
        AND t."userId" = ${userId}
        AND t.status = 'ACTIVE'::"ContentStatus"
        ${searchClause}
    `,
  ]);
  const total = Number(totals[0]?.count ?? 0);
  return c.json({
    tags: tags.map((tag) => ({ ...tag, count: Number(tag.count) })),
    total,
    limit,
    offset,
    query: query ?? '',
    hasMore: offset + tags.length < total,
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
            classified: Boolean(result.folderName),
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

function titleSourceLabel(item: { source: string; channel: string | null; url: string }): string {
  if (item.source === 'WEB') return 'Página web';
  if (item.source === 'UPLOAD') return 'Upload';
  return item.channel ? `${item.channel} · ${item.source}` : `Conteúdo ${item.source}`;
}

// POST /api/library/regenerate-titles — regenera o título editorial via IA em
// lote, drenando a Base de conhecimento por cursor (createdAt+id desc). Idempotente: re-rodar
// devolve KEEP para títulos já bons. CUSTA créditos (1 chamada LLM por item).
libraryRoutes.post('/regenerate-titles', async (c) => {
  const userId = c.get('userId');
  if (!(await isSetupComplete())) {
    return c.json({ error: 'Setup incompleto.' }, 412);
  }

  const body = (await c.req.json().catch(() => ({}))) as { limit?: number; cursor?: string };
  const limitRaw = Number(body.limit ?? 15);
  const limit =
    Number.isFinite(limitRaw) && limitRaw >= 1 && limitRaw <= 40 ? Math.floor(limitRaw) : 15;
  const cursor = typeof body.cursor === 'string' && body.cursor ? body.cursor : null;

  const pendingTotal = await db.transcript.count({ where: { userId, status: 'ACTIVE' } });

  const batch = await db.transcript.findMany({
    where: { userId, status: 'ACTIVE' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      title: true,
      source: true,
      channel: true,
      url: true,
      plainText: true,
      summaryMd: true,
    },
  });

  let changed = 0;
  let kept = 0;
  let skipped = 0;
  let failed = 0;
  const changedIds: string[] = [];

  for (const item of batch) {
    try {
      const content = ((item.plainText ?? '') || (item.summaryMd ?? '')).trim();
      if (content.length < 40) {
        skipped += 1;
        continue;
      }
      const result = await generateTitleForContent({
        title: item.title,
        content,
        sourceLabel: titleSourceLabel(item),
      });
      await db.costEvent.create({
        data: {
          userId,
          kind: 'CHAT',
          model: result.model,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          costUsd: result.costUsd,
          meta: { source: 'title_generation_backfill', transcript_id: item.id },
        },
      });
      if (result.changed) {
        await db.transcript.updateMany({
          where: { id: item.id, userId },
          data: { title: result.title },
        });
        changedIds.push(item.id);
        changed += 1;
      } else {
        kept += 1;
      }
    } catch {
      failed += 1;
    }
  }

  if (changedIds.length > 0) {
    await reindexTranscriptsBrain(userId, changedIds).catch(() => {});
    await invalidateGraphCache(userId).catch(() => {});
  }

  // Continua enquanto o lote veio cheio (há mais para drenar).
  const nextCursor = batch.length === limit ? (batch[batch.length - 1]?.id ?? null) : null;

  return c.json({
    processed: batch.length,
    changed,
    kept,
    skipped,
    failed,
    pendingTotal,
    nextCursor,
  });
});

libraryRoutes.post('/generate-tags', async (c) => {
  const userId = c.get('userId');
  if (!(await isSetupComplete())) {
    return c.json({ error: 'Setup incompleto.' }, 412);
  }

  const body = (await c.req.json().catch(() => ({}))) as { limit?: number };
  const limitRaw = Number(body.limit ?? 10);
  const limit =
    Number.isFinite(limitRaw) && limitRaw >= 1 && limitRaw <= 30 ? Math.floor(limitRaw) : 10;

  const pendingTotal = await db.transcript.count({
    where: { userId, status: 'ACTIVE', tags: { none: {} } },
  });
  if (pendingTotal === 0) {
    return c.json({
      processed: 0,
      tagged: 0,
      skipped: 0,
      failed: 0,
      remaining: 0,
      pendingTotal: 0,
    });
  }

  const batch = await db.transcript.findMany({
    where: { userId, status: 'ACTIVE', tags: { none: {} } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      title: true,
      plainText: true,
      correctedPlainText: true,
      correctionState: true,
      correctionRevision: true,
      sourceVersion: true,
      sourceChecksum: true,
      summaryMd: true,
      folderId: true,
    },
  });

  const existingTagNames = new Set(
    (
      await db.tag.findMany({ where: { userId }, select: { name: true }, orderBy: { name: 'asc' } })
    ).map((t) => t.name),
  );

  let tagged = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of batch) {
    try {
      const content = ((item.summaryMd ?? '') || effectiveTranscriptPlainText(item)).trim();
      if (content.length < 40 && item.title.trim().length < 3) {
        skipped += 1;
        continue;
      }
      const result = await generateTagsForContent({
        title: item.title,
        content: content || item.title,
        existingTags: [...existingTagNames],
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
            source: 'tag_generation_backfill',
            transcript_id: item.id,
            generated_count: result.tags.length,
          },
        },
      });
      if (result.tags.length === 0) {
        skipped += 1;
        continue;
      }
      const applied = await applyTagsToTranscript(
        userId,
        {
          id: item.id,
          folderId: item.folderId,
          correctionRevision: item.correctionRevision,
          sourceVersion: item.sourceVersion,
          sourceChecksum: item.sourceChecksum,
        },
        result.tags,
      );
      for (const t of applied) existingTagNames.add(t.name);
      tagged += 1;
    } catch {
      failed += 1;
    }
  }

  const remaining = await db.transcript.count({
    where: { userId, status: 'ACTIVE', tags: { none: {} } },
  });

  return c.json({ processed: batch.length, tagged, skipped, failed, remaining, pendingTotal });
});

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
