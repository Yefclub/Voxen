// ============================================================================
// Persistência de tags (spec 075).
// Cria/reutiliza Tag por slug, garante a LibraryFolder de mesmo nome e liga o
// Transcript via TranscriptTag. Aplica a regra de folderId único: define a pasta
// só quando o conteúdo ainda não tem pasta (primeira tag).
// ============================================================================

import { db } from './db';
import type { Prisma } from '../../prisma-generated/client';
import { reindexLibraryFolderBrain, reindexTranscriptsBrain } from './brain';
import { invalidateGraphCache } from './graph-cache';
import { orderUniqueTagNames, pickFolderId, slugifyTag } from './tags-generate';

export interface AppliedTag {
  id: string;
  name: string;
  slug: string;
}

// Garante uma LibraryFolder de mesmo nome para a tag. Reutiliza uma pasta livre
// (sem tag vinculada) se já existir; senão cria. Retorna o id da pasta.
async function ensureFolderForTag(
  tx: Prisma.TransactionClient,
  userId: string,
  name: string,
): Promise<{ folderId: string; created: boolean }> {
  const free = await tx.libraryFolder.findFirst({
    where: { userId, name: { equals: name, mode: 'insensitive' }, tag: { is: null } },
    select: { id: true },
  });
  if (free) return { folderId: free.id, created: false };
  const created = await tx.libraryFolder.create({
    data: { userId, name: name.slice(0, 120), parentId: null },
    select: { id: true },
  });
  return { folderId: created.id, created: true };
}

// Cria/reutiliza a Tag por (userId, slug) e garante sua pasta. Idempotente.
async function ensureTagWithFolder(
  tx: Prisma.TransactionClient,
  userId: string,
  name: string,
): Promise<{ tag: AppliedTag; folderId: string; folderCreated: boolean }> {
  const slug = slugifyTag(name);
  const existing = await tx.tag.findUnique({
    where: { userId_slug: { userId, slug } },
    select: { id: true, name: true, slug: true, folderId: true },
  });

  if (existing) {
    let folderId = existing.folderId;
    let folderCreated = false;
    if (!folderId) {
      const f = await ensureFolderForTag(tx, userId, existing.name);
      folderId = f.folderId;
      folderCreated = f.created;
      await tx.tag.update({ where: { id: existing.id }, data: { folderId } });
    }
    return {
      tag: { id: existing.id, name: existing.name, slug: existing.slug },
      folderId,
      folderCreated,
    };
  }

  const { folderId, created: folderCreated } = await ensureFolderForTag(tx, userId, name);
  const tag = await tx.tag.create({
    data: { userId, name: name.slice(0, 120), slug, folderId },
    select: { id: true, name: true, slug: true },
  });
  return { tag, folderId, folderCreated };
}

/**
 * Aplica uma lista de nomes de tag a um transcript: garante cada Tag + pasta,
 * liga via TranscriptTag (sem duplicar) e, se o transcript não tiver pasta,
 * define folderId com a pasta da primeira tag. Reindexa Brain best-effort.
 * Retorna as tags efetivamente vinculadas.
 */
export async function applyTagsToTranscript(
  userId: string,
  transcript: {
    id: string;
    folderId: string | null;
    correctionRevision: number;
    sourceVersion: number;
    sourceChecksum: string | null;
  },
  tagNames: string[],
): Promise<AppliedTag[]> {
  const result = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ folderId: string | null }>>`
      SELECT "folderId" FROM "Transcript"
      WHERE id = ${transcript.id} AND "userId" = ${userId}
        AND "correctionRevision" = ${transcript.correctionRevision}
        AND "sourceVersion" = ${transcript.sourceVersion}
        AND "sourceChecksum" IS NOT DISTINCT FROM ${transcript.sourceChecksum}
      FOR UPDATE
    `;
    if (!rows[0]) return { applied: [] as AppliedTag[], newFolderIds: [] as string[] };
    const orderedTagNames = orderUniqueTagNames(tagNames);
    for (const { slug } of orderedTagNames) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${slug}`}))`;
    }
    const prepared: Array<{ tag: AppliedTag; folderId: string }> = [];
    const newFolderIds: string[] = [];
    for (const { name } of orderedTagNames) {
      const { tag, folderId, folderCreated } = await ensureTagWithFolder(tx, userId, name);
      if (folderCreated) newFolderIds.push(folderId);
      prepared.push({ tag, folderId });
    }
    await tx.transcriptTag.createMany({
      data: prepared.map(({ tag }) => ({ transcriptId: transcript.id, tagId: tag.id })),
      skipDuplicates: true,
    });
    const targetFolderId = pickFolderId(rows[0].folderId, prepared[0]?.folderId ?? null);
    if (targetFolderId && rows[0].folderId === null) {
      await tx.transcript.update({
        where: { id: transcript.id },
        data: { folderId: targetFolderId },
      });
    }
    return { applied: prepared.map(({ tag }) => tag), newFolderIds };
  });
  const { applied, newFolderIds } = result;

  // Reindex Brain best-effort: pastas novas + transcript atualizado.
  if (newFolderIds.length > 0) {
    for (const fid of newFolderIds) {
      await reindexLibraryFolderBrain(userId, fid).catch(() => {});
    }
  }
  if (applied.length > 0) {
    await reindexTranscriptsBrain(userId, [transcript.id]).catch(() => {});
    await invalidateGraphCache(userId).catch(() => {});
  }

  return applied;
}
