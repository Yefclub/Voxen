import { db } from './db';

export type QueuedJobType =
  | 'DOWNLOAD_MEDIA'
  | 'DOWNLOAD_AND_TRANSCRIBE'
  | 'SCRAPE_WEB'
  | 'UPLOAD_AND_TRANSCRIBE'
  | 'UPLOAD_AND_ANALYZE_IMAGE'
  | 'UPLOAD_AND_ANALYZE_DOCUMENT'
  | 'ANALYZE_X';

export async function createQueuedJob(
  userId: string,
  type: QueuedJobType,
  sourceUrl: string,
  options: {
    savedMediaId?: string;
    savedMediaStatus?: 'QUEUED' | 'PROCESSING';
  } = {},
): Promise<{ id: string; status: string; sourceUrl: string }> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('voxen:global-settings'))`;
    const revision = await tx.configRevision.findFirst({
      orderBy: { number: 'desc' },
      select: { id: true },
    });
    const job = await tx.job.create({
      data: {
        userId,
        type,
        status: 'QUEUED',
        sourceUrl,
        configRevisionId: revision?.id,
        savedMediaId: options.savedMediaId,
      },
      select: { id: true, status: true, sourceUrl: true },
    });
    if (options.savedMediaId && options.savedMediaStatus) {
      const updated = await tx.savedMedia.updateMany({
        where: { id: options.savedMediaId, userId, transcriptId: null },
        data: { status: options.savedMediaStatus, errorMsg: null },
      });
      if (updated.count !== 1) {
        throw new Error('Saved media is no longer available for retry.');
      }
    }
    return job;
  });
}

export type RetryQueuedJobResult =
  | { outcome: 'created'; jobId: string; status: string; sourceUrl: string }
  | { outcome: 'inflight'; jobId?: string; status?: string; sourceUrl?: string }
  | { outcome: 'existing_transcript'; transcriptId: string }
  | { outcome: 'missing' }
  | { outcome: 'invalid_state' }
  | { outcome: 'media_unavailable' };

class SavedMediaRetryRace extends Error {}

export async function retryQueuedJobForUser(
  userId: string,
  jobId: string,
): Promise<RetryQueuedJobResult> {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Job" WHERE id = ${jobId} AND "userId" = ${userId} FOR UPDATE`;
      const original = await tx.job.findFirst({
        where: { id: jobId, userId },
        select: {
          id: true,
          status: true,
          sourceUrl: true,
          type: true,
          savedMediaId: true,
          deletionTargetType: true,
          deletionTargetId: true,
          deletionTargetTitle: true,
        },
      });
      if (!original) return { outcome: 'missing' as const };
      if (!['FAILED', 'CANCELLED'].includes(original.status)) {
        return { outcome: 'invalid_state' as const };
      }

      let mediaStatus: 'QUEUED' | 'PROCESSING' | undefined;
      let expectedMediaStatus: 'FAILED' | 'READY' | undefined;
      if (original.savedMediaId) {
        await tx.$queryRaw`SELECT id FROM "SavedMedia" WHERE id = ${original.savedMediaId} AND "userId" = ${userId} FOR UPDATE`;
        const media = await tx.savedMedia.findFirst({
          where: { id: original.savedMediaId, userId },
          select: { status: true, transcriptId: true },
        });
        expectedMediaStatus = original.type === 'DOWNLOAD_MEDIA' ? 'FAILED' : 'READY';
        mediaStatus = original.type === 'DOWNLOAD_MEDIA' ? 'QUEUED' : 'PROCESSING';
        if (
          !media ||
          media.transcriptId ||
          !['DOWNLOAD_MEDIA', 'UPLOAD_AND_TRANSCRIBE'].includes(original.type) ||
          media.status !== expectedMediaStatus
        ) {
          return { outcome: 'media_unavailable' as const };
        }
      } else if (original.type === 'DOWNLOAD_MEDIA') {
        return { outcome: 'media_unavailable' as const };
      }

      let deletionMediaStatus: 'READY' | 'FAILED' | 'DELETING' | undefined;
      if (
        original.type === 'DELETE_KNOWLEDGE' &&
        original.deletionTargetType === 'SAVED_MEDIA' &&
        original.deletionTargetId
      ) {
        await tx.$queryRaw`SELECT id FROM "SavedMedia" WHERE id = ${original.deletionTargetId} AND "userId" = ${userId} FOR UPDATE`;
        const media = await tx.savedMedia.findFirst({
          where: { id: original.deletionTargetId, userId },
          select: { status: true, transcriptId: true },
        });
        if (media) {
          if (media.transcriptId || !['READY', 'FAILED', 'DELETING'].includes(media.status)) {
            return { outcome: 'media_unavailable' as const };
          }
          deletionMediaStatus = media.status as 'READY' | 'FAILED' | 'DELETING';
        }
      }

      if (original.type !== 'DOWNLOAD_MEDIA' && original.type !== 'DELETE_KNOWLEDGE') {
        const existing = await tx.transcript.findFirst({
          where: { userId, url: original.sourceUrl, status: { not: 'TRASH' } },
          select: { id: true },
        });
        if (existing) return { outcome: 'existing_transcript' as const, transcriptId: existing.id };
      }

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('voxen:global-settings'))`;
      const revision = await tx.configRevision.findFirst({
        orderBy: { number: 'desc' },
        select: { id: true },
      });
      const job = await tx.job.create({
        data: {
          userId,
          type: original.type,
          status: 'QUEUED',
          sourceUrl: original.sourceUrl,
          configRevisionId: revision?.id,
          savedMediaId: original.savedMediaId,
          deletionTargetType: original.deletionTargetType,
          deletionTargetId: original.deletionTargetId,
          deletionTargetTitle: original.deletionTargetTitle,
        },
        select: { id: true, status: true, sourceUrl: true },
      });
      if (original.savedMediaId && mediaStatus && expectedMediaStatus) {
        const updated = await tx.savedMedia.updateMany({
          where: {
            id: original.savedMediaId,
            userId,
            transcriptId: null,
            status: expectedMediaStatus,
          },
          data: { status: mediaStatus, errorMsg: null },
        });
        if (updated.count !== 1) throw new SavedMediaRetryRace();
      }
      if (
        original.type === 'DELETE_KNOWLEDGE' &&
        original.deletionTargetType === 'SAVED_MEDIA' &&
        original.deletionTargetId &&
        deletionMediaStatus
      ) {
        const updated = await tx.savedMedia.updateMany({
          where: {
            id: original.deletionTargetId,
            userId,
            transcriptId: null,
            status: deletionMediaStatus,
          },
          data: { status: 'DELETING', errorMsg: null },
        });
        if (updated.count !== 1) throw new SavedMediaRetryRace();
      }
      return {
        outcome: 'created' as const,
        jobId: job.id,
        status: job.status,
        sourceUrl: job.sourceUrl,
      };
    });
  } catch (error) {
    if (error instanceof SavedMediaRetryRace) return { outcome: 'media_unavailable' };
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code: unknown }).code === 'P2002'
    ) {
      const original = await db.job.findFirst({
        where: { id: jobId, userId },
        select: {
          sourceUrl: true,
          type: true,
          savedMediaId: true,
          deletionTargetType: true,
          deletionTargetId: true,
        },
      });
      if (!original) return { outcome: 'inflight' };
      const active = await db.job.findFirst({
        where: {
          userId,
          sourceUrl: original.sourceUrl,
          type: original.type,
          savedMediaId: original.savedMediaId,
          deletionTargetType: original.deletionTargetType,
          deletionTargetId: original.deletionTargetId,
          status: { in: ['QUEUED', 'RUNNING'] },
        },
        select: { id: true, status: true, sourceUrl: true },
      });
      return active
        ? {
            outcome: 'inflight',
            jobId: active.id,
            status: active.status,
            sourceUrl: active.sourceUrl,
          }
        : { outcome: 'inflight' };
    }
    throw error;
  }
}
