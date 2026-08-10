import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../lib/db';
import {
  NotePatchError,
  applyNotePatch,
  noteContentChecksum,
  searchWithinNote,
  summarizeNotePatch,
  type NotePatchOperation,
} from '../lib/note-revisions';
import {
  NoteNotFoundError,
  NoteRevisionConflictError,
  commitNoteVersion,
  syncNoteGraph,
} from '../lib/note-versioning';

type Vars = { userId: string };

export const noteVersionRoutes = new Hono<{ Variables: Vars }>();

const PatchOperationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['replace', 'insert_before', 'insert_after']),
    target: z.string().min(1).max(50_000),
    text: z.string().min(1).max(200_000),
    occurrence: z.number().int().min(1).max(10_000).optional(),
  }),
  z.object({ kind: z.enum(['prepend', 'append']), text: z.string().min(1).max(200_000) }),
]);

const SurgicalPatchBody = z.object({
  expectedRevision: z.number().int().min(1),
  operation: PatchOperationSchema,
});

function patchPreview(
  title: string,
  result: ReturnType<typeof applyNotePatch>,
): Record<string, unknown> {
  const radius = 160;
  const contextStart = Math.max(0, result.start - radius);
  const contextEnd = Math.min(result.content.length, result.start + result.after.length + radius);
  return {
    title,
    resultingChecksum: noteContentChecksum(title, result.content),
    matchCount: result.matchCount,
    start: result.start,
    end: result.end,
    line: result.startLine,
    before: result.before.slice(0, 500),
    after: result.after.slice(0, 500),
    context: result.content.slice(contextStart, contextEnd),
    truncatedBefore: result.before.length > 500,
    truncatedAfter: result.after.length > 500,
  };
}

function mutationError(error: unknown): Response | null {
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
  if (error instanceof NotePatchError) {
    return Response.json(
      { error: error.message, code: error.code, matchCount: error.matchCount },
      { status: 400 },
    );
  }
  return null;
}

noteVersionRoutes.get('/:id/search', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const query = (c.req.query('q') ?? '').trim();
  if (!query || query.length > 500) return c.json({ error: 'Consulta inválida.' }, 400);
  const requestedLimit = Number(c.req.query('limit') ?? 20);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, requestedLimit)) : 20;
  const note = await db.note.findFirst({
    where: { id, userId, kind: 'NOTE' },
    select: { id: true, title: true, content: true, revision: true },
  });
  if (!note) return c.json({ error: 'Nota não encontrada.' }, 404);
  return c.json({
    noteId: note.id,
    title: note.title,
    revision: note.revision,
    checksum: noteContentChecksum(note.title, note.content),
    query,
    matches: searchWithinNote(note.content, query, { limit }),
  });
});

noteVersionRoutes.post('/:id/patch/preview', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const parsed = SurgicalPatchBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Payload inválido.' }, 400);
  const note = await db.note.findFirst({
    where: { id, userId, kind: 'NOTE' },
    select: { title: true, content: true, revision: true },
  });
  if (!note) return c.json({ error: 'Nota não encontrada.' }, 404);
  if (note.revision !== parsed.data.expectedRevision) {
    return c.json(
      {
        error: 'A nota foi alterada desde a última leitura.',
        code: 'REVISION_CONFLICT',
        currentRevision: note.revision,
        currentChecksum: noteContentChecksum(note.title, note.content),
      },
      409,
    );
  }
  try {
    const result = applyNotePatch(note.content, parsed.data.operation as NotePatchOperation);
    return c.json({
      noteId: id,
      baseRevision: note.revision,
      proposedRevision: note.revision + 1,
      preview: patchPreview(note.title, result),
    });
  } catch (error) {
    const response = mutationError(error);
    if (response) return response;
    throw error;
  }
});

noteVersionRoutes.post('/:id/patch', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const parsed = SurgicalPatchBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Payload inválido.' }, 400);
  try {
    const current = await db.note.findFirst({
      where: { id, userId, kind: 'NOTE' },
      select: { title: true, content: true, revision: true },
    });
    if (!current) return c.json({ error: 'Nota não encontrada.' }, 404);
    if (current.revision !== parsed.data.expectedRevision) {
      throw new NoteRevisionConflictError(
        current.revision,
        noteContentChecksum(current.title, current.content),
      );
    }
    const operation = parsed.data.operation as NotePatchOperation;
    const result = applyNotePatch(current.content, operation);
    const note = await commitNoteVersion({
      userId,
      noteId: id,
      expectedRevision: parsed.data.expectedRevision,
      actor: 'USER',
      changeSummary: summarizeNotePatch(operation),
      changes: { content: result.content },
    });
    const graphSync = await syncNoteGraph(userId, id);
    return c.json({ note, graphSync, preview: patchPreview(note.title, result) });
  } catch (error) {
    const response = mutationError(error);
    if (response) return response;
    throw error;
  }
});

noteVersionRoutes.get('/:id/revisions', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const note = await db.note.findFirst({ where: { id, userId }, select: { id: true } });
  if (!note) return c.json({ error: 'Nota não encontrada.' }, 404);
  const revisions = await db.noteRevision.findMany({
    where: { noteId: id, userId },
    orderBy: { revision: 'desc' },
    take: 100,
    select: {
      revision: true,
      title: true,
      checksum: true,
      actor: true,
      changeSummary: true,
      createdAt: true,
    },
  });
  return c.json({ revisions });
});

noteVersionRoutes.get('/:id/revisions/:revision', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const revision = Number(c.req.param('revision'));
  if (!Number.isInteger(revision) || revision < 1)
    return c.json({ error: 'Revisão inválida.' }, 400);
  const snapshot = await db.noteRevision.findFirst({
    where: { noteId: id, userId, revision },
    select: {
      revision: true,
      title: true,
      content: true,
      checksum: true,
      actor: true,
      changeSummary: true,
      createdAt: true,
    },
  });
  if (!snapshot) return c.json({ error: 'Revisão não encontrada.' }, 404);
  return c.json({ revision: snapshot });
});

const RestoreBody = z.object({ expectedRevision: z.number().int().min(1) });

noteVersionRoutes.post('/:id/revisions/:revision/restore', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const revision = Number(c.req.param('revision'));
  const parsed = RestoreBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || !Number.isInteger(revision) || revision < 1)
    return c.json({ error: 'Payload inválido.' }, 400);
  const snapshot = await db.noteRevision.findFirst({
    where: { noteId: id, userId, revision },
    select: { title: true, content: true },
  });
  if (!snapshot) return c.json({ error: 'Revisão não encontrada.' }, 404);
  try {
    const note = await commitNoteVersion({
      userId,
      noteId: id,
      expectedRevision: parsed.data.expectedRevision,
      actor: 'RESTORE',
      changeSummary: `Restore revision ${revision}`,
      changes: { title: snapshot.title, content: snapshot.content },
    });
    const graphSync = await syncNoteGraph(userId, id);
    return c.json({ note, graphSync, restoredFromRevision: revision });
  } catch (error) {
    const response = mutationError(error);
    if (response) return response;
    throw error;
  }
});
