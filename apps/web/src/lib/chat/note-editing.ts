import { tool } from 'ai';
import { z } from 'zod';
import type { Prisma } from '../../../prisma-generated/client';
import { db } from '../db';
import {
  NotePatchError,
  applyNotePatch,
  noteContentChecksum,
  searchWithinNote,
  summarizeNotePatch,
  type NotePatchOperation,
} from '../note-revisions';
import {
  NoteRevisionConflictError,
  commitNoteVersionInTransaction,
  recordInitialNoteRevision,
  syncNoteGraph,
} from '../note-versioning';
import { HITL_ACTION_CREATE_NOTE, HITL_ACTION_PATCH_NOTE } from './hitl-policy';

const chatNotePatchOperationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['replace', 'insert_before', 'insert_after']),
    target: z.string().min(1).max(20_000),
    text: z.string().min(1).max(20_000),
    occurrence: z.number().int().min(1).max(10_000).optional(),
  }),
  z.object({ kind: z.enum(['prepend', 'append']), text: z.string().min(1).max(20_000) }),
]);

export type ChatApprovalPayload =
  | { action: typeof HITL_ACTION_CREATE_NOTE; title: string; content: string }
  | {
      action: typeof HITL_ACTION_PATCH_NOTE;
      noteId: string;
      noteTitle: string;
      expectedRevision: number;
      operation: NotePatchOperation;
      changeSummary: string;
    };

export function extractApprovalPayload(
  output: Record<string, unknown>,
): ChatApprovalPayload | null {
  const action = typeof output.action === 'string' ? output.action : HITL_ACTION_CREATE_NOTE;
  if (action === HITL_ACTION_CREATE_NOTE) {
    const title = typeof output.title === 'string' ? output.title.trim() : '';
    const content = typeof output.content === 'string' ? output.content : '';
    return title ? { action, title, content } : null;
  }
  if (action !== HITL_ACTION_PATCH_NOTE) return null;
  const noteId = typeof output.noteId === 'string' ? output.noteId.trim() : '';
  const noteTitle =
    typeof output.noteTitle === 'string'
      ? output.noteTitle.trim()
      : typeof output.title === 'string'
        ? output.title.trim()
        : '';
  const expectedRevision = output.expectedRevision;
  const operation = chatNotePatchOperationSchema.safeParse(output.operation);
  const changeSummary = typeof output.changeSummary === 'string' ? output.changeSummary.trim() : '';
  if (
    !noteId ||
    !noteTitle ||
    typeof expectedRevision !== 'number' ||
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 1 ||
    !operation.success ||
    !changeSummary
  ) {
    return null;
  }
  return {
    action,
    noteId,
    noteTitle,
    expectedRevision,
    operation: operation.data as NotePatchOperation,
    changeSummary,
  };
}

export function recoverApprovalPayloadFromMessages(
  messages: Array<{ tools: unknown; segments: unknown }>,
  approvalId: string,
): ChatApprovalPayload | null {
  for (const message of messages) {
    for (const bag of [message.tools, message.segments]) {
      if (!Array.isArray(bag)) continue;
      for (const raw of bag) {
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as Record<string, unknown>;
        const tools = item.type === 'tool-group' && Array.isArray(item.tools) ? item.tools : [item];
        for (const toolRaw of tools) {
          if (!toolRaw || typeof toolRaw !== 'object') continue;
          const candidate = toolRaw as Record<string, unknown>;
          if (!candidate.output || typeof candidate.output !== 'object') continue;
          const output = candidate.output as Record<string, unknown>;
          if (output.approvalRequired !== true || output.approvalId !== approvalId) continue;
          const payload = extractApprovalPayload(output);
          if (payload) return payload;
        }
      }
    }
  }
  return null;
}

