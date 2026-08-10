import type { Prisma } from '../../prisma-generated/client';
import { db } from './db';
import { notifyNewJob, publishJobEvent } from './job-events';

export const KNOWLEDGE_DELETION_TARGETS = [
  'TRANSCRIPT',
  'NOTE',
  'SAVED_MEDIA',
  'LIBRARY_FOLDER',
  'TRANSCRIPT_ENRICHMENT',
] as const;

export type KnowledgeDeletionTargetType = (typeof KNOWLEDGE_DELETION_TARGETS)[number];

type DbClient = Prisma.TransactionClient;

export type KnowledgeDeletionTarget = {
  type: KnowledgeDeletionTargetType;
  id: string;
  title: string;
  kind?: 'NOTE' | 'FOLDER';
};

export type KnowledgeDeletionJob = {
  id: string;
  status: string;
  sourceUrl: string;
  deletionTargetType: KnowledgeDeletionTargetType;
  deletionTargetId: string;
  deletionTargetTitle: string;
};

export class KnowledgeDeletionNotFoundError extends Error {}
export class KnowledgeDeletionConflictError extends Error {}

async function resolveTarget(
  tx: DbClient,
  userId: string,
  type: KnowledgeDeletionTargetType,
  id: string,
  options: { allowAllLibraryFolders?: boolean } = {},
): Promise<KnowledgeDeletionTarget | null> {
  if (type === 'TRANSCRIPT') {
    const item = await tx.transcript.findFirst({
      where: { id, userId },
      select: { id: true, title: true },
    });
    return item ? { type, id: item.id, title: item.title } : null;
  }
  if (type === 'NOTE') {
    const item = await tx.note.findFirst({
      where: { id, userId },
      select: { id: true, title: true, kind: true },
    });
    return item ? { type, id: item.id, title: item.title, kind: item.kind } : null;
  }
  if (type === 'SAVED_MEDIA') {
    const item = await tx.savedMedia.findFirst({
      where: { id, userId },
      select: { id: true, title: true, sourceUrl: true, status: true, transcriptId: true },
    });
    if (!item) return null;
    if (
      item.transcriptId ||
      item.status === 'PROCESSED' ||
      ['QUEUED', 'DOWNLOADING', 'PROCESSING'].includes(item.status)
    ) {
      throw new KnowledgeDeletionConflictError(
        'Aguarde ou cancele o processamento antes de apagar esta mídia.',
      );
    }
    return { type, id: item.id, title: item.title?.trim() || item.sourceUrl };
  }
  if (type === 'LIBRARY_FOLDER') {
    if (id === '*' && options.allowAllLibraryFolders) {
      const count = await tx.libraryFolder.count({ where: { userId } });
      return count > 0 ? { type, id, title: 'All library folders' } : null;
    }
    const item = await tx.libraryFolder.findFirst({
      where: { id, userId },
      select: { id: true, name: true },
    });
    return item ? { type, id: item.id, title: item.name } : null;
  }
  const item = await tx.transcriptEnrichment.findFirst({
    where: { id, userId },
    select: { id: true, title: true, status: true },
  });
  if (item && ['PENDING', 'RUNNING', 'RETRY'].includes(item.status)) {
    throw new KnowledgeDeletionConflictError(
      'Cancele a pesquisa em andamento antes de excluir este contexto adicional.',
    );
  }
  return item ? { type, id: item.id, title: item.title } : null;
}

export async function resolveKnowledgeDeletionTarget(
  userId: string,
  type: KnowledgeDeletionTargetType,
  id: string,
): Promise<KnowledgeDeletionTarget | null> {
  return db.$transaction((tx) => resolveTarget(tx, userId, type, id));
}

