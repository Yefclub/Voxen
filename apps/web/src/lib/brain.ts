import { Prisma } from '../../prisma-generated/client';
import { db } from './db';
import {
  GRAPH_INDEX_HEARTBEAT_MS,
  GRAPH_INDEX_LEASE_TTL_MS,
  acquireGraphIndexLease,
  releaseGraphIndexLease,
  renewGraphIndexLease,
} from './graph-index-coordinator';
import { validNoteAnchorSources, type NoteTranscriptSource } from './brain-note-anchors';

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

type BrainEdgeWriteCheckpoint = {
  method: string;
  kind: BrainEdgeKind;
  fromNodeId: string;
  toNodeId: string;
};

function isBrainFkError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003';
}

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
  metadataMode?: 'replace' | 'merge' | 'reset-completion';
};

export type BrainReindexOptions = {
  beforeFinalize?: () => void | Promise<void>;
  beforeEdgeWrite?: (edge: BrainEdgeWriteCheckpoint) => void | Promise<void>;
  assertLeaseOwnership?: BrainReindexGuard;
};

export type BrainReindexGuard = () => Promise<void>;

class BrainIndexLeaseLostError extends Error {
  constructor() {
    super('Brain index lease lost');
  }
}

async function runWithBrainIndexLease(
  userId: string,
  operation: (assertLeaseOwnership: BrainReindexGuard) => Promise<void>,
): Promise<boolean> {
  const owner = `web-direct:${crypto.randomUUID()}`;
  try {
    if (!(await acquireGraphIndexLease(userId, owner))) return false;
  } catch {
    return false;
  }

  let leaseLost = false;
  let leaseExpiresAt = Date.now() + GRAPH_INDEX_LEASE_TTL_MS;
  const renewLease = async (): Promise<void> => {
    if (leaseLost) throw new BrainIndexLeaseLostError();
    try {
      if (!(await renewGraphIndexLease(userId, owner))) {
        leaseLost = true;
        throw new BrainIndexLeaseLostError();
      }
      leaseExpiresAt = Date.now() + GRAPH_INDEX_LEASE_TTL_MS;
    } catch (err) {
      if (err instanceof BrainIndexLeaseLostError) throw err;
      if (Date.now() >= leaseExpiresAt) {
        leaseLost = true;
        throw new BrainIndexLeaseLostError();
      }
    }
  };
  const assertLeaseOwnership = async (): Promise<void> => {
    if (leaseLost || Date.now() >= leaseExpiresAt) {
      leaseLost = true;
      throw new BrainIndexLeaseLostError();
    }
    if (Date.now() >= leaseExpiresAt - GRAPH_INDEX_HEARTBEAT_MS) {
      await renewLease();
    }
  };
  const heartbeat = setInterval(() => {
    void renewLease().catch(() => {
      // O guard entre fases interrompe a materialização e mantém o marker ausente.
    });
  }, GRAPH_INDEX_HEARTBEAT_MS);
  try {
    await assertLeaseOwnership();
    await operation(assertLeaseOwnership);
    return true;
  } catch (err) {
    if (err instanceof BrainIndexLeaseLostError) return false;
    throw err;
  } finally {
    clearInterval(heartbeat);
    await releaseGraphIndexLease(userId, owner).catch(() => false);
  }
}

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
  beforeEdgeWrite?: (edge: BrainEdgeWriteCheckpoint) => void | Promise<void>;
  assertLeaseOwnership?: BrainReindexGuard;
};

type NoteRecord = {
  id: string;
  parentId: string | null;
  kind: 'NOTE' | 'FOLDER';
  title: string;
  content: string;
  updatedAt: Date;
  transcriptSources: NoteTranscriptSource[];
};

type LibraryFolderRecord = {
  id: string;
  parentId: string | null;
  name: string;
  updatedAt: Date;
};

type TopicCandidate = {
  slug: string;
  label: string;
  count: number;
  confidence: number;
  excerpt: string | null;
};

type EntityCandidate = TopicCandidate & {
  kind: 'domain' | 'hashtag' | 'proper-noun';
};

type IndexedConcept = {
  nodeId: string;
  key: string;
  type: 'topic' | 'entity';
  slug: string;
  label: string;
  confidence: number;
};

type SemanticProfile = {
  extractorVersion: number;
  topics: string[];
  entities: string[];
  keywords: string[];
  indexedAt: string;
};

export const BRAIN_INDEX_VERSION = 3;
export const BRAIN_TOPIC_INDEX_VERSION = 1;

const DESCRIPTION_LIMIT = 800;
const EVIDENCE_LIMIT = 600;
const TOPIC_LIMIT = 10;
const ENTITY_LIMIT = 8;
const RELATED_CONTENT_LIMIT = 12;
const SEMANTIC_PROFILE_VERSION = 1;
const SEMANTIC_PROFILE_KEYWORD_LIMIT = 28;
const SEMANTIC_PROFILE_CANDIDATE_LIMIT = 120;
const TIMELINE_NEIGHBOR_LIMIT = 3;
const TOPIC_MIN_LENGTH = 4;
const TOPIC_STOPWORDS = new Set([
  'ainda',
  'algo',
  'also',
  'apenas',
  'apos',
  'cada',
  'como',
  'com',
  'conteudo',
  'conteudos',
  'contra',
  'depois',
  'desde',
  'esta',
  'este',
  'isso',
  'para',
  'pela',
  'pelo',
  'sobre',
  'texto',
  'tipo',
  'tudo',
  'voce',
  'http',
  'https',
  'www',
  'that',
  'this',
  'with',
  'from',
  'have',
  'will',
  'your',
  'they',
  'their',
  'there',
  'what',
  'when',
  'where',
  'which',
  'would',
  'could',
  'should',
]);

export function brainNodeKey(sourceType: BrainSourceType, sourceId: string): string {
  return `${sourceType}:${sourceId}`;
}

export async function deleteBrainForSource(
  userId: string,
  sourceType: BrainSourceType,
  sourceId: string,
  assertLeaseOwnership?: BrainReindexGuard,
): Promise<void> {
  if (!assertLeaseOwnership) {
    await runWithBrainIndexLease(userId, async (guard) => {
      await deleteBrainForSource(userId, sourceType, sourceId, guard);
    });
    return;
  }
  await assertLeaseOwnership();
  await deleteAutomaticContentEdgesForSource(userId, sourceType, sourceId);
  await assertLeaseOwnership();
  await removeSourceEvidence(userId, sourceType, sourceId);
  await assertLeaseOwnership();
  await db.brainNode.deleteMany({ where: { userId, sourceType, sourceId } });
  await assertLeaseOwnership();
  await deleteOrphanAutomaticConceptNodes(userId);
}

export async function deleteBrainForSources(
  userId: string,
  sourceType: BrainSourceType,
  sourceIds: string[],
  assertLeaseOwnership?: BrainReindexGuard,
): Promise<void> {
  if (!assertLeaseOwnership) {
    await runWithBrainIndexLease(userId, async (guard) => {
      await deleteBrainForSources(userId, sourceType, sourceIds, guard);
    });
    return;
  }
  for (const sourceId of sourceIds) {
    await assertLeaseOwnership();
    await deleteBrainForSource(userId, sourceType, sourceId, assertLeaseOwnership);
  }
}

