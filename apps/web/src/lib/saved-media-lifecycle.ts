import { db } from './db';

export type SavedMediaJob = {
  id: string;
  type: string;
  savedMediaId: string | null;
};

export async function cancelActiveSavedMediaJob(
  userId: string,
  job: SavedMediaJob,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const updated = await tx.job.updateMany({
      where: { id: job.id, userId, status: { in: ['QUEUED', 'RUNNING'] } },
      data: {
        status: 'CANCELLED',
        errorMsg: 'Cancelado pelo usuário.',
        finishedAt: new Date(),
      },
    });
    if (updated.count === 0) return false;
    if (job.savedMediaId) {
      await tx.savedMedia.updateMany({
        where: { id: job.savedMediaId, userId, transcriptId: null },
        data: {
          status: job.type === 'DOWNLOAD_MEDIA' ? 'FAILED' : 'READY',
          errorMsg:
            job.type === 'DOWNLOAD_MEDIA'
              ? 'Cancelado pelo usuário.'
              : 'Processamento cancelado pelo usuário.',
        },
      });
    }
    return true;
  });
}

export type TranscriptSavedMedia = { id: string; objectKey: string | null } | null;

export function transcriptPurgeStorageKeys(transcript: {
  mdPath: string;
  previewObjectKey: string | null;
  originalObjectKey: string | null;
  savedMedia: TranscriptSavedMedia;
}): Array<string | null> {
  return [
    transcript.mdPath,
    transcript.previewObjectKey,
    transcript.originalObjectKey === transcript.savedMedia?.objectKey
      ? null
      : transcript.originalObjectKey,
  ];
}

export async function deleteTranscriptAndRestoreSavedMedia(
  transcriptId: string,
  savedMedia: TranscriptSavedMedia,
): Promise<void> {
  await db.$transaction(async (tx) => {
    if (savedMedia) {
      await tx.savedMedia.update({
        where: { id: savedMedia.id },
        data: savedMedia.objectKey
          ? { status: 'READY', transcriptId: null, processedAt: null, errorMsg: null }
          : {
              status: 'FAILED',
              transcriptId: null,
              processedAt: null,
              errorMsg: 'O arquivo original não está mais disponível.',
            },
      });
    }
    await tx.transcript.delete({ where: { id: transcriptId } });
  });
}
