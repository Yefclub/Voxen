import type { Prisma } from '../../../prisma-generated/client';
import { publishKnowledgeDeletionJob } from '../knowledge-deletion';
import { syncNoteGraph } from '../note-versioning';
import {
  syncTranscriptCorrectionGraph,
  type TranscriptCorrectionHead,
} from '../transcript-correction-versioning';
import { applyApprovedKnowledgeDeletionMutation } from './knowledge-deletion';
import { HITL_ACTION_DELETE_KNOWLEDGE, HITL_ACTION_PATCH_TRANSCRIPT } from './hitl-policy';
import { applyApprovedNoteMutation, type ChatApprovalPayload } from './note-editing';
import { applyApprovedTranscriptMutation } from './transcript-editing';

export type ApprovedResource =
  | { id: string; title: string; kind: 'note' }
  | { id: string; title: string; kind: 'transcript' }
  | { id: string; title: string; kind: 'knowledge'; jobId: string };

type ApprovedMutation = {
  resource: ApprovedResource;
  outcomeMessage: string;
  systemMessage: string;
  resultFields: {
    noteId?: string;
    transcriptId?: string;
    deletionJobId?: string;
    deletionJobCreated?: boolean;
  };
};

export async function applyApprovedChatMutation(
  tx: Prisma.TransactionClient,
  userId: string,
  payload: ChatApprovalPayload,
  transcriptHead: TranscriptCorrectionHead | null,
): Promise<ApprovedMutation> {
  if (payload.action === HITL_ACTION_DELETE_KNOWLEDGE) {
    const mutation = await applyApprovedKnowledgeDeletionMutation(tx, userId, payload);
    return {
      resource: { ...mutation.resource, kind: 'knowledge', jobId: mutation.jobId },
      outcomeMessage: mutation.outcomeMessage,
      systemMessage: mutation.systemMessage,
      resultFields: {
        deletionJobId: mutation.jobId,
        deletionJobCreated: mutation.jobCreated,
      },
    };
  }
  if (payload.action === HITL_ACTION_PATCH_TRANSCRIPT) {
    if (!transcriptHead) throw new Error('A prévia da correção não está disponível.');
    const mutation = await applyApprovedTranscriptMutation(tx, userId, payload, transcriptHead);
    return {
      ...mutation,
      resource: { ...mutation.resource, kind: 'transcript' },
      resultFields: { transcriptId: mutation.resource.id },
    };
  }
  const mutation = await applyApprovedNoteMutation(tx, userId, payload);
  return {
    outcomeMessage: mutation.outcomeMessage,
    systemMessage: mutation.systemMessage,
    resource: { ...mutation.note, kind: 'note' },
    resultFields: { noteId: mutation.note.id },
  };
}

export async function publishApprovedMutationSideEffects(
  userId: string,
  result: {
    action: string;
    noteId?: string;
    transcriptId?: string;
    deletionJobId?: string;
    deletionJobCreated?: boolean;
  },
): Promise<void> {
  if (result.deletionJobId && result.deletionJobCreated) {
    await publishKnowledgeDeletionJob(userId, result.deletionJobId);
  }
  if (result.action === HITL_ACTION_DELETE_KNOWLEDGE) return;
  if (result.noteId) await syncNoteGraph(userId, result.noteId);
  if (result.transcriptId) await syncTranscriptCorrectionGraph(userId, result.transcriptId);
}