export async function deleteOrphanedBrainSourceNodes(
  userId: string,
  assertLeaseOwnership: BrainReindexGuard,
): Promise<void> {
  await assertLeaseOwnership();
  await db.$executeRaw`
    DELETE FROM "BrainNode" n
    WHERE n."userId" = ${userId}
      AND (
        (
          n."sourceType" = 'TRANSCRIPT'::"BrainSourceType"
          AND NOT EXISTS (
            SELECT 1 FROM "Transcript" t
            WHERE t.id = n."sourceId" AND t."userId" = n."userId"
          )
        )
        OR (
          n."sourceType" = 'NOTE'::"BrainSourceType"
          AND NOT EXISTS (
            SELECT 1 FROM "Note" note
            WHERE note.id = n."sourceId" AND note."userId" = n."userId"
          )
        )
        OR (
          n."sourceType" = 'FOLDER'::"BrainSourceType"
          AND NOT EXISTS (
            SELECT 1 FROM "LibraryFolder" folder
            WHERE folder.id = n."sourceId" AND folder."userId" = n."userId"
          )
        )
      )
  `;
  await assertLeaseOwnership();
  await deleteOrphanAutomaticConceptNodes(userId);
}

export async function reindexTranscriptBrain(
  userId: string,
  transcriptId: string,
  options: BrainReindexOptions = {},
): Promise<void> {
  if (!options.assertLeaseOwnership) {
    await runWithBrainIndexLease(userId, async (guard) => {
      await reindexTranscriptBrain(userId, transcriptId, {
        ...options,
        assertLeaseOwnership: guard,
      });
    });
    return;
  }
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
      author: true,
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
    await options.assertLeaseOwnership?.();
    await deleteBrainForSource(userId, 'TRANSCRIPT', transcriptId, options.assertLeaseOwnership);
    return;
  }

  await options.assertLeaseOwnership?.();
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
      author: transcript.author,
      language: transcript.language,
      transcriptionMethod: transcript.transcriptionMethod,
      thumbnailUrl: transcript.thumbnailUrl,
      folderId: transcript.folderId,
      createdAt: transcript.createdAt.toISOString(),
      updatedAt: transcript.updatedAt.toISOString(),
    },
    sourceType: 'TRANSCRIPT',
    sourceId: transcript.id,
    metadataMode: 'reset-completion',
  });
  await options.assertLeaseOwnership?.();
  await deleteAutomaticContentEdgesForSource(userId, 'TRANSCRIPT', transcript.id);
  await options.assertLeaseOwnership?.();
  // Só limpa evidência "refreshable" (keyword/related heurístico). NÃO apaga
  // llm-grounded nem manual — reprocessar o cérebro não joga fora o extract
  // caro nem gasta créditos de IA (spec 105).
  await removeRefreshableSourceEvidence(userId, 'TRANSCRIPT', transcript.id);
  await options.assertLeaseOwnership?.();
  await addBrainSource({
    userId,
    nodeId: contentNode.id,
    sourceType: 'TRANSCRIPT',
    sourceId: transcript.id,
    excerpt: transcript.title,
    assertLeaseOwnership: options.assertLeaseOwnership,
  });

  if (transcript.folder) {
    await options.assertLeaseOwnership?.();
    const folderNode = await upsertLibraryFolderNode(userId, transcript.folder);
    await options.assertLeaseOwnership?.();
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
      beforeEdgeWrite: options.beforeEdgeWrite,
      assertLeaseOwnership: options.assertLeaseOwnership,
    });
  }

  await options.assertLeaseOwnership?.();
  await indexConceptsForContent({
    userId,
    contentNodeId: contentNode.id,
    sourceType: 'TRANSCRIPT',
    sourceId: transcript.id,
    status: transcript.status,
    text: `${transcript.title}\n${transcript.channel ?? ''}\n${transcript.author ?? ''}\n${transcript.summaryMd || transcript.plainText}`,
    beforeEdgeWrite: options.beforeEdgeWrite,
    assertLeaseOwnership: options.assertLeaseOwnership,
  });
  await options.beforeFinalize?.();
  await options.assertLeaseOwnership?.();
  await finalizeBrainNodeIndex(userId, contentNode.id, {
    brainIndexVersion: BRAIN_INDEX_VERSION,
    topicIndexVersion: BRAIN_TOPIC_INDEX_VERSION,
  });
}

export async function reindexTranscriptsBrain(
  userId: string,
  transcriptIds?: string[],
  assertLeaseOwnership?: BrainReindexGuard,
): Promise<void> {
  if (!assertLeaseOwnership) {
    await runWithBrainIndexLease(userId, async (guard) => {
      await reindexTranscriptsBrain(userId, transcriptIds, guard);
    });
    return;
  }
  const ids =
    transcriptIds ??
    (
      await db.transcript.findMany({
        where: { userId },
        select: { id: true },
      })
    ).map((item) => item.id);
  for (const id of ids) {
    await assertLeaseOwnership?.();
    try {
      await reindexTranscriptBrain(userId, id, { assertLeaseOwnership });
    } catch (err) {
      await assertLeaseOwnership?.();
      // Reindex de um item não deve derrubar o lote (ex.: corrida de FK no grafo).
      console.warn('[brain] reindexTranscriptBrain failed', { userId, id, err });
    }
  }
}

export async function reindexLibraryFolderBrain(
  userId: string,
  folderId: string,
  assertLeaseOwnership?: BrainReindexGuard,
): Promise<void> {
  if (!assertLeaseOwnership) {
    await runWithBrainIndexLease(userId, async (guard) => {
      await reindexLibraryFolderBrain(userId, folderId, guard);
    });
    return;
  }
  const folder = await db.libraryFolder.findFirst({
    where: { id: folderId, userId },
    select: { id: true, parentId: true, name: true, updatedAt: true },
  });
  if (!folder) {
    await assertLeaseOwnership?.();
    await deleteBrainForSource(userId, 'FOLDER', folderId, assertLeaseOwnership);
    return;
  }

  await assertLeaseOwnership?.();
  const folderNode = await upsertLibraryFolderNode(userId, folder, { resetCompletion: true });
  await assertLeaseOwnership?.();
  await removeSourceEvidence(userId, 'FOLDER', folder.id);
  await assertLeaseOwnership?.();
  await addBrainSource({
    userId,
    nodeId: folderNode.id,
    sourceType: 'FOLDER',
    sourceId: folder.id,
    excerpt: folder.name,
    assertLeaseOwnership,
  });

  if (folder.parentId) {
    const parent = await db.libraryFolder.findFirst({
      where: { id: folder.parentId, userId },
      select: { id: true, parentId: true, name: true, updatedAt: true },
    });
    if (parent) {
      await assertLeaseOwnership?.();
      const parentNode = await upsertLibraryFolderNode(userId, parent);
      await assertLeaseOwnership?.();
      await upsertBrainEdge({
        userId,
        fromNodeId: folderNode.id,
        toNodeId: parentNode.id,
        kind: 'BELONGS_TO',
        method: 'folder-tree',
        sourceType: 'FOLDER',
        sourceId: folder.id,
        excerpt: `Parent folder: ${parent.name}`,
        assertLeaseOwnership,
      });
    }
  }
  await assertLeaseOwnership?.();
  await finalizeBrainNodeIndex(userId, folderNode.id, {
    brainIndexVersion: BRAIN_INDEX_VERSION,
  });
}