export async function enqueueKnowledgeDeletionInTransaction(
  tx: DbClient,
  args: {
    userId: string;
    type: KnowledgeDeletionTargetType;
    id: string;
    expectedTitle?: string;
    requireTranscriptTrash?: boolean;
    allowAllLibraryFolders?: boolean;
  },
): Promise<{ job: KnowledgeDeletionJob; target: KnowledgeDeletionTarget; created: boolean }> {
  const lockKey = `voxen:delete:${args.userId}:${args.type}:${args.id}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

  const active = await tx.job.findFirst({
    where: {
      userId: args.userId,
      type: 'DELETE_KNOWLEDGE',
      deletionTargetType: args.type,
      deletionTargetId: args.id,
      status: { in: ['QUEUED', 'RUNNING'] },
    },
    orderBy: { queuedAt: 'desc' },
    select: {
      id: true,
      status: true,
      sourceUrl: true,
      deletionTargetType: true,
      deletionTargetId: true,
      deletionTargetTitle: true,
    },
  });
  if (active?.deletionTargetType && active.deletionTargetId && active.deletionTargetTitle) {
    if (args.expectedTitle !== undefined && args.expectedTitle !== active.deletionTargetTitle) {
      throw new KnowledgeDeletionConflictError(
        'O título atual não corresponde à confirmação. Leia o conteúdo novamente antes de apagar.',
      );
    }
    return {
      job: active as KnowledgeDeletionJob,
      target: {
        type: active.deletionTargetType as KnowledgeDeletionTargetType,
        id: active.deletionTargetId,
        title: active.deletionTargetTitle,
      },
      created: false,
    };
  }

  const target = await resolveTarget(tx, args.userId, args.type, args.id, {
    allowAllLibraryFolders: args.allowAllLibraryFolders,
  });
  if (!target) throw new KnowledgeDeletionNotFoundError('Conteúdo não encontrado.');
  if (args.expectedTitle !== undefined && args.expectedTitle !== target.title) {
    throw new KnowledgeDeletionConflictError(
      'O título atual não corresponde à confirmação. Leia o conteúdo novamente antes de apagar.',
    );
  }
  if (args.requireTranscriptTrash && args.type === 'TRANSCRIPT') {
    const trashed = await tx.transcript.findFirst({
      where: { id: args.id, userId: args.userId, status: 'TRASH' },
      select: { id: true },
    });
    if (!trashed) {
      throw new KnowledgeDeletionConflictError(
        'Mova para a lixeira antes de apagar definitivamente.',
      );
    }
  }

  const now = new Date();
  if (args.type === 'TRANSCRIPT') {
    await tx.transcript.updateMany({
      where: { id: args.id, userId: args.userId },
      data: { status: 'TRASH', archivedAt: null, trashedAt: now },
    });
  } else if (args.type === 'SAVED_MEDIA') {
    const updated = await tx.savedMedia.updateMany({
      where: { id: args.id, userId: args.userId },
      data: { status: 'DELETING', errorMsg: null },
    });
    if (updated.count !== 1) {
      throw new KnowledgeDeletionConflictError('A mídia não está mais disponível para exclusão.');
    }
  }

  const sourceUrl = `voxen://delete/${args.type.toLowerCase()}/${encodeURIComponent(args.id)}`;
  const job = await tx.job.create({
    data: {
      userId: args.userId,
      type: 'DELETE_KNOWLEDGE',
      status: 'QUEUED',
      sourceUrl,
      deletionTargetType: args.type,
      deletionTargetId: args.id,
      deletionTargetTitle: target.title,
      progressStage: 'queued',
      progressPercent: 0,
      progressedAt: now,
    },
    select: {
      id: true,
      status: true,
      sourceUrl: true,
      deletionTargetType: true,
      deletionTargetId: true,
      deletionTargetTitle: true,
    },
  });
  return { job: job as KnowledgeDeletionJob, target, created: true };
}

export async function enqueueKnowledgeDeletion(args: {
  userId: string;
  type: KnowledgeDeletionTargetType;
  id: string;
  expectedTitle?: string;
  requireTranscriptTrash?: boolean;
  allowAllLibraryFolders?: boolean;
}): Promise<{ job: KnowledgeDeletionJob; target: KnowledgeDeletionTarget; created: boolean }> {
  const result = await db.$transaction((tx) => enqueueKnowledgeDeletionInTransaction(tx, args));
  if (result.created) await publishKnowledgeDeletionJob(args.userId, result.job.id);
  return result;
}

export async function publishKnowledgeDeletionJob(userId: string, jobId: string): Promise<void> {
  await Promise.allSettled([
    notifyNewJob(jobId),
    publishJobEvent(userId, { jobId, stage: 'queued', percent: 0 }),
  ]);
}

export function knowledgeDeletionHttpError(error: unknown): Response | null {
  if (error instanceof KnowledgeDeletionNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof KnowledgeDeletionConflictError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  return null;
}
