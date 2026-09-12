import { createHash } from 'node:crypto';
import { tool } from 'ai';
import { z } from 'zod';
import type { Prisma } from '../../../prisma-generated/client';
import { summarizeNotePatch } from '../note-revisions';
import { TranscriptPatchOperationSchema } from '../transcript-correction-schemas';
import {
  commitTranscriptCorrectionInTransaction,
  loadTranscriptCorrectionHead,
  TranscriptCorrectionConflictError,
  TranscriptCorrectionNotFoundError,
  TranscriptCorrectionPreviewMismatchError,
  type TranscriptCorrectionHead,
} from '../transcript-correction-versioning';
import {
  applyTranscriptPatch,
  searchWithinTranscript,
  transcriptCorrectionChecksum,
  transcriptMarkdownToPlainText,
  type TranscriptPatchOperation,
} from '../transcript-corrections';
import { HITL_ACTION_PATCH_TRANSCRIPT } from './hitl-policy';
import { ChatApprovalMutationError } from './approval-error';

export type ChatTranscriptPatchApprovalPreview = {
  operationKind: TranscriptPatchOperation['kind'];
  occurrence: number | null;
  changeSummary: string;
  target: string;
  replacement: string;
  line: number;
  context: string;
  resultingChecksum: string;
  truncatedTarget: boolean;
  truncatedReplacement: boolean;
  truncatedContext: boolean;
};

export type ChatTranscriptPatchProposal = {
  action: typeof HITL_ACTION_PATCH_TRANSCRIPT;
  transcriptId: string;
  transcriptTitle: string;
  expectedRevision: number;
  expectedSourceVersion: number;
  expectedSourceChecksum: string | null;
  expectedBaseChecksum: string;
  operation: TranscriptPatchOperation;
  changeSummary: string;
};

export type ChatTranscriptPatchApprovalPayload = ChatTranscriptPatchProposal & {
  patchPreview: ChatTranscriptPatchApprovalPreview;
  previewProof: string;
};

const approvalPreviewSchema = z.object({
  operationKind: z.enum(['replace', 'insert_before', 'insert_after', 'prepend', 'append']),
  occurrence: z.number().int().min(1).nullable(),
  changeSummary: z.string().min(1).max(300),
  target: z.string().max(501),
  replacement: z.string().max(501),
  line: z.number().int().min(1),
  context: z.string().max(701),
  resultingChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  truncatedTarget: z.boolean(),
  truncatedReplacement: z.boolean(),
  truncatedContext: z.boolean(),
});

export function chatTranscriptPatchApprovalProof(
  payload: ChatTranscriptPatchProposal,
  canonicalTitle: string,
  resultingChecksum: string,
): string {
  return createHash('sha256')
    .update(payload.transcriptId)
    .update('\0')
    .update(String(payload.expectedRevision))
    .update('\0')
    .update(String(payload.expectedSourceVersion))
    .update('\0')
    .update(payload.expectedSourceChecksum ?? '')
    .update('\0')
    .update(payload.expectedBaseChecksum)
    .update('\0')
    .update(canonicalTitle)
    .update('\0')
    .update(JSON.stringify(payload.operation))
    .update('\0')
    .update(resultingChecksum)
    .digest('hex');
}