export async function reindexLibraryFoldersBrain(
  userId: string,
  assertLeaseOwnership?: BrainReindexGuard,
): Promise<void> {
  if (!assertLeaseOwnership) {
    await runWithBrainIndexLease(userId, async (guard) => {
      await reindexLibraryFoldersBrain(userId, guard);
    });
    return;
  }
  const folders = await db.libraryFolder.findMany({
    where: { userId },
    select: { id: true },
  });
  for (const folder of folders) {
    await assertLeaseOwnership?.();
    await reindexLibraryFolderBrain(userId, folder.id, assertLeaseOwnership);
  }
}

export async function reindexNoteBrain(
  userId: string,
  noteId: string,
  assertLeaseOwnership?: BrainReindexGuard,
): Promise<void> {
  if (!assertLeaseOwnership) {
    await runWithBrainIndexLease(userId, async (guard) => {
      await reindexNoteBrain(userId, noteId, guard);
    });
    return;
  }
  const notes = await db.note.findMany({
    where: { userId },
    select: {
      id: true,
      parentId: true,
      kind: true,
      title: true,
      content: true,
      updatedAt: true,
      transcriptSources: {
        select: {
          anchors: {
            select: {
              id: true,
              transcriptId: true,
              startLine: true,
              endLine: true,
              startSec: true,
              endSec: true,
              selectedQuote: true,
              status: true,
            },
          },
        },
      },
    },
  });
  const note = notes.find((item) => item.id === noteId);
  if (!note) {
    await assertLeaseOwnership?.();
    await deleteBrainForSource(userId, 'NOTE', noteId, assertLeaseOwnership);
    return;
  }
  await assertLeaseOwnership?.();
  await reindexNoteRecord(userId, note, buildNoteIndexes(notes), assertLeaseOwnership);
}

export async function reindexNotesBrain(
  userId: string,
  assertLeaseOwnership?: BrainReindexGuard,
): Promise<void> {
  if (!assertLeaseOwnership) {
    await runWithBrainIndexLease(userId, async (guard) => {
      await reindexNotesBrain(userId, guard);
    });
    return;
  }
  const notes = await db.note.findMany({
    where: { userId },
    select: {
      id: true,
      parentId: true,
      kind: true,
      title: true,
      content: true,
      updatedAt: true,
      transcriptSources: {
        select: {
          anchors: {
            select: {
              id: true,
              transcriptId: true,
              startLine: true,
              endLine: true,
              startSec: true,
              endSec: true,
              selectedQuote: true,
              status: true,
            },
          },
        },
      },
    },
  });
  const indexes = buildNoteIndexes(notes);
  for (const note of notes) {
    await assertLeaseOwnership?.();
    try {
      await reindexNoteRecord(userId, note, indexes, assertLeaseOwnership);
    } catch (err) {
      await assertLeaseOwnership?.();
      console.warn('[brain] reindexNoteRecord failed', { userId, noteId: note.id, err });
    }
  }
}

async function reindexNoteRecord(
  userId: string,
  note: NoteRecord,
  indexes: { byId: Map<string, NoteRecord>; byTitle: Map<string, NoteRecord> },
  assertLeaseOwnership?: BrainReindexGuard,
): Promise<void> {
  await assertLeaseOwnership?.();
  const node = await upsertNoteNode(userId, note, { resetCompletion: true });
  await assertLeaseOwnership?.();
  await deleteAutomaticContentEdgesForSource(userId, 'NOTE', note.id);
  await assertLeaseOwnership?.();
  await removeRefreshableSourceEvidence(userId, 'NOTE', note.id);
  await assertLeaseOwnership?.();
  await addBrainSource({
    userId,
    nodeId: node.id,
    sourceType: 'NOTE',
    sourceId: note.id,
    excerpt: note.title,
    assertLeaseOwnership,
  });
  for (const anchorSource of validNoteAnchorSources(note.transcriptSources)) {
    await addBrainSource({
      userId,
      nodeId: node.id,
      sourceType: 'NOTE',
      sourceId: note.id,
      ...anchorSource,
      assertLeaseOwnership,
    });
  }

  if (note.parentId) {
    const parent = indexes.byId.get(note.parentId);
    if (parent) {
      await assertLeaseOwnership?.();
      const parentNode = await upsertNoteNode(userId, parent);
      await assertLeaseOwnership?.();
      await upsertBrainEdge({
        userId,
        fromNodeId: node.id,
        toNodeId: parentNode.id,
        kind: 'BELONGS_TO',
        method: 'note-tree',
        sourceType: 'NOTE',
        sourceId: note.id,
        excerpt: `Parent note folder: ${parent.title}`,
        assertLeaseOwnership,
      });
    }
  }

  if (note.kind !== 'NOTE') {
    await assertLeaseOwnership?.();
    await finalizeBrainNodeIndex(userId, node.id, {
      brainIndexVersion: BRAIN_INDEX_VERSION,
    });
    return;
  }
  for (const targetTitle of parseWikiLinks(note.content)) {
    const target = indexes.byTitle.get(targetTitle.toLowerCase());
    if (!target || target.id === note.id) continue;
    await assertLeaseOwnership?.();
    const targetNode = await upsertNoteNode(userId, target);
    await assertLeaseOwnership?.();
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
      assertLeaseOwnership,
    });
  }

  await assertLeaseOwnership?.();
  await indexConceptsForContent({
    userId,
    contentNodeId: node.id,
    sourceType: 'NOTE',
    sourceId: note.id,
    status: 'ACTIVE',
    text: `${note.title}\n${note.content}`,
    assertLeaseOwnership,
  });
  await assertLeaseOwnership?.();
  await finalizeBrainNodeIndex(userId, node.id, {
    brainIndexVersion: BRAIN_INDEX_VERSION,
  });
}

/** Métodos que o reprocesso do cérebro pode recriar sem LLM. */
export const BRAIN_REFRESHABLE_EDGE_METHODS = [
  'keyword',
  'shared-concepts',
  'semantic-profile',
  'timeline-adjacent',
  'entity-heuristic',
] as const;

/** Métodos preservados no reprocesso (não gastar IA de novo / não apagar manual). */
export const BRAIN_PRESERVED_EDGE_METHODS = [
  'manual',
  'llm-grounded',
  'wikilink',
  'folder',
  'folder-tree',
  'note-tree',
] as const;

