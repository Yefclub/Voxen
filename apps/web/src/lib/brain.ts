import type { Prisma } from '../../prisma-generated/client';
import { db } from './db';

type BrainSourceType = 'TRANSCRIPT' | 'NOTE' | 'FOLDER' | 'JOB' | 'CHAT' | 'MANUAL';
type BrainNodeType = 'CONTENT' | 'FOLDER' | 'ENTITY' | 'TOPIC' | 'CLAIM' | 'EVENT' | 'CLUSTER';
type BrainEdgeKind =
  | 'BELONGS_TO'
  | 'LINKS_TO'
  | 'MENTIONS'
  | 'SUPPORTS'
  | 'CONTRADICTS'
  | 'SAME_AS'
  | 'PART_OF'
  | 'RELATED_TO'
  | 'NEXT_TO';
type ContentStatus = 'ACTIVE' | 'ARCHIVED' | 'TRASH';

type JsonObject = Prisma.InputJsonObject;

type BrainNodeInput = {
  userId: string;
  key: string;
  type: BrainNodeType;
  label: string;
  description?: string | null;
  status?: ContentStatus;
  metadata?: JsonObject;
  sourceType?: BrainSourceType | null;
  sourceId?: string | null;
};

type BrainEdgeInput = {
  userId: string;
  fromNodeId: string;
  toNodeId: string;
  kind: BrainEdgeKind;
  method: string;
  status?: ContentStatus;
  confidence?: number;
  metadata?: JsonObject;
  sourceType: BrainSourceType;
  sourceId: string;
  excerpt?: string | null;
};

type NoteRecord = {
  id: string;
  parentId: string | null;
  kind: 'NOTE' | 'FOLDER';
  title: string;
  content: string;
  updatedAt: Date;
};

type LibraryFolderRecord = {
  id: string;
  parentId: string | null;
  name: string;
  updatedAt: Date;
};

const DESCRIPTION_LIMIT = 800;
const EVIDENCE_LIMIT = 600;

export function brainNodeKey(sourceType: BrainSourceType, sourceId: string): string {
  return `${sourceType}:${sourceId}`;
}

export async function deleteBrainForSource(
  userId: string,
  sourceType: BrainSourceType,
  sourceId: string,
): Promise<void> {
  await db.brainNode.deleteMany({ where: { userId, sourceType, sourceId } });
  await removeSourceEvidence(userId, sourceType, sourceId);
}

export async function deleteBrainForSources(
  userId: string,
  sourceType: BrainSourceType,
  sourceIds: string[],
): Promise<void> {
  for (const sourceId of sourceIds) {
    await deleteBrainForSource(userId, sourceType, sourceId);
  }
}