export function extractTranscriptPatchProposal(
  output: Record<string, unknown>,
): ChatTranscriptPatchProposal | null {
  if (output.action !== HITL_ACTION_PATCH_TRANSCRIPT) return null;
  const operation = TranscriptPatchOperationSchema.safeParse(output.operation);
  const transcriptId = typeof output.transcriptId === 'string' ? output.transcriptId.trim() : '';
  const transcriptTitle =
    typeof output.transcriptTitle === 'string'
      ? output.transcriptTitle.trim()
      : typeof output.title === 'string'
        ? output.title.trim()
        : '';
  const changeSummary = typeof output.changeSummary === 'string' ? output.changeSummary.trim() : '';
  if (
    !transcriptId ||
    !transcriptTitle ||
    typeof output.expectedRevision !== 'number' ||
    !Number.isInteger(output.expectedRevision) ||
    output.expectedRevision < 0 ||
    typeof output.expectedSourceVersion !== 'number' ||
    !Number.isInteger(output.expectedSourceVersion) ||
    output.expectedSourceVersion < 0 ||
    !(
      output.expectedSourceChecksum === null || typeof output.expectedSourceChecksum === 'string'
    ) ||
    typeof output.expectedBaseChecksum !== 'string' ||
    !/^[a-f0-9]{64}$/.test(output.expectedBaseChecksum) ||
    !operation.success ||
    !changeSummary
  ) {
    return null;
  }
  return {
    action: HITL_ACTION_PATCH_TRANSCRIPT,
    transcriptId,
    transcriptTitle,
    expectedRevision: output.expectedRevision,
    expectedSourceVersion: output.expectedSourceVersion,
    expectedSourceChecksum: output.expectedSourceChecksum,
    expectedBaseChecksum: output.expectedBaseChecksum,
    operation: operation.data as TranscriptPatchOperation,
    changeSummary,
  };
}

export function extractTranscriptApprovalPayload(
  output: Record<string, unknown>,
): ChatTranscriptPatchApprovalPayload | null {
  const proposal = extractTranscriptPatchProposal(output);
  if (!proposal) return null;
  const patchPreview = approvalPreviewSchema.safeParse(output.patchPreview);
  const previewProof =
    typeof output.previewProof === 'string' && /^[a-f0-9]{64}$/.test(output.previewProof)
      ? output.previewProof
      : '';
  return patchPreview.success && previewProof
    ? { ...proposal, patchPreview: patchPreview.data, previewProof }
    : null;
}

