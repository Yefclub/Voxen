// ============================================================================
// Persistência de tags (spec 075).
// Cria/reutiliza Tag por slug, garante a LibraryFolder de mesmo nome e liga o
// Transcript via TranscriptTag. Aplica a regra de folderId único: define a pasta
// só quando o conteúdo ainda não tem pasta (primeira tag).
// ============================================================================

import { db } from './db';
import { reindexLibraryFolderBrain, reindexTranscriptsBrain } from './brain';
import { invalidateGraphCache } from './graph-cache';
import { pickFolderId, slugifyTag } from './tags-generate';

export interface AppliedTag {
  id: string;
  name: string;
  slug: string;
}

// Garante uma LibraryFolder de mesmo nome para a tag. Reutiliza uma pasta livre
// (sem tag vinculada) se já existir; senão cria. Retorna o id da pasta.
async function ensureFolderForTag(
  userId: string,
  name: string,
): Promise<{ folderId: string; created: boolean }> {
  const free = await db.libraryFolder.findFirst({
    where: { userId, name: { equals: name, mode: 'insensitive' }, tag: { is: null } },
    select: { id: true },
  });
  if (free) return { folderId: free.id, created: false };
  const created = await db.libraryFolder.create({
    data: { userId, name: name.slice(0, 120), parentId: null },
    select: { id: true },
  });
  return { folderId: created.id, created: true };
}

// Cria/reutiliza a Tag por (userId, slug) e garante sua pasta. Idempotente.
async function ensureTagWithFolder(
  userId: string,
  name: string,
): Promise<{ tag: AppliedTag; folderId: string; folderCreated: boolean }> {
  const slug = slugifyTag(name);
  const existing = await db.tag.findUnique({
    where: { userId_slug: { userId, slug } },
    select: { id: true, name: true, slug: true, folderId: true },
  });

  if (existing) {
    let folderId = existing.folderId;
    let folderCreated = false;
    if (!folderId) {
      const f = await ensureFolderForTag(userId, existing.name);
      folderId = f.folderId;
      folderCreated = f.created;
      await db.tag.update({ where: { id: existing.id }, data: { folderId } });
    }
    return {
      tag: { id: existing.id, name: existing.name, slug: existing.slug },
      folderId,
      folderCreated,
    };
  }

  const { folderId, created: folderCreated } = await ensureFolderForTag(userId, name);
  try {
    const tag = await db.tag.create({
      data: { userId, name: name.slice(0, 120), slug, folderId },
      select: { id: true, name: true, slug: true },
    });
    return { tag, folderId, folderCreated };
  } catch {
    // Corrida: outra requisição criou a mesma tag. Relê.
    const raced = await db.tag.findUnique({
      where: { userId_slug: { userId, slug } },
      select: { id: true, name: true, slug: true, folderId: true },
    });
    if (raced) {
      return {
        tag: { id: raced.id, name: raced.name, slug: raced.slug },
        folderId: raced.folderId ?? folderId,
        folderCreated: false,
      };
    }
    throw new Error('Falha ao criar tag.');
  }
}

/**
 * Aplica uma lista de nomes de tag a um transcript: garante cada Tag + pasta,
 * liga via TranscriptTag (sem duplicar) e, se o transcript não tiver pasta,
 * define folderId com a pasta da primeira tag. Reindexa Brain best-effort.
 * Retorna as tags efetivamente vinculadas.
 */
export async function applyTagsToTranscript(
  userId: string,
  transcript: { id: string; folderId: string | null },
  tagNames: string[],
): Promise<AppliedTag[]> {
  const applied: AppliedTag[] = [];
  const newFolderIds: string[] = [];
  let firstFolderId: string | null = null;

  for (const name of tagNames) {
    const { tag, folderId, folderCreated } = await ensureTagWithFolder(userId, name);
    if (firstFolderId === null) firstFolderId = folderId;
    if (folderCreated) newFolderIds.push(folderId);
    await db.transcriptTag.createMany({
      data: [{ transcriptId: transcript.id, tagId: tag.id }],
      skipDuplicates: true,
    });
    applied.push(tag);
  }

  // R-FOLDER: seta a pasta só quando ainda não há uma (não move conteúdo já
  // organizado). updateMany com guarda folderId null evita corrida.
  const targetFolderId = pickFolderId(transcript.folderId, firstFolderId);
  if (targetFolderId && transcript.folderId === null) {
    await db.transcript.updateMany({
      where: { id: transcript.id, userId, folderId: null },
      data: { folderId: targetFolderId },
    });
  }

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