export function createSearchNoteContentTool(userId: string) {
  return tool({
    description:
      'Localiza um trecho dentro de uma nota específica antes de uma edição cirúrgica. ' +
      'Retorna ocorrências, linhas, contexto e a revisão que deve acompanhar a proposta.',
    inputSchema: z.object({
      noteId: z.string().min(1),
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    execute: async ({ noteId, query, limit }) => {
      const note = await db.note.findFirst({
        where: { id: noteId, userId, kind: 'NOTE' },
        select: { id: true, title: true, content: true, revision: true },
      });
      if (!note) return { error: 'Nota não encontrada.' };
      return {
        id: note.id,
        title: note.title,
        revision: note.revision,
        checksum: noteContentChecksum(note.title, note.content),
        matches: searchWithinNote(note.content, query, { limit: limit ?? 12 }),
      };
    },
  });
}

export function createProposePatchNoteTool() {
  return tool({
    description:
      'Propõe uma alteração exata e pequena em uma nota já lida. Sempre exige confirmação ' +
      'humana e usa expectedRevision para impedir sobrescrita concorrente.',
    inputSchema: z.object({
      noteId: z.string().min(1),
      noteTitle: z.string().min(1).max(200),
      expectedRevision: z.number().int().min(1),
      operation: chatNotePatchOperationSchema,
      changeSummary: z.string().min(1).max(300),
    }),
    execute: async ({ noteTitle, changeSummary }) => ({
      handledBy: 'ui_approve',
      title: noteTitle,
      changeSummary,
    }),
  });
}

export async function createVersionedChatNote(
  userId: string,
  title: string,
  content: string,
): Promise<{ id: string; title: string }> {
  const note = await db.$transaction(async (tx) => {
    const created = await tx.note.create({ data: { userId, kind: 'NOTE', title, content } });
    await recordInitialNoteRevision(tx, created, 'CHAT');
    return created;
  });
  void syncNoteGraph(userId, note.id);
  return note;
}

export async function applyApprovedNoteMutation(
  tx: Prisma.TransactionClient,
  userId: string,
  payload: ChatApprovalPayload,
): Promise<{
  note: { id: string; title: string };
  outcomeMessage: string;
  systemMessage: string;
}> {
  if (payload.action === HITL_ACTION_CREATE_NOTE) {
    const note = await tx.note.create({
      data: { userId, kind: 'NOTE', title: payload.title, content: payload.content },
    });
    await recordInitialNoteRevision(tx, note, 'CHAT');
    return {
      note,
      outcomeMessage: `Nota “${note.title}” criada.`,
      systemMessage: `Nota “${note.title}” criada após confirmação do usuário.`,
    };
  }
  const current = await tx.note.findFirst({
    where: { id: payload.noteId, userId, kind: 'NOTE' },
    select: { title: true, content: true, revision: true },
  });
  if (!current) throw new Error('Nota não encontrada ou não editável.');
  if (current.revision !== payload.expectedRevision) {
    throw new NoteRevisionConflictError(
      current.revision,
      noteContentChecksum(current.title, current.content),
    );
  }
  const patched = applyNotePatch(current.content, payload.operation);
  const note = await commitNoteVersionInTransaction(tx, {
    userId,
    noteId: payload.noteId,
    expectedRevision: payload.expectedRevision,
    actor: 'CHAT',
    changeSummary: `${summarizeNotePatch(payload.operation)}: ${payload.changeSummary}`,
    changes: { content: patched.content },
  });
  return {
    note,
    outcomeMessage: `Nota “${note.title}” atualizada.`,
    systemMessage: `Nota “${note.title}” atualizada em nova revisão após confirmação do usuário.`,
  };
}

export class ChatApprovalMutationError extends Error {
  readonly code: string;
  readonly currentRevision?: number;
  readonly currentChecksum?: string;

  constructor(
    code: string,
    message: string,
    details: { currentRevision?: number; currentChecksum?: string } = {},
  ) {
    super(message);
    this.name = 'ChatApprovalMutationError';
    this.code = code;
    this.currentRevision = details.currentRevision;
    this.currentChecksum = details.currentChecksum;
  }
}

export function normalizeApprovalMutationError(error: unknown): ChatApprovalMutationError | null {
  if (error instanceof NoteRevisionConflictError) {
    return new ChatApprovalMutationError(
      'REVISION_CONFLICT',
      'A nota foi alterada desde a proposta. Releia o conteúdo antes de tentar novamente.',
      { currentRevision: error.currentRevision, currentChecksum: error.currentChecksum },
    );
  }
  if (error instanceof NotePatchError) {
    return new ChatApprovalMutationError(error.code, error.message);
  }
  return null;
}
