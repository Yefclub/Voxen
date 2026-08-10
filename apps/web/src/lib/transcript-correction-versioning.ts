import {
  Prisma,
  type TranscriptCorrectionActor,
  type TranscriptCorrectionState,
} from '../../prisma-generated/client';
import { reindexTranscriptBrain } from './brain';
import { runWithBrainIndexLease } from './brain-index-lease';
import { db } from './db';
import { invalidateGraphCache } from './graph-cache';
import { storageReadText } from './storage';
import {
  applyTranscriptPatch,
  effectiveTranscriptContent,
  transcriptCorrectionChecksum,
  transcriptMarkdownToPlainText,
  type TranscriptPatchOperation,
} from './transcript-corrections';

export class TranscriptCorrectionNotFoundError extends Error {
  constructor() {
    super('Transcript not found.');
    this.name = 'TranscriptCorrectionNotFoundError';
  }
}

export class TranscriptCorrectionConflictError extends Error {
  readonly currentRevision: number;
  readonly currentChecksum: string;
  readonly sourceVersion: number;
  readonly sourceChecksum: string | null;
  constructor(input: {
    currentRevision: number;
    currentChecksum: string;
    sourceVersion: number;
    sourceChecksum: string | null;
  }) {
    super(
      `Expected transcript correction revision is stale; current revision is ${input.currentRevision}.`,
    );
    this.name = 'TranscriptCorrectionConflictError';
    this.currentRevision = input.currentRevision;
    this.currentChecksum = input.currentChecksum;
    this.sourceVersion = input.sourceVersion;
    this.sourceChecksum = input.sourceChecksum;
  }
}

export class TranscriptCorrectionPreviewMismatchError extends Error {
  constructor() {
    super('Correction preview no longer matches the requested result.');
    this.name = 'TranscriptCorrectionPreviewMismatchError';
  }
}

export type TranscriptCorrectionHead = {
  id: string;
  title: string;
  sourceVersion: number;
  sourceChecksum: string | null;
  correctionRevision: number;
  correctionState: TranscriptCorrectionState;
  correctionStaleReason: string | null;
  markdown: string;
  plainText: string;
  checksum: string;
  corrected: boolean;
};

export async function loadTranscriptCorrectionHead(
  userId: string,
  transcriptId: string,
): Promise<TranscriptCorrectionHead> {
  const transcript = await db.transcript.findFirst({
    where: { id: transcriptId, userId, status: { not: 'TRASH' } },
    select: {
      id: true,
      title: true,
      mdPath: true,
      plainText: true,
      sourceVersion: true,
      sourceChecksum: true,
      correctionRevision: true,
      correctionState: true,
      correctionStaleReason: true,
      correctedMarkdown: true,
      correctedPlainText: true,
      correctedChecksum: true,
    },
  });
  if (!transcript) throw new TranscriptCorrectionNotFoundError();
  const effective = effectiveTranscriptContent(transcript);
  const markdown = effective.markdown ?? (await storageReadText(transcript.mdPath));
  const plainText = effective.corrected
    ? effective.plainText
    : transcriptMarkdownToPlainText(markdown);
  return {
    id: transcript.id,
    title: transcript.title,
    sourceVersion: transcript.sourceVersion,
    sourceChecksum: transcript.sourceChecksum,
    correctionRevision: transcript.correctionRevision,
    correctionState: transcript.correctionState,
    correctionStaleReason: transcript.correctionStaleReason,
    markdown,
    plainText,
    checksum:
      effective.corrected && transcript.correctedChecksum
        ? transcript.correctedChecksum
        : transcriptCorrectionChecksum(markdown, plainText),
    corrected: effective.corrected,
  };
}

