import type { Context, Hono } from 'hono';
import { NotePatchError, summarizeNotePatch } from '../lib/note-revisions';
import {
  commitTranscriptCorrection,
  commitTranscriptCorrectionSnapshot,
  loadTranscriptCorrectionHead,
  syncTranscriptCorrectionGraph,
  TranscriptCorrectionConflictError,
  TranscriptCorrectionNotFoundError,
  TranscriptCorrectionPreviewMismatchError,
  type TranscriptCorrectionHead,
} from '../lib/transcript-correction-versioning';
import {
  TranscriptCorrectionApplySchema,
  TranscriptCorrectionPreviewSchema,
  TranscriptCorrectionRestoreSchema,
} from '../lib/transcript-correction-schemas';
import {
  applyTranscriptPatch,
  searchWithinTranscript,
  transcriptCorrectionChecksum,
  TranscriptCorrectionInvariantError,
  transcriptMarkdownToPlainText,
} from '../lib/transcript-corrections';
import { db } from '../lib/db';
import { storageReadText } from '../lib/storage';

type Vars = { userId: string };

export function registerTranscriptCorrectionRoutes(routes: Hono<{ Variables: Vars }>): void {
  routes.get('/:id/corrections', async (c) => {
    try {
      return c.json({
        head: publicHead(await loadTranscriptCorrectionHead(c.get('userId'), c.req.param('id'))),
      });
    } catch (error) {
      return correctionFailure(c, error);
    }
  });

  routes.get('/:id/corrections/search', async (c) => {
    const query = (c.req.query('q') ?? '').trim();
    if (!query) return c.json({ error: 'Informe um termo de busca.' }, 400);
    try {
      const head = await loadTranscriptCorrectionHead(c.get('userId'), c.req.param('id'));
      return c.json({
        revision: head.correctionRevision,
        checksum: head.checksum,
        sourceVersion: head.sourceVersion,
        sourceChecksum: head.sourceChecksum,
        matches: searchWithinTranscript(head.markdown, query, {
          limit: parseBoundedInt(c.req.query('limit'), 20, 1, 100),
          contextChars: parseBoundedInt(c.req.query('contextChars'), 160, 0, 500),
        }),
      });
    } catch (error) {
      return correctionFailure(c, error);
    }
  });

  routes.post('/:id/corrections/preview', async (c) => {
    const parsed = TranscriptCorrectionPreviewSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return c.json({ error: 'Payload de correção inválido.' }, 400);
    try {
      const head = await loadTranscriptCorrectionHead(c.get('userId'), c.req.param('id'));
      assertExpectedHead(head, parsed.data);
      const patched = applyTranscriptPatch(head.markdown, parsed.data.operation);
      const plainText = transcriptMarkdownToPlainText(patched.content);
      const contextStart = Math.max(0, patched.start - 240);
      const contextEnd = Math.min(
        patched.content.length,
        patched.start + patched.after.length + 240,
      );
      return c.json({
        transcriptId: head.id,
        baseRevision: head.correctionRevision,
        sourceVersion: head.sourceVersion,
        sourceChecksum: head.sourceChecksum,
        baseChecksum: head.checksum,
        resultChecksum: transcriptCorrectionChecksum(patched.content, plainText),
        preview: {
          matchCount: patched.matchCount,
          start: patched.start,
          end: patched.end,
          line: patched.startLine,
          before: patched.before.slice(0, 1_000),
          after: patched.after.slice(0, 1_000),
          context: patched.content.slice(contextStart, contextEnd),
        },
      });
    } catch (error) {
      return correctionFailure(c, error);
    }
  });

  routes.post('/:id/corrections/apply', async (c) => {
    const parsed = TranscriptCorrectionApplySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Payload de correção inválido.' }, 400);
    const userId = c.get('userId');
    try {
      const head = await loadTranscriptCorrectionHead(userId, c.req.param('id'));
      assertExpectedHead(head, parsed.data);
      if (head.checksum !== parsed.data.expectedBaseChecksum) throw conflictFromHead(head);
      const correction = await commitTranscriptCorrection({
        userId,
        transcriptId: head.id,
        expectedRevision: parsed.data.expectedRevision,
        expectedSourceVersion: parsed.data.expectedSourceVersion,
        expectedSourceChecksum: parsed.data.expectedSourceChecksum,
        expectedBaseChecksum: parsed.data.expectedBaseChecksum,
        expectedResultChecksum: parsed.data.expectedResultChecksum,
        baseMarkdown: head.markdown,
        operation: parsed.data.operation,
        actor: 'USER',
        changeSummary: summarizeNotePatch(parsed.data.operation),
      });
      return c.json({
        correction,
        graphSync: await syncTranscriptCorrectionGraph(userId, head.id),
      });
    } catch (error) {
      return correctionFailure(c, error);
    }
  });

  routes.get('/:id/corrections/revisions', async (c) => {
    const userId = c.get('userId');
    const transcriptId = c.req.param('id');
    if (
      !(await db.transcript.findFirst({
        where: { id: transcriptId, userId },
        select: { id: true },
      }))
    )
      return c.json({ error: 'Transcrição não encontrada.' }, 404);
    const before = parseOptionalPositiveInt(c.req.query('before'));
    const limit = parseBoundedInt(c.req.query('limit'), 50, 1, 100);
    const rows = await db.transcriptCorrectionRevision.findMany({
      where: { userId, transcriptId, ...(before ? { revision: { lt: before } } : {}) },
      orderBy: { revision: 'desc' },
      take: limit + 1,
      select: {
        revision: true,
        sourceVersion: true,
        sourceChecksum: true,
        checksum: true,
        actor: true,
        changeSummary: true,
        createdAt: true,
      },
    });
    const page = rows.slice(0, limit);
    return c.json({
      revisions: page,
      nextBefore: rows.length > limit ? (page.at(-1)?.revision ?? null) : null,
    });
  });

  routes.get('/:id/corrections/revisions/:revision', async (c) => {
    const revision = parseOptionalPositiveInt(c.req.param('revision'));
    if (!revision) return c.json({ error: 'Revisão inválida.' }, 400);
    const snapshot = await db.transcriptCorrectionRevision.findFirst({
      where: { userId: c.get('userId'), transcriptId: c.req.param('id'), revision },
    });
    return snapshot
      ? c.json({ revision: snapshot })
      : c.json({ error: 'Revisão não encontrada.' }, 404);
  });

  routes.post('/:id/corrections/revisions/:revision/restore', async (c) => {
    const parsed = TranscriptCorrectionRestoreSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    const revision = parseOptionalPositiveInt(c.req.param('revision'));
    if (!parsed.success || !revision)
      return c.json({ error: 'Payload de restauração inválido.' }, 400);
    const userId = c.get('userId');
    const transcriptId = c.req.param('id');
    try {
      const [head, snapshot] = await Promise.all([
        loadTranscriptCorrectionHead(userId, transcriptId),
        db.transcriptCorrectionRevision.findFirst({ where: { userId, transcriptId, revision } }),
      ]);
      if (!snapshot) return c.json({ error: 'Revisão não encontrada.' }, 404);
      assertExpectedHead(head, parsed.data);
      if (
        head.checksum !== parsed.data.expectedBaseChecksum ||
        snapshot.sourceVersion !== head.sourceVersion ||
        snapshot.sourceChecksum !== head.sourceChecksum
      )
        throw conflictFromHead(head);
      const correction = await commitTranscriptCorrectionSnapshot({
        userId,
        transcriptId,
        expectedRevision: head.correctionRevision,
        expectedSourceVersion: head.sourceVersion,
        expectedSourceChecksum: head.sourceChecksum,
        expectedBaseChecksum: head.checksum,
        expectedResultChecksum: snapshot.checksum,
        baseMarkdown: head.markdown,
        replacementMarkdown: snapshot.markdown,
        operationMetadata: { kind: 'restore', revision },
        actor: 'RESTORE',
        changeSummary: `Restore correction revision ${revision}`,
      });
      return c.json({
        correction,
        restoredFromRevision: revision,
        graphSync: await syncTranscriptCorrectionGraph(userId, transcriptId),
      });
    } catch (error) {
      return correctionFailure(c, error);
    }
  });

  routes.post('/:id/corrections/reset', async (c) => {
    const parsed = TranscriptCorrectionRestoreSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return c.json({ error: 'Payload de restauração inválido.' }, 400);
    const userId = c.get('userId');
    const transcriptId = c.req.param('id');
    try {
      const [head, transcript] = await Promise.all([
        loadTranscriptCorrectionHead(userId, transcriptId),
        db.transcript.findFirst({ where: { id: transcriptId, userId }, select: { mdPath: true } }),
      ]);
      if (!transcript) throw new TranscriptCorrectionNotFoundError();
      assertExpectedHead(head, parsed.data);
      if (head.checksum !== parsed.data.expectedBaseChecksum) throw conflictFromHead(head);
      const markdown = await storageReadText(transcript.mdPath);
      const plainText = transcriptMarkdownToPlainText(markdown);
      const canonicalChecksum = transcriptCorrectionChecksum(markdown, plainText);
      if (head.correctionState === 'ACTIVE' && head.checksum === canonicalChecksum) {
        return c.json({
          correction: {
            transcriptId,
            revision: head.correctionRevision,
            sourceVersion: head.sourceVersion,
            sourceChecksum: head.sourceChecksum,
            state: head.correctionState,
            markdown: head.markdown,
            plainText: head.plainText,
            checksum: head.checksum,
          },
          unchanged: true,
          graphSync: 'READY',
        });
      }
      const correction = await commitTranscriptCorrectionSnapshot({
        userId,
        transcriptId,
        expectedRevision: head.correctionRevision,
        expectedSourceVersion: head.sourceVersion,
        expectedSourceChecksum: head.sourceChecksum,
        expectedBaseChecksum: head.checksum,
        expectedResultChecksum: canonicalChecksum,
        baseMarkdown: head.markdown,
        replacementMarkdown: markdown,
        allowUnchangedReplacement: head.correctionState === 'STALE',
        operationMetadata: { kind: 'reset_to_canonical' },
        actor: 'RESTORE',
        changeSummary: 'Reset corrections to canonical source',
      });
      return c.json({
        correction,
        graphSync: await syncTranscriptCorrectionGraph(userId, transcriptId),
      });
    } catch (error) {
      return correctionFailure(c, error);
    }
  });
}

