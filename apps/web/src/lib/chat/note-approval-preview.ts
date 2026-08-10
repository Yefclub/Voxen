import { db } from '../db';
import { applyNotePatch, noteContentChecksum } from '../note-revisions';
import { NoteRevisionConflictError } from '../note-versioning';
import { HITL_ACTION_PATCH_NOTE, HITL_ACTION_PATCH_TRANSCRIPT } from './hitl-policy';
import {
  chatPatchApprovalProof,
  extractPatchProposal,
  type ChatApprovalPayload,
  type ChatPatchApprovalPreview,
  type ChatPatchProposal,
} from './note-editing';
import {
  extractTranscriptPatchProposal,
  prepareChatTranscriptPatchApproval,
  type ChatTranscriptPatchApprovalPreview,
} from './transcript-editing';

type PatchApprovalPayload = Extract<ChatApprovalPayload, { action: typeof HITL_ACTION_PATCH_NOTE }>;

export async function prepareChatPatchApproval(
  userId: string,
  payload: ChatPatchProposal,
): Promise<{ payload: PatchApprovalPayload; preview: ChatPatchApprovalPreview }> {
  const note = await db.note.findFirst({
    where: { id: payload.noteId, userId, kind: 'NOTE' },
    select: { title: true, content: true, revision: true },
  });
  if (!note) throw new Error('Nota não encontrada ou não editável.');
  if (note.revision !== payload.expectedRevision) {
    throw new NoteRevisionConflictError(
      note.revision,
      noteContentChecksum(note.title, note.content),
    );
  }
  const patched = applyNotePatch(note.content, payload.operation);
  const target = 'target' in payload.operation ? payload.operation.target : '';
  const contextRadius = 180;
  const contextStart = Math.max(0, patched.start - contextRadius);
  const contextEnd = Math.min(
    patched.content.length,
    patched.start + patched.after.length + contextRadius,
  );
  const context = patched.content.slice(contextStart, contextEnd);
  const resultingChecksum = noteContentChecksum(note.title, patched.content);
  const preview: ChatPatchApprovalPreview = {
    operationKind: payload.operation.kind,
    occurrence: 'occurrence' in payload.operation ? (payload.operation.occurrence ?? null) : null,
    changeSummary: payload.changeSummary,
    target: target.slice(0, 500),
    replacement: payload.operation.text.slice(0, 500),
    line: patched.startLine,
    context: context.slice(0, 700),
    resultingChecksum,
    truncatedTarget: target.length > 500,
    truncatedReplacement: payload.operation.text.length > 500,
    truncatedContext: context.length > 700,
  };
  const canonicalPayload = { ...payload, noteTitle: note.title };
  return {
    payload: {
      ...canonicalPayload,
      patchPreview: preview,
      previewProof: chatPatchApprovalProof(canonicalPayload, note.title, resultingChecksum),
    },
    preview,
  };
}

export async function prepareChatApprovalInput(
  userId: string,
  action: string,
  input: Record<string, unknown>,
): Promise<{
  trustedInput: Record<string, unknown>;
  patchPreview?: ChatPatchApprovalPreview | ChatTranscriptPatchApprovalPreview;
}> {
  if (action === HITL_ACTION_PATCH_TRANSCRIPT) {
    const candidate = extractTranscriptPatchProposal({ ...input, action });
    if (!candidate) throw new Error('Proposta de correção de transcrição inválida.');
    const prepared = await prepareChatTranscriptPatchApproval(userId, candidate);
    return {
      trustedInput: { ...prepared.payload, title: prepared.payload.transcriptTitle },
      patchPreview: prepared.preview,
    };
  }
  if (action !== HITL_ACTION_PATCH_NOTE) return { trustedInput: input };
  const candidate = extractPatchProposal({ ...input, action });
  if (!candidate) {
    throw new Error('Proposta de edição inválida.');
  }
  const prepared = await prepareChatPatchApproval(userId, candidate);
  return {
    trustedInput: { ...prepared.payload, title: prepared.payload.noteTitle },
    patchPreview: prepared.preview,
  };
}
