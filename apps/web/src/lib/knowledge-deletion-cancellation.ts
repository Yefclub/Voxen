import { db } from './db';
import { publishJobEvent } from './job-events';
import type { KnowledgeDeletionTargetType } from './knowledge-deletion';

type DeletionJobForCancellation = {
  id: string;
  type: string;
  status: string;
  deletionTargetType: KnowledgeDeletionTargetType | null;
  deletionTargetId: string | null;
};

export async function knowledgeDeletionCancellationResponse(
  userId: string,
  job: DeletionJobForCancellation,
): Promise<Response | null> {
  if (job.type !== 'DELETE_KNOWLEDGE') return null;
  const outcome = await cancelKnowledgeDeletionJob(userId, job);
  if (outcome === 'running') {
    return Response.json(
      { error: 'Uma exclusão em andamento não pode ser cancelada.' },
      { status: 409 },
    );
  }
  if (outcome === 'stale') {
    return Response.json({ error: 'Só é possível cancelar jobs ativos.' }, { status: 400 });
  }
  return Response.json({ ok: true });
}

export async function cancelKnowledgeDeletionJob(
  userId: string,
  job: DeletionJobForCancellation,
): Promise<'cancelled' | 'running' | 'stale'> {
  if (job.status === 'RUNNING') return 'running';
  const cancelled = await db.$transaction(async (tx) => {
    const updated = await tx.job.updateMany({
      where: { id: job.id, userId, status: 'QUEUED', type: 'DELETE_KNOWLEDGE' },
      data: {
        status: 'CANCELLED',
        errorMsg: 'Cancelado pelo usuário.',
        finishedAt: new Date(),
      },
    });
    if (updated.count !== 1) return false;
    if (job.deletionTargetType === 'SAVED_MEDIA' && job.deletionTargetId) {
      const media = await tx.savedMedia.findFirst({
        where: { id: job.deletionTargetId, userId, status: 'DELETING' },
        select: { objectKey: true },
      });
      if (media) {
        await tx.savedMedia.update({
          where: { id: job.deletionTargetId },
          data: media.objectKey
            ? { status: 'READY', errorMsg: null }
            : { status: 'FAILED', errorMsg: 'O arquivo não está disponível.' },
        });
      }
    }
    return true;
  });
  if (!cancelled) return 'stale';
  await publishJobEvent(userId, {
    jobId: job.id,
    stage: 'cancelled',
    errorMsg: 'Cancelado pelo usuário.',
  }).catch(() => undefined);
  return 'cancelled';
}