function publicHead(head: TranscriptCorrectionHead): Omit<TranscriptCorrectionHead, 'plainText'> {
  const { plainText: _plainText, ...result } = head;
  return result;
}
function assertExpectedHead(
  head: TranscriptCorrectionHead,
  expected: {
    expectedRevision: number;
    expectedSourceVersion: number;
    expectedSourceChecksum: string | null;
  },
): void {
  if (
    head.correctionRevision !== expected.expectedRevision ||
    head.sourceVersion !== expected.expectedSourceVersion ||
    head.sourceChecksum !== expected.expectedSourceChecksum
  )
    throw conflictFromHead(head);
}
function conflictFromHead(head: TranscriptCorrectionHead): TranscriptCorrectionConflictError {
  return new TranscriptCorrectionConflictError({
    currentRevision: head.correctionRevision,
    currentChecksum: head.checksum,
    sourceVersion: head.sourceVersion,
    sourceChecksum: head.sourceChecksum,
  });
}
function correctionFailure(c: Context<{ Variables: Vars }>, error: unknown): Response {
  if (error instanceof TranscriptCorrectionNotFoundError)
    return c.json({ error: 'Transcrição não encontrada.' }, 404);
  if (error instanceof TranscriptCorrectionConflictError)
    return c.json(
      {
        error: error.message,
        code: 'CORRECTION_CONFLICT',
        currentRevision: error.currentRevision,
        currentChecksum: error.currentChecksum,
        sourceVersion: error.sourceVersion,
        sourceChecksum: error.sourceChecksum,
      },
      409,
    );
  if (error instanceof TranscriptCorrectionPreviewMismatchError)
    return c.json({ error: error.message, code: 'PREVIEW_MISMATCH' }, 409);
  if (error instanceof TranscriptCorrectionInvariantError)
    return c.json({ error: error.message, code: error.code }, 422);
  if (error instanceof NotePatchError)
    return c.json({ error: error.message, code: error.code, matchCount: error.matchCount }, 422);
  throw error;
}
function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
function parseOptionalPositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}