export type CommitTranscriptCorrectionInput = {
  userId: string;
  transcriptId: string;
  expectedRevision: number;
  expectedSourceVersion: number;
  expectedSourceChecksum: string | null;
  expectedBaseChecksum: string;
  expectedResultChecksum: string;
  baseMarkdown: string;
  operation: TranscriptPatchOperation | null;
  replacementMarkdown?: string;
  allowUnchangedReplacement?: boolean;
  operationMetadata?: Prisma.InputJsonValue;
  actor: TranscriptCorrectionActor;
  changeSummary: string;
};

export type CommittedTranscriptCorrection = {
  transcriptId: string;
  revision: number;
  sourceVersion: number;
  sourceChecksum: string | null;
  state: TranscriptCorrectionState;
  markdown: string;
  plainText: string;
  checksum: string;
};

export async function commitTranscriptCorrection(
  input: CommitTranscriptCorrectionInput,
): Promise<CommittedTranscriptCorrection> {
  return db.$transaction((tx) => commitTranscriptCorrectionInTransaction(tx, input));
}

export async function commitTranscriptCorrectionInTransaction(
  tx: Prisma.TransactionClient,
  input: CommitTranscriptCorrectionInput,
): Promise<CommittedTranscriptCorrection> {
  const current = await tx.transcript.findFirst({
    where: { id: input.transcriptId, userId: input.userId, status: { not: 'TRASH' } },
    select: {
      id: true,
      sourceVersion: true,
      sourceChecksum: true,
      correctionRevision: true,
      correctionState: true,
      correctedMarkdown: true,
      correctedPlainText: true,
      correctedChecksum: true,
    },
  });
  if (!current) throw new TranscriptCorrectionNotFoundError();
  const activeCorrection =
    current.correctionState === 'ACTIVE' &&
    current.correctedMarkdown !== null &&
    current.correctedPlainText !== null;
  const baseMarkdown = activeCorrection ? current.correctedMarkdown! : input.baseMarkdown;
  const basePlainText = activeCorrection
    ? current.correctedPlainText!
    : transcriptMarkdownToPlainText(baseMarkdown);
  const currentChecksum = activeCorrection
    ? (current.correctedChecksum ?? transcriptCorrectionChecksum(baseMarkdown, basePlainText))
    : transcriptCorrectionChecksum(baseMarkdown, basePlainText);
  if (
    current.correctionRevision !== input.expectedRevision ||
    current.sourceVersion !== input.expectedSourceVersion ||
    current.sourceChecksum !== input.expectedSourceChecksum ||
    currentChecksum !== input.expectedBaseChecksum
  ) {
    throw new TranscriptCorrectionConflictError({
      currentRevision: current.correctionRevision,
      currentChecksum,
      sourceVersion: current.sourceVersion,
      sourceChecksum: current.sourceChecksum,
    });
  }
  const markdown =
    input.replacementMarkdown ??
    (input.operation ? applyTranscriptPatch(baseMarkdown, input.operation).content : null);
  if (markdown === null || (markdown === baseMarkdown && !input.allowUnchangedReplacement))
    throw new TranscriptCorrectionPreviewMismatchError();
  const plainText = transcriptMarkdownToPlainText(markdown);
  const checksum = transcriptCorrectionChecksum(markdown, plainText);
  if (checksum !== input.expectedResultChecksum)
    throw new TranscriptCorrectionPreviewMismatchError();
  const revision = current.correctionRevision + 1;
  const claimed = await tx.transcript.updateMany({
    where: {
      id: current.id,
      userId: input.userId,
      correctionRevision: input.expectedRevision,
      sourceVersion: input.expectedSourceVersion,
      sourceChecksum: input.expectedSourceChecksum,
    },
    data: {
      correctionRevision: { increment: 1 },
      correctedMarkdown: markdown,
      correctedPlainText: plainText,
      correctedChecksum: checksum,
      correctionSourceVersion: current.sourceVersion,
      correctionSourceChecksum: current.sourceChecksum,
      correctionState: 'ACTIVE',
      correctionStaleReason: null,
      summaryMd: null,
      flowchartMd: null,
      summaryStatus: 'PENDING',
      summaryAttempts: 0,
      summaryStartedAt: null,
      summaryNextAttemptAt: null,
      summaryError: null,
      taggingStatus: 'PENDING',
      taggingAttempts: 0,
      taggingStartedAt: null,
      taggingNextAttemptAt: null,
      taggingError: null,
    },
  });
  if (claimed.count !== 1) {
    const head = await tx.transcript.findFirst({
      where: { id: current.id, userId: input.userId },
      select: {
        correctionRevision: true,
        correctedChecksum: true,
        sourceVersion: true,
        sourceChecksum: true,
      },
    });
    if (!head) throw new TranscriptCorrectionNotFoundError();
    throw new TranscriptCorrectionConflictError({
      currentRevision: head.correctionRevision,
      currentChecksum: head.correctedChecksum ?? '',
      sourceVersion: head.sourceVersion,
      sourceChecksum: head.sourceChecksum,
    });
  }
  await tx.transcriptCorrectionRevision.create({
    data: {
      userId: input.userId,
      transcriptId: current.id,
      revision,
      sourceVersion: current.sourceVersion,
      sourceChecksum: current.sourceChecksum,
      markdown,
      plainText,
      checksum,
      actor: input.actor,
      operation:
        input.operationMetadata ??
        (input.operation ? (input.operation as Prisma.InputJsonValue) : Prisma.JsonNull),
      changeSummary: input.changeSummary.trim().slice(0, 500) || null,
    },
  });
  await deferGroundedCompilation(tx, input.userId, current.id);
  return {
    transcriptId: current.id,
    revision,
    sourceVersion: current.sourceVersion,
    sourceChecksum: current.sourceChecksum,
    state: 'ACTIVE',
    markdown,
    plainText,
    checksum,
  };
}

