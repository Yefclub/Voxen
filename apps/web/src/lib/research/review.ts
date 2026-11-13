import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Prisma, TranscriptEnrichment } from '../../../prisma-generated/client';
import { db } from '../db';
import { invalidateGraphCache } from '../graph-cache';
import {
  enqueueKnowledgeDeletionInTransaction,
  publishKnowledgeDeletionJob,
} from '../knowledge-deletion';
import {
  normalizeTranscriptEnrichmentCitations,
  refreshTranscriptEnrichmentFreshness,
} from '../transcript-enrichments';
import { ACTIVE_RESEARCH_STATUSES, lockResearchUser, readResearchPreferences } from './preferences';
import { RESEARCH_SOURCE_SELECT, ResearchError } from './queue';

const Guard = z.object({
  expectedRevision: z.number().int().positive(),
  expectedChecksum: z.string().regex(/^[a-f0-9]{64}$/),
});
export const ResearchReviewSchema = z.discriminatedUnion('action', [
  Guard.extend({ action: z.enum(['accept', 'dismiss', 'cancel', 'delete']) }).strict(),
  Guard.extend({
    action: z.literal('edit'),
    title: z.string().trim().min(1).max(300),
    content: z.string().trim().min(1).max(200_000),
  }).strict(),
]);
export type ResearchReview = z.infer<typeof ResearchReviewSchema>;

