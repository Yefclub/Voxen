import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { db } from '../lib/db';
import {
  applyNotePatch,
  noteContentChecksum,
  summarizeNotePatch,
  type NotePatchOperation,
} from '../lib/note-revisions';
import {
  NoteRevisionConflictError,
  commitNoteVersion,
  syncNoteGraph,
} from '../lib/note-versioning';
import { ok } from './mcp-tool-helpers';
import { noteWriteFailure } from './mcp-note-write-errors';

const MCP_NOTE_PATCH_SCHEMA = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['replace', 'insert_before', 'insert_after']),
    target: z.string().min(1).max(50_000),
    text: z.string().min(1).max(200_000),
    occurrence: z.number().int().min(1).max(10_000).optional(),
  }),
  z.object({ kind: z.enum(['prepend', 'append']), text: z.string().min(1).max(200_000) }),
]);

export function registerMcpNoteRevisionWriteTools(server: McpServer, userId: string): void {
  server.registerTool(
    'voxen_patch_note',
    {
      title: 'Editar trecho de nota com segurança',
      description:
        'Pré-visualiza ou aplica uma alteração exata e pequena no markdown de uma nota. ' +
        'Use preview_only=true primeiro; para aplicar, repita a mesma operação com ' +
        'preview_only=false e expected_revision ainda atual.',
      inputSchema: {
        note_id: z.string().min(1),
        expected_revision: z.number().int().min(1),
        operation: MCP_NOTE_PATCH_SCHEMA,
        preview_only: z.boolean().optional().default(true),
      },
      outputSchema: {
        applied: z.boolean(),
        noteId: z.string(),
        baseRevision: z.number(),
        revision: z.number(),
        checksum: z.string(),
        graphSync: z.string().nullable(),
        preview: z.object({
          matchCount: z.number(),
          start: z.number(),
          end: z.number(),
          line: z.number(),
          before: z.string(),
          after: z.string(),
          context: z.string(),
        }),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
        title: 'Editar trecho de nota',
      },
    },
    async (args) => {
      const current = await db.note.findFirst({
        where: { id: args.note_id, userId, kind: 'NOTE' },
        select: { title: true, content: true, revision: true },
      });
      if (!current) return noteWriteFailure(new Error('NOT_FOUND'))!;
      if (current.revision !== args.expected_revision) {
        return noteWriteFailure(
          new NoteRevisionConflictError(
            current.revision,
            noteContentChecksum(current.title, current.content),
          ),
        )!;
      }
      try {
        const operation = args.operation as NotePatchOperation;
        const patched = applyNotePatch(current.content, operation);
        const contextStart = Math.max(0, patched.start - 160);
        const contextEnd = Math.min(
          patched.content.length,
          patched.start + patched.after.length + 160,
        );
        const preview = {
          matchCount: patched.matchCount,
          start: patched.start,
          end: patched.end,
          line: patched.startLine,
          before: patched.before.slice(0, 500),
          after: patched.after.slice(0, 500),
          context: patched.content.slice(contextStart, contextEnd),
        };
        if (args.preview_only !== false) {
          return ok({
            applied: false,
            noteId: args.note_id,
            baseRevision: current.revision,
            revision: current.revision,
            checksum: noteContentChecksum(current.title, patched.content),
            graphSync: null,
            preview,
          });
        }
        const note = await commitNoteVersion({
          userId,
          noteId: args.note_id,
          expectedRevision: args.expected_revision,
          actor: 'MCP',
          changeSummary: summarizeNotePatch(operation),
          changes: { content: patched.content },
        });
        const graphSync = await syncNoteGraph(userId, note.id);
        return ok({
          applied: true,
          noteId: note.id,
          baseRevision: args.expected_revision,
          revision: note.revision,
          checksum: note.checksum,
          graphSync,
          preview,
        });
      } catch (error) {
        const failure = noteWriteFailure(error);
        if (failure) return failure;
        throw error;
      }
    },
  );

  server.registerTool(
    'voxen_restore_note_revision',
    {
      title: 'Restaurar revisão de nota',
      description:
        'Restaura título e conteúdo históricos criando uma nova revisão de cabeça. ' +
        'Nunca apaga o histórico e requer expected_revision atual.',
      inputSchema: {
        note_id: z.string().min(1),
        revision: z.number().int().min(1),
        expected_revision: z.number().int().min(1),
      },
      outputSchema: {
        id: z.string(),
        title: z.string(),
        revision: z.number(),
        restoredFromRevision: z.number(),
        checksum: z.string(),
        graphSync: z.string(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
        title: 'Restaurar revisão de nota',
      },
    },
    async (args) => {
      const snapshot = await db.noteRevision.findFirst({
        where: { noteId: args.note_id, userId, revision: args.revision },
        select: { title: true, content: true },
      });
      if (!snapshot) return noteWriteFailure(new Error('NOT_FOUND'))!;
      try {
        const note = await commitNoteVersion({
          userId,
          noteId: args.note_id,
          expectedRevision: args.expected_revision,
          actor: 'RESTORE',
          changeSummary: `Restore revision ${args.revision} through MCP`,
          changes: { title: snapshot.title, content: snapshot.content },
        });
        const graphSync = await syncNoteGraph(userId, note.id);
        return ok({
          id: note.id,
          title: note.title,
          revision: note.revision,
          restoredFromRevision: args.revision,
          checksum: note.checksum,
          graphSync,
        });
      } catch (error) {
        const failure = noteWriteFailure(error);
        if (failure) return failure;
        throw error;
      }
    },
  );
}