async function removeSourceEvidence(
  userId: string,
  sourceType: BrainSourceType,
  sourceId: string,
): Promise<void> {
  // Hard delete (ex.: conteúdo removido) — limpa toda evidência da fonte.
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
    await deleteOrphanAutomaticConceptNodes(userId);
  }
}

/**
 * Limpa só evidências/arestas recriáveis por heurística no reprocesso do Brain.
 * Preserva llm-grounded (custa crédito) e manual/wikilink.
 */
async function removeRefreshableSourceEvidence(
  userId: string,
  sourceType: BrainSourceType,
  sourceId: string,
): Promise<void> {
  const refreshable = [...BRAIN_REFRESHABLE_EDGE_METHODS];
  const edgeSources = await db.brainSource.findMany({
    where: {
      userId,
      sourceType,
      sourceId,
      edgeId: { not: null },
      edge: { method: { in: refreshable } },
    },
    select: { id: true, edgeId: true },
  });
  const nodeSources = await db.brainSource.findMany({
    where: {
      userId,
      sourceType,
      sourceId,
      edgeId: null,
    },
    select: { id: true },
  });
  const sourceIds = [...edgeSources.map((row) => row.id), ...nodeSources.map((row) => row.id)];
  if (sourceIds.length > 0) {
    await db.brainSource.deleteMany({ where: { userId, id: { in: sourceIds } } });
  }

  const edgeIds = [...new Set(edgeSources.map((item) => item.edgeId).filter(Boolean) as string[])];
  if (edgeIds.length === 0) return;

  const remaining = await db.brainSource.findMany({
    where: { userId, edgeId: { in: edgeIds } },
    select: { edgeId: true },
  });
  const remainingEdgeIds = new Set(remaining.map((item) => item.edgeId).filter(Boolean));
  const orphanEdgeIds = edgeIds.filter((id) => !remainingEdgeIds.has(id));
  if (orphanEdgeIds.length > 0) {
    await db.brainEdge.deleteMany({
      where: {
        userId,
        id: { in: orphanEdgeIds },
        method: { in: refreshable },
      },
    });
    await deleteOrphanAutomaticConceptNodes(userId);
  }
}

async function deleteAutomaticContentEdgesForSource(
  userId: string,
  sourceType: BrainSourceType,
  sourceId: string,
): Promise<void> {
  const node = await db.brainNode.findUnique({
    where: { userId_key: { userId, key: brainNodeKey(sourceType, sourceId) } },
    select: { id: true },
  });
  if (!node) return;
  await db.brainEdge.deleteMany({
    where: {
      userId,
      method: { in: ['shared-concepts', 'semantic-profile', 'timeline-adjacent'] },
      OR: [{ fromNodeId: node.id }, { toNodeId: node.id }],
    },
  });
}

async function deleteOrphanAutomaticConceptNodes(userId: string): Promise<void> {
  // Grace de 2 min: evita apagar tópico/entidade "recém-nascido" no meio do
  // reindex concorrente (upsert node → cleanup órfão → upsert edge = P2003).
  await db.$executeRaw`
    DELETE FROM "BrainNode" n
    WHERE n."userId" = ${userId}
      AND n."sourceType" IS NULL
      AND n."updatedAt" < NOW() - INTERVAL '2 minutes'
      AND (
        (n.type = 'TOPIC'::"BrainNodeType" AND n.metadata->>'method' = 'keyword')
        OR (n.type = 'ENTITY'::"BrainNodeType" AND n.metadata->>'method' = 'entity-heuristic')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "BrainEdge" be
        WHERE be."userId" = n."userId"
          AND (be."fromNodeId" = n.id OR be."toNodeId" = n.id)
      )
  `;
}

async function upsertLibraryFolderNode(
  userId: string,
  folder: LibraryFolderRecord,
  options: { resetCompletion?: boolean } = {},
) {
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
    metadataMode: options.resetCompletion ? 'reset-completion' : 'merge',
  });
}

async function upsertNoteNode(
  userId: string,
  note: NoteRecord,
  options: { resetCompletion?: boolean } = {},
) {
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
    metadataMode: options.resetCompletion ? 'reset-completion' : 'merge',
  });
}

async function upsertTopicNode(userId: string, topic: TopicCandidate) {
  return upsertBrainNode({
    userId,
    key: `TOPIC:${topic.slug}`,
    type: 'TOPIC',
    label: topic.label,
    description: 'Tópico detectado automaticamente nos conteúdos da biblioteca.',
    status: 'ACTIVE',
    metadata: {
      method: 'keyword',
    },
    sourceType: null,
    sourceId: null,
  });
}

async function upsertEntityNode(userId: string, entity: EntityCandidate) {
  return upsertBrainNode({
    userId,
    key: `ENTITY:${entity.slug}`,
    type: 'ENTITY',
    label: entity.label,
    description: 'Entidade detectada automaticamente nos conteúdos da biblioteca.',
    status: 'ACTIVE',
    metadata: {
      method: 'entity-heuristic',
      kind: entity.kind,
    },
    sourceType: null,
    sourceId: null,
  });
}

async function indexConceptsForContent(input: {
  userId: string;
  contentNodeId: string;
  sourceType: Extract<BrainSourceType, 'TRANSCRIPT' | 'NOTE'>;
  sourceId: string;
  status: ContentStatus;
  text: string;
  beforeEdgeWrite?: (edge: BrainEdgeWriteCheckpoint) => void | Promise<void>;
  assertLeaseOwnership?: BrainReindexGuard;
}): Promise<void> {
  if (input.status !== 'ACTIVE') return;
  const indexed: IndexedConcept[] = [];
  const topics = extractTopics(input.text);
  const entities = extractEntities(input.text);

  await input.assertLeaseOwnership?.();
  await updateContentSemanticProfile({
    userId: input.userId,
    contentNodeId: input.contentNodeId,
    text: input.text,
    topics,
    entities,
  });

  for (const topic of topics) {
    await input.assertLeaseOwnership?.();
    const topicNode = await upsertTopicNode(input.userId, topic);
    await input.assertLeaseOwnership?.();
    await upsertBrainEdge({
      userId: input.userId,
      fromNodeId: input.contentNodeId,
      toNodeId: topicNode.id,
      kind: 'MENTIONS',
      method: 'keyword',
      confidence: topic.confidence,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      excerpt: topic.excerpt,
      metadata: {
        term: topic.slug,
        count: topic.count,
        extractorVersion: 2,
      },
      beforeEdgeWrite: input.beforeEdgeWrite,
      assertLeaseOwnership: input.assertLeaseOwnership,
    });
    indexed.push({
      nodeId: topicNode.id,
      key: topicNode.key,
      type: 'topic',
      slug: topic.slug,
      label: topic.label,
      confidence: topic.confidence,
    });
  }

  for (const entity of entities) {
    await input.assertLeaseOwnership?.();
    const entityNode = await upsertEntityNode(input.userId, entity);
    await input.assertLeaseOwnership?.();
    await upsertBrainEdge({
      userId: input.userId,
      fromNodeId: input.contentNodeId,
      toNodeId: entityNode.id,
      kind: 'MENTIONS',
      method: 'entity-heuristic',
      confidence: entity.confidence,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      excerpt: entity.excerpt,
      metadata: {
        term: entity.slug,
        kind: entity.kind,
        count: entity.count,
        extractorVersion: 1,
      },
      beforeEdgeWrite: input.beforeEdgeWrite,
      assertLeaseOwnership: input.assertLeaseOwnership,
    });
    indexed.push({
      nodeId: entityNode.id,
      key: entityNode.key,
      type: 'entity',
      slug: entity.slug,
      label: entity.label,
      confidence: entity.confidence,
    });
  }

  await input.assertLeaseOwnership?.();
  await connectContentBySharedConcepts({
    userId: input.userId,
    contentNodeId: input.contentNodeId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    concepts: indexed,
    beforeEdgeWrite: input.beforeEdgeWrite,
    assertLeaseOwnership: input.assertLeaseOwnership,
  });
  await input.assertLeaseOwnership?.();
  await connectContentBySemanticProfile({
    userId: input.userId,
    contentNodeId: input.contentNodeId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    beforeEdgeWrite: input.beforeEdgeWrite,
    assertLeaseOwnership: input.assertLeaseOwnership,
  });
  await input.assertLeaseOwnership?.();
  await connectTimelineNeighbors({
    userId: input.userId,
    contentNodeId: input.contentNodeId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    beforeEdgeWrite: input.beforeEdgeWrite,
    assertLeaseOwnership: input.assertLeaseOwnership,
  });
}