export async function reindexTranscriptBrain(userId: string, transcriptId: string): Promise<void> {
  const transcript = await db.transcript.findFirst({
    where: { id: transcriptId, userId },
    select: {
      id: true,
      folderId: true,
      folder: { select: { id: true, parentId: true, name: true, updatedAt: true } },
      status: true,
      source: true,
      url: true,
      title: true,
      channel: true,
      language: true,
      transcriptionMethod: true,
      thumbnailUrl: true,
      plainText: true,
      summaryMd: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!transcript) {
    await deleteBrainForSource(userId, 'TRANSCRIPT', transcriptId);
    return;
  }

  await removeSourceEvidence(userId, 'TRANSCRIPT', transcript.id);
  const contentNode = await upsertBrainNode({
    userId,
    key: brainNodeKey('TRANSCRIPT', transcript.id),
    type: 'CONTENT',
    label: transcript.title,
    description: truncate(transcript.summaryMd || transcript.plainText, DESCRIPTION_LIMIT),
    status: transcript.status,
    metadata: {
      source: transcript.source,
      url: transcript.url,
      channel: transcript.channel,
      language: transcript.language,
      transcriptionMethod: transcript.transcriptionMethod,
      thumbnailUrl: transcript.thumbnailUrl,
      createdAt: transcript.createdAt.toISOString(),
    },
    sourceType: 'TRANSCRIPT',
    sourceId: transcript.id,
  });
  await addBrainSource({
    userId,
    nodeId: contentNode.id,
    sourceType: 'TRANSCRIPT',
    sourceId: transcript.id,
    excerpt: transcript.title,
  });

  if (transcript.folder) {
    const folderNode = await upsertLibraryFolderNode(userId, transcript.folder);
    await upsertBrainEdge({
      userId,
      fromNodeId: contentNode.id,
      toNodeId: folderNode.id,
      kind: 'BELONGS_TO',
      method: 'folder',
      status: transcript.status,
      sourceType: 'TRANSCRIPT',
      sourceId: transcript.id,
      excerpt: `Folder: ${transcript.folder.name}`,
    });
  }
}

export async function reindexTranscriptsBrain(
  userId: string,
  transcriptIds?: string[],
): Promise<void> {
  const ids =
    transcriptIds ??
    (
      await db.transcript.findMany({
        where: { userId },
        select: { id: true },
      })
    ).map((item) => item.id);
  for (const id of ids) {
    await reindexTranscriptBrain(userId, id);
  }
}

export async function reindexLibraryFolderBrain(userId: string, folderId: string): Promise<void> {
  const folder = await db.libraryFolder.findFirst({
    where: { id: folderId, userId },
    select: { id: true, parentId: true, name: true, updatedAt: true },
  });
  if (!folder) {
    await deleteBrainForSource(userId, 'FOLDER', folderId);
    return;
  }

  await removeSourceEvidence(userId, 'FOLDER', folder.id);
  const folderNode = await upsertLibraryFolderNode(userId, folder);
  await addBrainSource({
    userId,
    nodeId: folderNode.id,
    sourceType: 'FOLDER',
    sourceId: folder.id,
    excerpt: folder.name,
  });

  if (folder.parentId) {
    const parent = await db.libraryFolder.findFirst({
      where: { id: folder.parentId, userId },
      select: { id: true, parentId: true, name: true, updatedAt: true },
    });
    if (parent) {
      const parentNode = await upsertLibraryFolderNode(userId, parent);
      await upsertBrainEdge({
        userId,
        fromNodeId: folderNode.id,
        toNodeId: parentNode.id,
        kind: 'BELONGS_TO',
        method: 'folder-tree',
        sourceType: 'FOLDER',
        sourceId: folder.id,
        excerpt: `Parent folder: ${parent.name}`,
      });
    }
  }
}

export async function reindexLibraryFoldersBrain(userId: string): Promise<void> {
  const folders = await db.libraryFolder.findMany({
    where: { userId },
    select: { id: true },
  });
  for (const folder of folders) {
    await reindexLibraryFolderBrain(userId, folder.id);
  }
}

export async function reindexNoteBrain(userId: string, noteId: string): Promise<void> {
  const notes = await db.note.findMany({
    where: { userId },
    select: {
      id: true,
      parentId: true,
      kind: true,
      title: true,
      content: true,
      updatedAt: true,
    },
  });
  const note = notes.find((item) => item.id === noteId);
  if (!note) {
    await deleteBrainForSource(userId, 'NOTE', noteId);
    return;
  }
  await reindexNoteRecord(userId, note, buildNoteIndexes(notes));
}

export async function reindexNotesBrain(userId: string): Promise<void> {
  const notes = await db.note.findMany({
    where: { userId },
    select: {
      id: true,
      parentId: true,
      kind: true,
      title: true,
      content: true,
      updatedAt: true,
    },
  });
  const indexes = buildNoteIndexes(notes);
  for (const note of notes) {
    await reindexNoteRecord(userId, note, indexes);
  }
}

async function reindexNoteRecord(
  userId: string,
  note: NoteRecord,
  indexes: { byId: Map<string, NoteRecord>; byTitle: Map<string, NoteRecord> },
): Promise<void> {
  await removeSourceEvidence(userId, 'NOTE', note.id);
  const node = await upsertNoteNode(userId, note);
  await addBrainSource({
    userId,
    nodeId: node.id,
    sourceType: 'NOTE',
    sourceId: note.id,
    excerpt: note.title,
  });

  if (note.parentId) {
    const parent = indexes.byId.get(note.parentId);
    if (parent) {
      const parentNode = await upsertNoteNode(userId, parent);
      await upsertBrainEdge({
        userId,
        fromNodeId: node.id,
        toNodeId: parentNode.id,
        kind: 'BELONGS_TO',
        method: 'note-tree',
        sourceType: 'NOTE',
        sourceId: note.id,
        excerpt: `Parent note folder: ${parent.title}`,
      });
    }
  }

  if (note.kind !== 'NOTE') return;
  for (const targetTitle of parseWikiLinks(note.content)) {
    const target = indexes.byTitle.get(targetTitle.toLowerCase());
    if (!target || target.id === note.id) continue;
    const targetNode = await upsertNoteNode(userId, target);
    await upsertBrainEdge({
      userId,
      fromNodeId: node.id,
      toNodeId: targetNode.id,
      kind: 'LINKS_TO',
      method: 'wikilink',
      sourceType: 'NOTE',
      sourceId: note.id,
      excerpt: `[[${targetTitle}]]`,
      metadata: { targetTitle },
    });
  }
}

async function removeSourceEvidence(
  userId: string,
  sourceType: BrainSourceType,
  sourceId: string,
): Promise<void> {
  const affected = await db.brainSource.findMany({
    where: { userId, sourceType, sourceId },
    select: { edgeId: true },
  });
  const edgeIds = [...new Set(affected.map((item) => item.edgeId).filter(Boolean) as string[])];
  await db.brainSource.deleteMany({ where: { userId, sourceType, sourceId } });
  if (edgeIds.length === 0) return;

  const remaining = await db.brainSource.findMany({
    where: { userId, edgeId: { in: edgeIds } },
    select: { edgeId: true },
  });
  const remainingEdgeIds = new Set(remaining.map((item) => item.edgeId).filter(Boolean));
  const orphanEdgeIds = edgeIds.filter((id) => !remainingEdgeIds.has(id));
  if (orphanEdgeIds.length > 0) {
    await db.brainEdge.deleteMany({
      where: { userId, id: { in: orphanEdgeIds }, method: { not: 'manual' } },
    });
  }
}

async function upsertLibraryFolderNode(userId: string, folder: LibraryFolderRecord) {
  return upsertBrainNode({
    userId,
    key: brainNodeKey('FOLDER', folder.id),
    type: 'FOLDER',
    label: folder.name,
    status: 'ACTIVE',
    metadata: {
      parentId: folder.parentId,
      updatedAt: folder.updatedAt.toISOString(),
    },
    sourceType: 'FOLDER',
    sourceId: folder.id,
  });
}

async function upsertNoteNode(userId: string, note: NoteRecord) {
  return upsertBrainNode({
    userId,
    key: brainNodeKey('NOTE', note.id),
    type: note.kind === 'FOLDER' ? 'FOLDER' : 'CONTENT',
    label: note.title,
    description: note.kind === 'NOTE' ? truncate(note.content, DESCRIPTION_LIMIT) : null,
    status: 'ACTIVE',
    metadata: {
      kind: note.kind,
      parentId: note.parentId,
      updatedAt: note.updatedAt.toISOString(),
    },
    sourceType: 'NOTE',
    sourceId: note.id,
  });
}

async function upsertBrainNode(input: BrainNodeInput) {
  return db.brainNode.upsert({
    where: { userId_key: { userId: input.userId, key: input.key } },
    update: {
      type: input.type,
      label: input.label,
      description: input.description ?? null,
      status: input.status ?? 'ACTIVE',
      metadata: input.metadata ?? {},
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
    },
    create: {
      userId: input.userId,
      key: input.key,
      type: input.type,
      label: input.label,
      description: input.description ?? null,
      status: input.status ?? 'ACTIVE',
      metadata: input.metadata ?? {},
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
    },
  });
}

async function upsertBrainEdge(input: BrainEdgeInput) {
  const edge = await db.brainEdge.upsert({
    where: {
      userId_fromNodeId_toNodeId_kind_method: {
        userId: input.userId,
        fromNodeId: input.fromNodeId,
        toNodeId: input.toNodeId,
        kind: input.kind,
        method: input.method,
      },
    },
    update: {
      confidence: input.confidence ?? 1,
      status: input.status ?? 'ACTIVE',
      metadata: input.metadata ?? {},
    },
    create: {
      userId: input.userId,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      kind: input.kind,
      method: input.method,
      confidence: input.confidence ?? 1,
      status: input.status ?? 'ACTIVE',
      metadata: input.metadata ?? {},
    },
  });
  await addBrainSource({
    userId: input.userId,
    edgeId: edge.id,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    excerpt: input.excerpt ?? null,
  });
  return edge;
}

async function addBrainSource(input: {
  userId: string;
  nodeId?: string;
  edgeId?: string;
  sourceType: BrainSourceType;
  sourceId: string;
  excerpt?: string | null;
}): Promise<void> {
  await db.brainSource.create({
    data: {
      userId: input.userId,
      nodeId: input.nodeId ?? null,
      edgeId: input.edgeId ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      excerpt: input.excerpt ? truncate(input.excerpt, EVIDENCE_LIMIT) : null,
    },
  });
}

function buildNoteIndexes(notes: NoteRecord[]): {
  byId: Map<string, NoteRecord>;
  byTitle: Map<string, NoteRecord>;
} {
  return {
    byId: new Map(notes.map((note) => [note.id, note])),
    byTitle: new Map(notes.map((note) => [note.title.trim().toLowerCase(), note])),
  };
}

function parseWikiLinks(markdown: string): string[] {
  const found = new Set<string>();
  for (const match of markdown.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const title = match[1]?.trim();
    if (title) found.add(title);
  }
  return [...found];
}

function truncate(value: string | null | undefined, limit: number): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
}