export async function prepareChatTranscriptPatchApproval(
  userId: string,
  payload: ChatTranscriptPatchProposal,
): Promise<{
  payload: ChatTranscriptPatchApprovalPayload;
  preview: ChatTranscriptPatchApprovalPreview;
  head: TranscriptCorrectionHead;
}> {
  const head = await loadTranscriptCorrectionHead(userId, payload.transcriptId);
  assertProposalHead(payload, head);
  const patched = applyTranscriptPatch(head.markdown, payload.operation);
  const plainText = transcriptMarkdownToPlainText(patched.content);
  const resultingChecksum = transcriptCorrectionChecksum(patched.content, plainText);
  const target = 'target' in payload.operation ? payload.operation.target : '';
  const contextRadius = 180;
  const context = patched.content.slice(
    Math.max(0, patched.start - contextRadius),
    Math.min(patched.content.length, patched.start + patched.after.length + contextRadius),
  );
  const canonicalPayload = { ...payload, transcriptTitle: head.title };
  const preview: ChatTranscriptPatchApprovalPreview = {
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
  return {
    head,
    preview,
    payload: {
      ...canonicalPayload,
      patchPreview: preview,
      previewProof: chatTranscriptPatchApprovalProof(
        canonicalPayload,
        head.title,
        resultingChecksum,
      ),
    },
  };
}

export function createSearchTranscriptContentTool(userId: string) {
  return tool({
    description:
      'Localiza um trecho no Markdown efetivo de uma transcrição antes de uma correção cirúrgica. ' +
      'Retorna a identidade completa da revisão e da fonte que deve acompanhar a proposta.',
    inputSchema: z.object({
      transcriptId: z.string().min(1),
      query: z.string().min(1).max(10_000),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    execute: async ({ transcriptId, query, limit }) => {
      const head = await loadTranscriptCorrectionHead(userId, transcriptId);
      return {
        id: head.id,
        title: head.title,
        correctionRevision: head.correctionRevision,
        sourceVersion: head.sourceVersion,
        sourceChecksum: head.sourceChecksum,
        checksum: head.checksum,
        corrected: head.corrected,
        matches: searchWithinTranscript(head.markdown, query, {
          limit: limit ?? 12,
          contextChars: 180,
        }),
      };
    },
  });
}

export function createProposePatchTranscriptTool() {
  return tool({
    description:
      'Propõe uma correção exata na camada versionada de uma transcrição. Sempre exige confirmação ' +
      'humana e preserva a fonte original.',
    inputSchema: z.object({
      transcriptId: z.string().min(1),
      transcriptTitle: z.string().min(1).max(500),
      expectedRevision: z.number().int().min(0),
      expectedSourceVersion: z.number().int().min(0),
      expectedSourceChecksum: z.string().max(256).nullable(),
      expectedBaseChecksum: z.string().regex(/^[a-f0-9]{64}$/),
      operation: TranscriptPatchOperationSchema,
      changeSummary: z.string().min(1).max(300),
    }),
    execute: async ({ transcriptTitle, changeSummary }) => ({
      handledBy: 'ui_approve',
      title: transcriptTitle,
      changeSummary,
    }),
  });
}

export async function applyApprovedTranscriptMutation(
  tx: Prisma.TransactionClient,
  userId: string,
  payload: ChatTranscriptPatchApprovalPayload,
  preparedHead: TranscriptCorrectionHead,
): Promise<{
  resource: { id: string; title: string };
  outcomeMessage: string;
  systemMessage: string;
}> {
  assertProposalHead(payload, preparedHead);
  const patched = applyTranscriptPatch(preparedHead.markdown, payload.operation);
  const plainText = transcriptMarkdownToPlainText(patched.content);
  const resultingChecksum = transcriptCorrectionChecksum(patched.content, plainText);
  const expectedProof = chatTranscriptPatchApprovalProof(
    payload,
    preparedHead.title,
    resultingChecksum,
  );
  if (
    payload.previewProof !== expectedProof ||
    payload.patchPreview.resultingChecksum !== resultingChecksum
  ) {
    throw new ChatApprovalMutationError(
      'INVALID_PREVIEW',
      'A prévia validada desta correção não corresponde mais à proposta.',
    );
  }
  await commitTranscriptCorrectionInTransaction(tx, {
    userId,
    transcriptId: payload.transcriptId,
    expectedRevision: payload.expectedRevision,
    expectedSourceVersion: payload.expectedSourceVersion,
    expectedSourceChecksum: payload.expectedSourceChecksum,
    expectedBaseChecksum: payload.expectedBaseChecksum,
    expectedResultChecksum: resultingChecksum,
    baseMarkdown: preparedHead.markdown,
    operation: payload.operation,
    actor: 'CHAT',
    changeSummary: `${summarizeNotePatch(payload.operation)}: ${payload.changeSummary}`,
  });
  return {
    resource: { id: payload.transcriptId, title: preparedHead.title },
    outcomeMessage: `Transcrição “${preparedHead.title}” corrigida.`,
    systemMessage: `Transcrição “${preparedHead.title}” corrigida em nova revisão após confirmação do usuário.`,
  };
}

function assertProposalHead(
  payload: ChatTranscriptPatchProposal,
  head: TranscriptCorrectionHead,
): void {
  if (
    payload.expectedRevision !== head.correctionRevision ||
    payload.expectedSourceVersion !== head.sourceVersion ||
    payload.expectedSourceChecksum !== head.sourceChecksum ||
    payload.expectedBaseChecksum !== head.checksum
  ) {
    throw new TranscriptCorrectionConflictError({
      currentRevision: head.correctionRevision,
      currentChecksum: head.checksum,
      sourceVersion: head.sourceVersion,
      sourceChecksum: head.sourceChecksum,
    });
  }
}

export function normalizeTranscriptApprovalError(error: unknown): ChatApprovalMutationError | null {
  if (error instanceof TranscriptCorrectionConflictError) {
    return new ChatApprovalMutationError(
      'REVISION_CONFLICT',
      'A transcrição mudou desde a proposta. Releia o conteúdo antes de tentar novamente.',
      { currentRevision: error.currentRevision, currentChecksum: error.currentChecksum },
    );
  }
  if (error instanceof TranscriptCorrectionNotFoundError) {
    return new ChatApprovalMutationError('NOT_FOUND', 'Transcrição não encontrada.');
  }
  if (error instanceof TranscriptCorrectionPreviewMismatchError) {
    return new ChatApprovalMutationError('INVALID_PREVIEW', error.message);
  }
  return null;
}