export type CommitTranscriptCorrectionSnapshotInput = Omit<
  CommitTranscriptCorrectionInput,
  'operation' | 'replacementMarkdown' | 'operationMetadata'
> & { replacementMarkdown: string; operationMetadata: Prisma.InputJsonValue };
export async function commitTranscriptCorrectionSnapshot(
  input: CommitTranscriptCorrectionSnapshotInput,
): Promise<CommittedTranscriptCorrection> {
  return commitTranscriptCorrection({ ...input, operation: null });
}

async function deferGroundedCompilation(
  tx: Prisma.TransactionClient,
  userId: string,
  transcriptId: string,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "BrainCompilationSegment" segment
    SET status = 'PENDING'::"BrainCompilationStatus", attempts = 0,
        "claimedBy" = NULL, "claimedAt" = NULL, "leaseExpiresAt" = NULL,
        "nextAttemptAt" = NULL, error = NULL, "updatedAt" = NOW()
    FROM "BrainCompilation" compilation
    WHERE segment."compilationId" = compilation.id
      AND compilation."userId" = ${userId}
      AND compilation."transcriptId" = ${transcriptId}
  `;
  await tx.brainCompilation.updateMany({
    where: { userId, transcriptId },
    data: { status: 'PENDING', lastError: null },
  });
}

export type TranscriptCorrectionGraphSyncState = 'READY' | 'PENDING';
export async function syncTranscriptCorrectionGraph(
  userId: string,
  transcriptId: string,
): Promise<TranscriptCorrectionGraphSyncState> {
  let ready = false;
  try {
    ready = await runWithBrainIndexLease(userId, async (guard) => {
      await reindexTranscriptBrain(userId, transcriptId, { assertLeaseOwnership: guard });
    });
  } catch (error) {
    console.warn('[transcripts] correction graph refresh deferred', {
      userId,
      transcriptId,
      reason: error instanceof Error ? error.name : 'unknown',
    });
  }
  await invalidateGraphCache(userId).catch(() => undefined);
  return ready ? 'READY' : 'PENDING';
}