async function updateContentSemanticProfile(input: {
  userId: string;
  contentNodeId: string;
  text: string;
  topics: TopicCandidate[];
  entities: EntityCandidate[];
}): Promise<void> {
  const profile: SemanticProfile = {
    extractorVersion: SEMANTIC_PROFILE_VERSION,
    topics: uniqueSlugs(input.topics.map((topic) => topic.slug)),
    entities: uniqueSlugs(input.entities.map((entity) => entity.slug)),
    keywords: extractProfileKeywords(input.text),
    indexedAt: new Date().toISOString(),
  };
  await mergeBrainNodeMetadata(input.userId, input.contentNodeId, {
    semanticProfile: profile,
  });
}

async function connectContentBySharedConcepts(input: {
  userId: string;
  contentNodeId: string;
  sourceType: Extract<BrainSourceType, 'TRANSCRIPT' | 'NOTE'>;
  sourceId: string;
  concepts: IndexedConcept[];
  beforeEdgeWrite?: (edge: BrainEdgeWriteCheckpoint) => void | Promise<void>;
  assertLeaseOwnership?: BrainReindexGuard;
}): Promise<void> {
  if (input.concepts.length === 0) return;
  const conceptById = new Map(input.concepts.map((concept) => [concept.nodeId, concept]));
  const mentions = await db.brainEdge.findMany({
    where: {
      userId: input.userId,
      status: 'ACTIVE',
      kind: 'MENTIONS',
      method: { in: ['keyword', 'entity-heuristic'] },
      toNodeId: { in: [...conceptById.keys()] },
      from: {
        status: 'ACTIVE',
        sourceType: { in: ['TRANSCRIPT', 'NOTE'] },
      },
    },
    select: {
      fromNodeId: true,
      toNodeId: true,
      from: {
        select: {
          id: true,
          label: true,
          sourceType: true,
          sourceId: true,
        },
      },
    },
  });
  await input.assertLeaseOwnership?.();

  const candidates = new Map<
    string,
    {
      nodeId: string;
      label: string;
      concepts: IndexedConcept[];
      score: number;
    }
  >();
  for (const mention of mentions) {
    if (mention.fromNodeId === input.contentNodeId) continue;
    const concept = conceptById.get(mention.toNodeId);
    if (!concept) continue;
    const current = candidates.get(mention.fromNodeId) ?? {
      nodeId: mention.fromNodeId,
      label: mention.from.label,
      concepts: [],
      score: 0,
    };
    if (!current.concepts.some((item) => item.nodeId === concept.nodeId)) {
      current.concepts.push(concept);
      current.score += concept.type === 'entity' ? 1.25 : 1;
    }
    candidates.set(mention.fromNodeId, current);
  }

  // Spec 103: limiar mais alto — evita RELATED_TO cosmético por 1 token fraco.
  const ranked = [...candidates.values()]
    .filter(
      (candidate) =>
        candidate.score >= 2.25 || (candidate.concepts.length >= 2 && candidate.score >= 1.75),
    )
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.label.localeCompare(right.label);
    })
    .slice(0, RELATED_CONTENT_LIMIT);

  for (const candidate of ranked) {
    await input.assertLeaseOwnership?.();
    const [fromNodeId, toNodeId] = canonicalEdge(input.contentNodeId, candidate.nodeId);
    const labels = candidate.concepts.slice(0, 5).map((concept) => concept.label);
    const confidence = Math.min(0.95, Number((0.42 + candidate.score * 0.11).toFixed(4)));
    await upsertBrainEdge({
      userId: input.userId,
      fromNodeId,
      toNodeId,
      kind: 'RELATED_TO',
      method: 'shared-concepts',
      confidence,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      excerpt: `Conceitos em comum: ${labels.join(', ')}`,
      metadata: {
        extractorVersion: 1,
        sourceNodeId: input.contentNodeId,
        targetNodeId: candidate.nodeId,
        sharedConcepts: candidate.concepts.map((concept) => ({
          key: concept.key,
          type: concept.type,
          slug: concept.slug,
          label: concept.label,
          confidence: concept.confidence,
        })),
        score: candidate.score,
      },
      beforeEdgeWrite: input.beforeEdgeWrite,
      assertLeaseOwnership: input.assertLeaseOwnership,
    });
  }
}