function checksum(row: TranscriptEnrichment) {
  return createHash('sha256')
    .update(JSON.stringify([row.id, row.revision, row.title, row.content, row.citations]))
    .digest('hex');
}
function serialize(row: TranscriptEnrichment, deletionPending = false) {
  const settings = row.generationSettings as Record<string, unknown>;
  return {
    id: row.id,
    revision: row.revision,
    checksum: checksum(row),
    deletionPending,
    projection: {
      state:
        row.brainProjectionPending ||
        (row.reviewState === 'ACCEPTED' && row.brainProjectedRevision !== row.revision)
          ? ('PENDING' as const)
          : ('SYNCED' as const),
      revision: row.revision,
      appliedRevision: row.brainProjectedRevision,
      errorCode: row.brainProjectionErrorCode,
    },
    status: row.status,
    reviewState: row.reviewState,
    trigger: row.trigger,
    title: row.title,
    content: row.content,
    citations: normalizeTranscriptEnrichmentCitations(row.citations),
    queries: Array.isArray(row.queries)
      ? row.queries.filter((q): q is string => typeof q === 'string')
      : [],
    rationale: row.rationale,
    noResearchReason: row.noResearchReason,
    model: row.model,
    staleReason: row.staleReason,
    lastError: row.lastError && /^[A-Z_]{1,100}$/.test(row.lastError) ? row.lastError : null,
    costUsd: row.costUsd === null ? null : Number(row.costUsd),
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    searchCallCount: row.searchCallCount,
    fetchCallCount: typeof settings.fetchCalls === 'number' ? settings.fetchCalls : 0,
    warnings: Array.isArray(settings.warnings)
      ? settings.warnings.filter((w): w is string => typeof w === 'string' && /^[A-Z_]+$/.test(w))
      : [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    generatedAt: row.generatedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

async function lockParent(tx: Prisma.TransactionClient, userId: string, transcriptId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT source.id FROM "Transcript" source JOIN "User" owner ON owner.id = source."userId"
    WHERE source.id = ${transcriptId} AND source."userId" = ${userId}
      AND source.status IN ('ACTIVE', 'ARCHIVED') AND owner.status = 'APPROVED'
    FOR UPDATE OF source
  `;
  if (!rows.length) throw new ResearchError('NOT_FOUND');
  const source = await tx.transcript.findFirstOrThrow({
    where: { id: transcriptId, userId },
    select: RESEARCH_SOURCE_SELECT,
  });
  await refreshTranscriptEnrichmentFreshness(
    {
      userId,
      transcriptId,
      sourceVersion: source.sourceVersion,
      sourceChecksum: source.sourceChecksum,
    },
    tx,
  );
}
function deletionWhere(userId: string, ids: string[]): Prisma.JobWhereInput {
  return {
    userId,
    type: 'DELETE_KNOWLEDGE' as const,
    deletionTargetType: 'TRANSCRIPT_ENRICHMENT',
    deletionTargetId: { in: ids },
    status: { in: ['QUEUED', 'RUNNING'] },
  };
}

export async function listResearch(userId: string, transcriptId: string, cursor?: string) {
  return db.$transaction(async (tx) => {
    await lockResearchUser(tx, userId);
    await lockParent(tx, userId, transcriptId);
    const boundary = cursor
      ? await tx.transcriptEnrichment.findFirst({
          where: { id: cursor, userId, transcriptId },
          select: { id: true, createdAt: true },
        })
      : null;
    if (cursor && !boundary) throw new ResearchError('NOT_FOUND');
    const rows = await tx.transcriptEnrichment.findMany({
      where: {
        userId,
        transcriptId,
        ...(boundary
          ? {
              OR: [
                { createdAt: { lt: boundary.createdAt } },
                { createdAt: boundary.createdAt, id: { lt: boundary.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 11,
    });
    const page = rows.slice(0, 10);
    const jobs = await tx.job.findMany({
      where: deletionWhere(
        userId,
        page.map((row) => row.id),
      ),
      select: { deletionTargetId: true },
    });
    const deleting = new Set(jobs.map((job) => job.deletionTargetId));
    return {
      enrichments: page.map((row) => serialize(row, deleting.has(row.id))),
      researchMode: (await readResearchPreferences(tx, userId)).mode,
      nextCursor: rows.length > 10 ? page.at(-1)!.id : null,
    };
  });
}

export async function readResearch(userId: string, transcriptId: string, id: string) {
  return db.$transaction(async (tx) => {
    await lockResearchUser(tx, userId);
    await lockParent(tx, userId, transcriptId);
    const row = await tx.transcriptEnrichment.findFirst({ where: { id, userId, transcriptId } });
    if (!row) throw new ResearchError('NOT_FOUND');
    return serialize(row, (await tx.job.count({ where: deletionWhere(userId, [id]) })) > 0);
  });
}

export async function reviewResearch(
  userId: string,
  transcriptId: string,
  id: string,
  input: ResearchReview,
) {
  const body = ResearchReviewSchema.parse(input);
  const result = await db.$transaction(async (tx) => {
    await lockResearchUser(tx, userId);
    await lockParent(tx, userId, transcriptId);
    const locked = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "TranscriptEnrichment" WHERE id = ${id} AND "userId" = ${userId} AND "transcriptId" = ${transcriptId} FOR UPDATE`;
    if (!locked.length) throw new ResearchError('NOT_FOUND');
    const row = await tx.transcriptEnrichment.findFirstOrThrow({
      where: { id, userId, transcriptId },
    });
    if (row.revision !== body.expectedRevision || checksum(row) !== body.expectedChecksum)
      throw new ResearchError('REVISION_CONFLICT');
    if (await tx.job.count({ where: deletionWhere(userId, [id]) }))
      throw new ResearchError('DELETION_PENDING');
    const data: Prisma.TranscriptEnrichmentUpdateInput = {
      revision: { increment: 1 },
      brainProjectionPending: true,
      brainProjectionNextAttemptAt: null,
      brainProjectionErrorCode: null,
    };
    let jobId: string | null = null;
    if (body.action === 'cancel') {
      if (!ACTIVE_RESEARCH_STATUSES.some((status) => status === row.status))
        throw new ResearchError('ALREADY_FINISHED');
      Object.assign(data, {
        status: 'CANCELLED',
        cancelRequestedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
      });
    } else if (body.action === 'delete') {
      if (ACTIVE_RESEARCH_STATUSES.some((status) => status === row.status))
        throw new ResearchError('RESEARCH_ACTIVE');
      const deletion = await enqueueKnowledgeDeletionInTransaction(tx, {
        userId,
        type: 'TRANSCRIPT_ENRICHMENT',
        id,
        expectedTitle: row.title,
      });
      jobId = deletion.job.id;
      Object.assign(data, { reviewState: 'DISMISSED', dismissedAt: new Date() });
    } else {
      if (row.status !== 'READY') throw new ResearchError('RESULT_NOT_READY');
      if (body.action === 'accept') {
        if (row.staleReason) throw new ResearchError('STALE_RESULT');
        if (!row.content.trim() || !normalizeTranscriptEnrichmentCitations(row.citations).length)
          throw new ResearchError('UNGROUNDED_RESULT');
        await tx.transcriptEnrichment.updateMany({
          where: { userId, transcriptId, id: { not: id }, reviewState: 'ACCEPTED' },
          data: {
            reviewState: 'DISMISSED',
            dismissedAt: new Date(),
            revision: { increment: 1 },
            brainProjectionPending: true,
            brainProjectionNextAttemptAt: null,
          },
        });
        Object.assign(data, { reviewState: 'ACCEPTED', acceptedAt: new Date(), dismissedAt: null });
      } else if (body.action === 'dismiss') {
        Object.assign(data, { reviewState: 'DISMISSED', dismissedAt: new Date() });
      } else if (body.action === 'edit') {
        Object.assign(data, {
          title: body.title,
          content: body.content,
          editedAt: new Date(),
          reviewState: 'SUGGESTED',
          acceptedAt: null,
          dismissedAt: null,
        });
      }
    }
    const updated = await tx.transcriptEnrichment.update({ where: { id, userId }, data });
    return { view: serialize(updated, Boolean(jobId)), jobId };
  });
  await invalidateGraphCache(userId);
  if (result.jobId) await publishKnowledgeDeletionJob(userId, result.jobId);
  return result.view;
}
