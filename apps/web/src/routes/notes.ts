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
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { enqueueKnowledgeDeletion, knowledgeDeletionHttpError } from '../lib/knowledge-deletion';
import {
  NoteAnchorValidationError,
  noteSourceCreateData,
  validateNoteAnchors,
} from '../lib/note-anchors';
import { noteContentChecksum } from '../lib/note-revisions';
import {
  createPreparedNoteForHttp,
  PreparedIngestContractError,
  toPreparedNoteMetadata,
} from '../lib/prepared-note-ingest';
import {
  NoteNotFoundError,
  NoteRevisionConflictError,
  commitNoteVersion,
  recordInitialNoteRevision,
  syncNoteGraph,
} from '../lib/note-versioning';
import { noteVersionRoutes } from './note-version-routes';
import { CreateBody, PatchBody } from '../lib/note-input';

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
      sourceType: true,
      sourceId: true,
      kind: true,
      title: true,
      revision: true,
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
    revision: number;
  };
  const rows = await db.$queryRaw<Row[]>`
    SELECT
      id, title, "parentId", revision,
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

function noteMutationError(error: unknown): Response | null {
  if (error instanceof NoteRevisionConflictError) {
    return Response.json(
      {
        error: 'A nota foi alterada desde a última leitura.',
        code: 'REVISION_CONFLICT',
        currentRevision: error.currentRevision,
        currentChecksum: error.currentChecksum,
      },
      { status: 409 },
    );
  }
  if (error instanceof NoteNotFoundError) {
    return Response.json({ error: 'Nota não encontrada.' }, { status: 404 });
  }
  return null;
}

notesRoutes.route('/', noteVersionRoutes);

// GET /api/notes/:id
notesRoutes.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const note = await db.note.findFirst({
    where: { id, userId },
    select: {
      id: true,
      parentId: true,
      sourceType: true,
      sourceId: true,
      kind: true,
      title: true,
      content: true,
      revision: true,
      language: true,
      author: true,
      sourceUrl: true,
      publishedAt: true,
      createdAt: true,
      updatedAt: true,
      transcriptSources: {
        orderBy: { createdAt: 'asc' },
        select: {
          transcriptId: true,
          transcript: { select: { title: true, url: true } },
          anchors: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              startLine: true,
              endLine: true,
              startSec: true,
              endSec: true,
              selectedQuote: true,
              sourceVersion: true,
              sourceChecksum: true,
              status: true,
              staleReason: true,
            },
          },
        },
      },
    },
  });
  if (!note) return c.json({ error: 'Nota não encontrada.' }, 404);
  return c.json({ note: { ...note, checksum: noteContentChecksum(note.title, note.content) } });
});

notesRoutes.post('/', async (c) => {
  const userId = c.get('userId');
  const parsed = CreateBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Payload inválido.' }, 400);
  const {
    parentId,
    sourceType,
    sourceId,
    sourceTranscriptIds,
    sourceAnchors,
    kind,
    title,
    content,
    contract_version,
    idempotency_key,
    producer_id,
    external_id,
    metadata,
  } = parsed.data;

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
  if (
    kind !== 'NOTE' &&
    (contract_version ?? idempotency_key ?? producer_id ?? external_id ?? metadata)
  ) {
    return c.json({ error: 'Contrato de ingestão vale só para notas (kind NOTE).' }, 400);
  }

  if (sourceType || sourceId) {
    if (kind !== 'NOTE') {
      return c.json({ error: 'Só notas podem ser vinculadas a conteúdo.' }, 400);
    }
    if (sourceType !== 'TRANSCRIPT' || !sourceId) {
      return c.json({ error: 'Vínculo de conteúdo inválido.' }, 400);
    }
  }
  const requestedSourceIds = [
    ...(sourceTranscriptIds ?? []),
    ...(sourceType === 'TRANSCRIPT' && sourceId ? [sourceId] : []),
    ...(sourceAnchors ?? []).map((anchor) => anchor.transcriptId),
  ];
  if (requestedSourceIds.length > 0 && kind !== 'NOTE') {
    return c.json({ error: 'Só notas podem ser vinculadas a conteúdo.' }, 400);
  }
  const transcriptIds = await resolveTranscriptSourceIds(userId, requestedSourceIds);
  if (transcriptIds === null)
    return c.json({ error: 'Transcrição vinculada não encontrada.' }, 400);
  let anchors;
  try {
    anchors = await validateNoteAnchors(userId, sourceAnchors ?? []);
  } catch (error) {
    if (error instanceof NoteAnchorValidationError) return c.json({ error: error.message }, 400);
    throw error;
  }

  if (kind === 'NOTE') {
    let metadataParsed;
    try {
      metadataParsed = toPreparedNoteMetadata({
        language: metadata?.language,
        author: metadata?.author,
        source_url: metadata?.source_url,
        published_at: metadata?.published_at,
      });
    } catch (error) {
      if (error instanceof PreparedIngestContractError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
    let created;
    try {
      created = await createPreparedNoteForHttp(userId, {
        title,
        content,
        parentId: parentId ?? null,
        transcriptIds,
        anchors,
        actor: 'USER',
        idempotencyKey: idempotency_key,
        producerId: producer_id,
        externalId: external_id,
        contractVersion: contract_version,
        metadata: metadataParsed,
      });
    } catch (error) {
      if (error instanceof PreparedIngestContractError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
    return c.json(created, created.duplicate ? 200 : 201);
  }

  const note = await db.$transaction(async (tx) => {
    const created = await tx.note.create({
      data: {
        userId,
        parentId: parentId ?? null,
        sourceType: transcriptIds.length > 0 ? 'TRANSCRIPT' : null,
        sourceId: transcriptIds[0] ?? null,
        kind,
        title: title.trim(),
        content: '',
        ...(transcriptIds.length > 0
          ? {
              transcriptSources: {
                create: noteSourceCreateData(userId, transcriptIds, anchors),
              },
            }
          : {}),
      },
    });
    await recordInitialNoteRevision(tx, created, 'USER');
    return created;
  });
  const graphSync = await syncNoteGraph(userId, note.id);
  return c.json({ note, graphSync }, 201);
});

notesRoutes.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const existing = await db.note.findFirst({
    where: { id, userId },
    select: {
      id: true,
      kind: true,
      parentId: true,
      revision: true,
      transcriptSources: { select: { transcriptId: true } },
    },
  });
  if (!existing) return c.json({ error: 'Nota não encontrada.' }, 404);

  const parsed = PatchBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Payload inválido.' }, 400);
  const { expectedRevision, parentId, title, content, sourceTranscriptIds, sourceAnchors } =
    parsed.data;

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

  const replaceSources = sourceTranscriptIds !== undefined || sourceAnchors !== undefined;
  const preservedSourceIds = existing.transcriptSources.map((source) => source.transcriptId);
  const requestedTranscriptIds = [
    ...(sourceTranscriptIds ?? (sourceAnchors !== undefined ? preservedSourceIds : [])),
    ...(sourceAnchors ?? []).map((anchor) => anchor.transcriptId),
  ];
  const transcriptIds = !replaceSources
    ? undefined
    : await resolveTranscriptSourceIds(userId, requestedTranscriptIds);
  if (transcriptIds === null)
    return c.json({ error: 'Transcrição vinculada não encontrada.' }, 400);
  if (transcriptIds !== undefined && existing.kind !== 'NOTE') {
    return c.json({ error: 'Só notas podem ser vinculadas a conteúdo.' }, 400);
  }
  let anchors;
  try {
    anchors = await validateNoteAnchors(userId, sourceAnchors ?? []);
  } catch (error) {
    if (error instanceof NoteAnchorValidationError) return c.json({ error: error.message }, 400);
    throw error;
  }

  try {
    const note = await commitNoteVersion({
      userId,
      noteId: id,
      expectedRevision,
      actor: 'USER',
      changeSummary: 'Edit note',
      changes: {
        ...(parentId !== undefined ? { parentId } : {}),
        ...(title !== undefined ? { title: title.trim() } : {}),
        ...(content !== undefined && existing.kind === 'NOTE' ? { content } : {}),
        ...(transcriptIds !== undefined
          ? {
              sourceType: transcriptIds.length > 0 ? 'TRANSCRIPT' : null,
              sourceId: transcriptIds[0] ?? null,
            }
          : {}),
      },
      ...(transcriptIds !== undefined
        ? {
            mutateRelations: async (tx) => {
              await tx.note.update({
                where: { id },
                data: {
                  transcriptSources:
                    sourceAnchors !== undefined
                      ? {
                          deleteMany: {},
                          ...(transcriptIds.length > 0
                            ? { create: noteSourceCreateData(userId, transcriptIds, anchors) }
                            : {}),
                        }
                      : {
                          deleteMany:
                            transcriptIds.length > 0
                              ? { transcriptId: { notIn: transcriptIds } }
                              : {},
                          upsert: transcriptIds.map((transcriptId) => ({
                            where: { noteId_transcriptId: { noteId: id, transcriptId } },
                            update: {},
                            create: { transcriptId, userId },
                          })),
                        },
                },
              });
            },
          }
        : {}),
    });
    const graphSync = await syncNoteGraph(userId, id);
    return c.json({ note, graphSync });
  } catch (error) {
    const response = noteMutationError(error);
    if (response) return response;
    throw error;
  }
});

notesRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  try {
    const result = await enqueueKnowledgeDeletion({ userId, type: 'NOTE', id });
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

async function resolveTranscriptSourceIds(
  userId: string,
  sourceIds: readonly string[],
): Promise<string[] | null> {
  const normalized = sourceIds.map((id) => id.trim());
  if (normalized.some((id) => !id)) return null;
  const ids = [...new Set(normalized)];
  if (ids.length === 0) return [];
  const transcripts = await db.transcript.findMany({
    where: { id: { in: ids }, userId, status: { not: 'TRASH' } },
    select: { id: true },
  });
  return transcripts.length === ids.length ? ids : null;
}