async function connectContentBySemanticProfile(input: {
  userId: string;
  contentNodeId: string;
  sourceType: Extract<BrainSourceType, 'TRANSCRIPT' | 'NOTE'>;
  sourceId: string;
  beforeEdgeWrite?: (edge: BrainEdgeWriteCheckpoint) => void | Promise<void>;
  assertLeaseOwnership?: BrainReindexGuard;
}): Promise<void> {
  const current = await db.brainNode.findUnique({
    where: { id: input.contentNodeId },
    select: { id: true, label: true, metadata: true },
  });
  await input.assertLeaseOwnership?.();
  if (!current) return;
  const currentMetadata = jsonRecord(current.metadata);
  const currentProfile = readSemanticProfile(currentMetadata);
  const candidates = await db.brainNode.findMany({
    where: {
      userId: input.userId,
      id: { not: input.contentNodeId },
      status: 'ACTIVE',
      sourceType: { in: ['TRANSCRIPT', 'NOTE'] },
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    take: SEMANTIC_PROFILE_CANDIDATE_LIMIT,
    select: {
      id: true,
      label: true,
      metadata: true,
    },
  });
  await input.assertLeaseOwnership?.();

  const ranked = candidates
    .map((candidate) => {
      const candidateMetadata = jsonRecord(candidate.metadata);
      const scored = scoreSemanticProfile(
        currentMetadata,
        currentProfile,
        candidateMetadata,
        readSemanticProfile(candidateMetadata),
      );
      if (!scored) return null;
      return {
        nodeId: candidate.id,
        label: candidate.label,
        ...scored,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.label.localeCompare(right.label);
    })
    .slice(0, RELATED_CONTENT_LIMIT);

  for (const candidate of ranked) {
    await input.assertLeaseOwnership?.();
    const [fromNodeId, toNodeId] = canonicalEdge(input.contentNodeId, candidate.nodeId);
    const reasonLabels = candidate.reasons.slice(0, 5).map((reason) => reason.label);
    await upsertBrainEdge({
      userId: input.userId,
      fromNodeId,
      toNodeId,
      kind: 'RELATED_TO',
      method: 'semantic-profile',
      confidence: Math.min(0.92, Number((0.38 + candidate.score * 0.12).toFixed(4))),
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      excerpt: `Similaridade: ${reasonLabels.join(', ')}`,
      metadata: {
        extractorVersion: SEMANTIC_PROFILE_VERSION,
        sourceNodeId: input.contentNodeId,
        targetNodeId: candidate.nodeId,
        reasons: candidate.reasons,
        score: candidate.score,
      },
      beforeEdgeWrite: input.beforeEdgeWrite,
      assertLeaseOwnership: input.assertLeaseOwnership,
    });
  }
}

async function connectTimelineNeighbors(input: {
  userId: string;
  contentNodeId: string;
  sourceType: Extract<BrainSourceType, 'TRANSCRIPT' | 'NOTE'>;
  sourceId: string;
  beforeEdgeWrite?: (edge: BrainEdgeWriteCheckpoint) => void | Promise<void>;
  assertLeaseOwnership?: BrainReindexGuard;
}): Promise<void> {
  const current = await db.brainNode.findUnique({
    where: { id: input.contentNodeId },
    select: { metadata: true, updatedAt: true },
  });
  await input.assertLeaseOwnership?.();
  if (!current) return;
  const currentTimestamp = contentTimestamp(jsonRecord(current.metadata), current.updatedAt);
  if (!currentTimestamp) return;

  const candidates = await db.brainNode.findMany({
    where: {
      userId: input.userId,
      id: { not: input.contentNodeId },
      status: 'ACTIVE',
      sourceType: { in: ['TRANSCRIPT', 'NOTE'] },
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    take: SEMANTIC_PROFILE_CANDIDATE_LIMIT,
    select: {
      id: true,
      label: true,
      metadata: true,
      updatedAt: true,
    },
  });
  await input.assertLeaseOwnership?.();
  const neighbors = candidates
    .map((candidate) => {
      const timestamp = contentTimestamp(jsonRecord(candidate.metadata), candidate.updatedAt);
      if (!timestamp) return null;
      return {
        nodeId: candidate.id,
        label: candidate.label,
        timestamp,
        distanceMs: Math.abs(currentTimestamp.getTime() - timestamp.getTime()),
      };
    })
    .filter((neighbor): neighbor is NonNullable<typeof neighbor> => neighbor !== null)
    .sort((left, right) => {
      if (left.distanceMs !== right.distanceMs) return left.distanceMs - right.distanceMs;
      return left.label.localeCompare(right.label);
    })
    .slice(0, TIMELINE_NEIGHBOR_LIMIT);

  for (const [index, neighbor] of neighbors.entries()) {
    await input.assertLeaseOwnership?.();
    const [fromNodeId, toNodeId] = canonicalEdge(input.contentNodeId, neighbor.nodeId);
    const distanceDays = Number((neighbor.distanceMs / 86_400_000).toFixed(3));
    await upsertBrainEdge({
      userId: input.userId,
      fromNodeId,
      toNodeId,
      kind: 'NEXT_TO',
      method: 'timeline-adjacent',
      confidence: Math.max(0.3, Number((0.48 - index * 0.06).toFixed(4))),
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      excerpt: `Conteúdo próximo na linha do tempo: ${neighbor.label}`,
      metadata: {
        extractorVersion: 1,
        sourceNodeId: input.contentNodeId,
        targetNodeId: neighbor.nodeId,
        sourceTimestamp: currentTimestamp.toISOString(),
        targetTimestamp: neighbor.timestamp.toISOString(),
        distanceDays,
      },
      beforeEdgeWrite: input.beforeEdgeWrite,
      assertLeaseOwnership: input.assertLeaseOwnership,
    });
  }
}

function canonicalEdge(left: string, right: string): [string, string] {
  return left.localeCompare(right) <= 0 ? [left, right] : [right, left];
}

async function upsertBrainNode(input: BrainNodeInput) {
  const metadataMode = input.metadataMode ?? 'replace';
  const metadata = input.metadata ?? {};
  const upsertArgs = {
    where: { userId_key: { userId: input.userId, key: input.key } },
    update: {
      type: input.type,
      label: input.label,
      description: input.description ?? null,
      status: input.status ?? 'ACTIVE',
      ...(metadataMode === 'replace' ? { metadata } : {}),
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
      metadata,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
    },
  } satisfies Prisma.BrainNodeUpsertArgs;

  if (metadataMode === 'replace') return db.brainNode.upsert(upsertArgs);

  const metadataJson = JSON.stringify(metadata);
  if (metadataMode === 'merge') {
    const node = await db.brainNode.upsert(upsertArgs);
    await mergeBrainNodeMetadata(input.userId, node.id, metadata);
    return node;
  }

  return db.$transaction(async (tx) => {
    const node = await tx.brainNode.upsert(upsertArgs);
    await tx.$executeRaw`
      UPDATE "BrainNode"
      SET metadata = (
            COALESCE(metadata, '{}'::jsonb)
            - 'brainIndexVersion'
            - 'topicIndexVersion'
          ) || ${metadataJson}::jsonb,
          "updatedAt" = NOW()
      WHERE id = ${node.id}
        AND "userId" = ${input.userId}
    `;
    return node;
  });
}

async function mergeBrainNodeMetadata(
  userId: string,
  nodeId: string,
  metadata: JsonObject,
): Promise<number> {
  const metadataJson = JSON.stringify(metadata);
  return db.$executeRaw`
    UPDATE "BrainNode"
    SET metadata = COALESCE(metadata, '{}'::jsonb) || ${metadataJson}::jsonb,
        "updatedAt" = NOW()
    WHERE id = ${nodeId}
      AND "userId" = ${userId}
  `;
}

async function finalizeBrainNodeIndex(
  userId: string,
  nodeId: string,
  markers: JsonObject,
): Promise<void> {
  const updated = await mergeBrainNodeMetadata(userId, nodeId, markers);
  if (updated !== 1) {
    throw new Error(`Brain source node disappeared before finalization: ${nodeId}`);
  }
}

async function upsertBrainEdge(input: BrainEdgeInput) {
  // Até 2 tentativas: corrida com orphan cleanup / reindex paralelo pode apagar
  // nó ou aresta entre o upsert e o BrainSource.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await input.assertLeaseOwnership?.();
      const endpoints = await db.brainNode.findMany({
        where: {
          userId: input.userId,
          id: { in: [input.fromNodeId, input.toNodeId] },
        },
        select: { id: true },
      });
      await input.assertLeaseOwnership?.();
      if (endpoints.length < 2) {
        if (attempt === 0) continue;
        throw new Error(
          `Brain edge endpoint disappeared: ${input.fromNodeId} -> ${input.toNodeId}`,
        );
      }
      await input.beforeEdgeWrite?.({
        method: input.method,
        kind: input.kind,
        fromNodeId: input.fromNodeId,
        toNodeId: input.toNodeId,
      });
      await input.assertLeaseOwnership?.();
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
      await input.assertLeaseOwnership?.();
      await addBrainSource({
        userId: input.userId,
        edgeId: edge.id,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        excerpt: input.excerpt ?? null,
        assertLeaseOwnership: input.assertLeaseOwnership,
      });
      return edge;
    } catch (err) {
      if (isBrainFkError(err) && attempt === 0) continue;
      if (isBrainFkError(err)) {
        console.warn('[brain] upsertBrainEdge FK failed', {
          userId: input.userId,
          from: input.fromNodeId,
          to: input.toNodeId,
          kind: input.kind,
          method: input.method,
        });
      }
      throw err;
    }
  }
  throw new Error(`Brain edge materialization failed: ${input.fromNodeId} -> ${input.toNodeId}`);
}

async function addBrainSource(input: {
  userId: string;
  nodeId?: string;
  edgeId?: string;
  sourceType: BrainSourceType;
  sourceId: string;
  excerpt?: string | null;
  assertLeaseOwnership?: BrainReindexGuard;
}): Promise<void> {
  try {
    await input.assertLeaseOwnership?.();
    if (input.edgeId) {
      const edge = await db.brainEdge.findFirst({
        where: { id: input.edgeId, userId: input.userId },
        select: { id: true },
      });
      await input.assertLeaseOwnership?.();
      if (!edge) throw new Error(`Brain source edge disappeared: ${input.edgeId}`);
    }
    if (input.nodeId) {
      const node = await db.brainNode.findFirst({
        where: { id: input.nodeId, userId: input.userId },
        select: { id: true },
      });
      await input.assertLeaseOwnership?.();
      if (!node) throw new Error(`Brain source node disappeared: ${input.nodeId}`);
    }
    await input.assertLeaseOwnership?.();
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
    await input.assertLeaseOwnership?.();
  } catch (err) {
    // Aresta/nó sumiu entre o check e o create: o passe precisa ficar incompleto.
    if (isBrainFkError(err)) {
      console.warn('[brain] addBrainSource FK failed', {
        userId: input.userId,
        edgeId: input.edgeId ?? null,
        nodeId: input.nodeId ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      });
    }
    throw err;
  }
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

function extractProfileKeywords(value: string): string[] {
  const counts = new Map<string, number>();
  const tokens = normalizeTopicText(value).match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [];
  for (const token of tokens) {
    const clean = token.replace(/^[-_]+|[-_]+$/g, '');
    if (!isValidTopicParts([clean])) continue;
    counts.set(clean, (counts.get(clean) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left, leftCount], [right, rightCount]) => {
      if (rightCount !== leftCount) return rightCount - leftCount;
      return left.localeCompare(right);
    })
    .slice(0, SEMANTIC_PROFILE_KEYWORD_LIMIT)
    .map(([keyword]) => keyword);
}

function scoreSemanticProfile(
  currentMetadata: Record<string, unknown>,
  currentProfile: SemanticProfile,
  candidateMetadata: Record<string, unknown>,
  candidateProfile: SemanticProfile,
): {
  score: number;
  reasons: Array<{ kind: string; label: string; value: string; weight: number }>;
} | null {
  let score = 0;
  const reasons: Array<{ kind: string; label: string; value: string; weight: number }> = [];

  for (const slug of intersection(currentProfile.entities, candidateProfile.entities).slice(0, 5)) {
    score += 1.25;
    reasons.push({ kind: 'entity', label: topicLabel(slug), value: slug, weight: 1.25 });
  }
  for (const slug of intersection(currentProfile.topics, candidateProfile.topics).slice(0, 5)) {
    score += 0.8;
    reasons.push({ kind: 'topic', label: topicLabel(slug), value: slug, weight: 0.8 });
  }

  const sharedKeywords = intersection(currentProfile.keywords, candidateProfile.keywords).slice(
    0,
    6,
  );
  if (sharedKeywords.length > 0) {
    const weight = Math.min(0.9, sharedKeywords.length * 0.16);
    score += weight;
    reasons.push({
      kind: 'keyword',
      label: sharedKeywords.slice(0, 3).map(topicLabel).join(', '),
      value: sharedKeywords.join(','),
      weight,
    });
  }

  const currentCollection = contentCollectionKey(currentMetadata);
  const candidateCollection = contentCollectionKey(candidateMetadata);
  if (currentCollection && currentCollection === candidateCollection) {
    score += 0.7;
    reasons.push({
      kind: 'collection',
      label: 'Mesma pasta',
      value: currentCollection,
      weight: 0.7,
    });
  }

  const currentChannel = conceptSlug(asString(currentMetadata.channel));
  const candidateChannel = conceptSlug(asString(candidateMetadata.channel));
  if (currentChannel && currentChannel === candidateChannel) {
    score += 0.85;
    reasons.push({ kind: 'channel', label: 'Mesmo canal', value: currentChannel, weight: 0.85 });
  }

  const currentAuthor = conceptSlug(asString(currentMetadata.author));
  const candidateAuthor = conceptSlug(asString(candidateMetadata.author));
  if (currentAuthor && currentAuthor === candidateAuthor) {
    score += 0.9;
    reasons.push({ kind: 'author', label: 'Mesmo autor', value: currentAuthor, weight: 0.9 });
  }

  const currentDomain = urlDomain(asString(currentMetadata.url));
  const candidateDomain = urlDomain(asString(candidateMetadata.url));
  if (currentDomain && currentDomain === candidateDomain) {
    score += 0.55;
    reasons.push({ kind: 'domain', label: currentDomain, value: currentDomain, weight: 0.55 });
  }

  const currentSource = asString(currentMetadata.source);
  const candidateSource = asString(candidateMetadata.source);
  if (currentSource && currentSource === candidateSource && score > 0) {
    score += 0.18;
    reasons.push({ kind: 'source', label: currentSource, value: currentSource, weight: 0.18 });
  }

  // Spec 103: exige overlap real (ex.: pasta+keyword ou ≥2 tópicos), não 1 token.
  if (score < 1.2 || reasons.length === 0) return null;
  return { score: Number(score.toFixed(4)), reasons };
}

function readSemanticProfile(metadata: Record<string, unknown>): SemanticProfile {
  const raw = metadata.semanticProfile;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptySemanticProfile();
  }
  const record = raw as Record<string, unknown>;
  return {
    extractorVersion:
      typeof record.extractorVersion === 'number'
        ? record.extractorVersion
        : SEMANTIC_PROFILE_VERSION,
    topics: stringArray(record.topics),
    entities: stringArray(record.entities),
    keywords: stringArray(record.keywords),
    indexedAt: asString(record.indexedAt),
  };
}

function emptySemanticProfile(): SemanticProfile {
  return {
    extractorVersion: SEMANTIC_PROFILE_VERSION,
    topics: [],
    entities: [],
    keywords: [],
    indexedAt: '',
  };
}

function contentTimestamp(metadata: Record<string, unknown>, fallback: Date): Date | null {
  for (const key of ['createdAt', 'updatedAt']) {
    const value = asString(metadata[key]);
    if (!value) continue;
    const timestamp = new Date(value);
    if (!Number.isNaN(timestamp.getTime())) return timestamp;
  }
  return fallback;
}

function contentCollectionKey(metadata: Record<string, unknown>): string | null {
  const folderId = asString(metadata.folderId);
  if (folderId) return `folder:${folderId}`;
  const parentId = asString(metadata.parentId);
  if (parentId) return `note-parent:${parentId}`;
  return null;
}

function urlDomain(value: string): string {
  if (!value) return '';
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueSlugs(value.filter((item): item is string => typeof item === 'string'));
}

function uniqueSlugs(slugs: string[]): string[] {
  return [...new Set(slugs.map((slug) => slug.trim()).filter(Boolean))];
}

function intersection(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item));
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function extractTopics(value: string): TopicCandidate[] {
  const text = value || '';
  const normalized = normalizeTopicText(text);
  const tokens = normalized.match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [];
  const candidates = new Map<
    string,
    {
      label: string;
      count: number;
      score: number;
    }
  >();

  for (let index = 0; index < tokens.length; index += 1) {
    for (const size of [1, 2, 3]) {
      const parts = tokens
        .slice(index, index + size)
        .map((token) => token.replace(/^[-_]+|[-_]+$/g, ''));
      if (parts.length !== size || !isValidTopicParts(parts)) continue;
      const slug = parts.join('-');
      const current = candidates.get(slug) ?? { label: topicLabel(slug), count: 0, score: 0 };
      const phraseWeight = size === 1 ? 1 : 1.18 + size * 0.12;
      current.count += 1;
      current.score += phraseWeight;
      candidates.set(slug, current);
    }
  }

  return [...candidates.entries()]
    .sort(([leftSlug, left], [rightSlug, right]) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.count !== left.count) return right.count - left.count;
      return leftSlug.localeCompare(rightSlug);
    })
    .slice(0, TOPIC_LIMIT)
    .map(([slug, candidate]) => ({
      slug,
      label: candidate.label,
      count: candidate.count,
      confidence: Math.min(1, Number((0.35 + candidate.score * 0.055).toFixed(4))),
      excerpt: topicExcerpt(text, slug),
    }));
}

