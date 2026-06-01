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

const DESCRIPTION_LIMIT = 800;
const EVIDENCE_LIMIT = 600;
const TOPIC_LIMIT = 10;
const ENTITY_LIMIT = 8;
const RELATED_CONTENT_LIMIT = 12;
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
): Promise<void> {
  await deleteSharedConceptEdgesForSource(userId, sourceType, sourceId);
  await removeSourceEvidence(userId, sourceType, sourceId);
  await db.brainNode.deleteMany({ where: { userId, sourceType, sourceId } });
  await deleteOrphanAutomaticConceptNodes(userId);
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

  await deleteSharedConceptEdgesForSource(userId, 'TRANSCRIPT', transcript.id);
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
      topicIndexVersion: 1,
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

  await indexConceptsForContent({
    userId,
    contentNodeId: contentNode.id,
    sourceType: 'TRANSCRIPT',
    sourceId: transcript.id,
    status: transcript.status,
    text: `${transcript.title}\n${transcript.channel ?? ''}\n${transcript.summaryMd || transcript.plainText}`,
  });
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
  await deleteSharedConceptEdgesForSource(userId, 'NOTE', note.id);
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

  await indexConceptsForContent({
    userId,
    contentNodeId: node.id,
    sourceType: 'NOTE',
    sourceId: note.id,
    status: 'ACTIVE',
    text: `${note.title}\n${note.content}`,
  });
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
    await deleteOrphanAutomaticConceptNodes(userId);
  }
}

async function deleteSharedConceptEdgesForSource(
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
      method: 'shared-concepts',
      OR: [{ fromNodeId: node.id }, { toNodeId: node.id }],
    },
  });
}

async function deleteOrphanAutomaticConceptNodes(userId: string): Promise<void> {
  await db.$executeRaw`
    DELETE FROM "BrainNode" n
    WHERE n."userId" = ${userId}
      AND n."sourceType" IS NULL
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
}): Promise<void> {
  if (input.status !== 'ACTIVE') return;
  const indexed: IndexedConcept[] = [];

  for (const topic of extractTopics(input.text)) {
    const topicNode = await upsertTopicNode(input.userId, topic);
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

  for (const entity of extractEntities(input.text)) {
    const entityNode = await upsertEntityNode(input.userId, entity);
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

  await connectContentBySharedConcepts({
    userId: input.userId,
    contentNodeId: input.contentNodeId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    concepts: indexed,
  });
}

async function connectContentBySharedConcepts(input: {
  userId: string;
  contentNodeId: string;
  sourceType: Extract<BrainSourceType, 'TRANSCRIPT' | 'NOTE'>;
  sourceId: string;
  concepts: IndexedConcept[];
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

  const ranked = [...candidates.values()]
    .filter((candidate) => candidate.score >= 1.25 || candidate.concepts.length >= 2)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.label.localeCompare(right.label);
    })
    .slice(0, RELATED_CONTENT_LIMIT);

  for (const candidate of ranked) {
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
    });
  }
}

function canonicalEdge(left: string, right: string): [string, string] {
  return left.localeCompare(right) <= 0 ? [left, right] : [right, left];
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