function isValidTopicParts(parts: string[]): boolean {
  if (parts.some((part) => !part || /^\d+$/.test(part))) return false;
  if (parts.some((part) => part.startsWith('http') || part.startsWith('www'))) return false;
  if (parts.some((part) => TOPIC_STOPWORDS.has(part))) return false;
  if (parts.length === 1) return (parts[0]?.length ?? 0) >= TOPIC_MIN_LENGTH;
  return parts.join('').length >= TOPIC_MIN_LENGTH * parts.length;
}

function extractEntities(value: string): EntityCandidate[] {
  const text = value || '';
  const candidates = new Map<string, EntityCandidate>();

  for (const match of text.matchAll(/\bhttps?:\/\/[^\s)]+/gi)) {
    const raw = match[0];
    try {
      const host = new URL(raw).hostname.replace(/^www\./, '');
      addEntityCandidate(candidates, host, 'domain', text);
    } catch {
      // URL parcial ou inválida: ignora sem bloquear indexação.
    }
  }

  for (const match of text.matchAll(/(^|\s)#([\p{L}\p{N}_-]{3,})/gu)) {
    addEntityCandidate(candidates, match[2] ?? '', 'hashtag', text);
  }

  const capitalizedWord = String.raw`[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}\p{N}&_.-]{2,}`;
  const connector = String.raw`(?:d[aeo]s?|e|and|of|the)`;
  const properNounRegex = new RegExp(
    String.raw`\b${capitalizedWord}(?:[ \t]+(?:${connector}[ \t]+)?${capitalizedWord}){0,4}`,
    'gu',
  );
  for (const match of text.matchAll(properNounRegex)) {
    addEntityCandidate(candidates, match[0] ?? '', 'proper-noun', text);
  }

  return [...candidates.values()]
    .filter(
      (entity) =>
        entity.kind !== 'proper-noun' ||
        entity.count > 1 ||
        entity.label.includes(' ') ||
        hasStrongSingleTokenSignal(entity.label),
    )
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      if (right.label.length !== left.label.length) return right.label.length - left.label.length;
      return left.label.localeCompare(right.label);
    })
    .slice(0, ENTITY_LIMIT)
    .map((entity) => ({
      ...entity,
      confidence: Math.min(0.92, Number((0.48 + entity.count * 0.09).toFixed(4))),
    }));
}

function hasStrongSingleTokenSignal(label: string): boolean {
  return /^[A-Z0-9&.-]{3,}$/.test(label) || /[A-ZÁÉÍÓÚÂÊÔÃÕÇ].*[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(label);
}

function addEntityCandidate(
  candidates: Map<string, EntityCandidate>,
  rawLabel: string,
  kind: EntityCandidate['kind'],
  text: string,
): void {
  const label = cleanEntityLabel(rawLabel);
  const slug = conceptSlug(label);
  if (!label || slug.length < 3 || TOPIC_STOPWORDS.has(slug)) return;
  const current = candidates.get(slug) ?? {
    slug,
    label,
    kind,
    count: 0,
    confidence: 0.5,
    excerpt: topicExcerpt(text, slug),
  };
  current.count += 1;
  candidates.set(slug, current);
}

function cleanEntityLabel(value: string): string {
  return value
    .replace(/^#+/, '')
    .replace(/[.,;:!?()[\]{}"'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function conceptSlug(value: string): string {
  return normalizeTopicText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeTopicText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function topicLabel(slug: string): string {
  const parts = slug.split(/[-_]+/).filter(Boolean);
  if (parts.length === 0) return slug;
  return parts
    .map((part) =>
      part.length <= 3 ? part.toUpperCase() : `${part.charAt(0).toUpperCase()}${part.slice(1)}`,
    )
    .join(' ');
}

function topicExcerpt(text: string, slug: string): string | null {
  if (!text.trim()) return null;
  const needle = slug.replace(/[-_]+/g, ' ');
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/g)) {
    const haystack = normalizeTopicText(sentence).replace(/[^a-z0-9]+/g, ' ');
    if (haystack.includes(needle)) {
      return truncate(sentence, EVIDENCE_LIMIT);
    }
  }
  return truncate(text, EVIDENCE_LIMIT);
}

function truncate(value: string | null | undefined, limit: number): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
}
