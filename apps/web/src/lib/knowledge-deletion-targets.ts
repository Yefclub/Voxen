// ============================================================================
// Knowledge deletion target execution (web) — spec 215
// ============================================================================
// Per-target deletion routines for the web executor. Mirrors the execution
// functions in the removed worker implementation (spec 215).
// ============================================================================

import { db } from './db';
import { runWithBrainIndexLease } from './brain-index-lease';
import { storageDelete } from './storage/index';
import {
  assertOwnership,
  deleteGraphSources,
  ownedTreeIds,
  type ClaimedDeletionJob,
} from './knowledge-deletion-graph';

const GRAPH_LEASE_ATTEMPTS = 5;

export class LeaseUnavailableError extends Error {
  constructor() {
    super('Knowledge graph lease is temporarily unavailable.');
  }
}

async function deleteStorageKeys(keys: Array<string | null | undefined>): Promise<void> {
  for (const key of new Set(keys.filter((key): key is string => !!key))) {
    await storageDelete(key);
  }
}

async function withGraphLease<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  let delayMs = 250;
  for (let attempt = 1; ; attempt += 1) {
    let executed = false;
    let result: T | undefined;
    const leased = await runWithBrainIndexLease(userId, async () => {
      executed = true;
      result = await operation();
    });
    if (leased) return result as T;
    if (!executed) {
      // Lease contention without running the operation: back off and retry
      // instead of burning the job attempt budget.
      if (attempt >= GRAPH_LEASE_ATTEMPTS) throw new LeaseUnavailableError();
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 2, 1000);
      continue;
    }
    throw new LeaseUnavailableError();
  }
}

export async function executeTranscriptDeletion(job: ClaimedDeletionJob): Promise<void> {
  const lockKey = `voxen:source-refresh:${job.deletionTargetId}`;
  await withGraphLease(job.userId, async () => {
    await db.$transaction(async (tx) => {
      // Transaction-scoped advisory lock: same connection, auto-released.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      await assertOwnership(tx, job);
      const locked = await tx.$queryRaw<
        Array<{
          id: string;
          status: string;
          mdPath: string | null;
          originalObjectKey: string | null;
          previewObjectKey: string | null;
          savedMediaId: string | null;
          savedMediaObjectKey: string | null;
        }>
      >`
        SELECT transcript.id, transcript.status, transcript."mdPath",
               transcript."originalObjectKey", transcript."previewObjectKey",
               media.id AS "savedMediaId",
               media."objectKey" AS "savedMediaObjectKey"
        FROM "Transcript" transcript
        LEFT JOIN "SavedMedia" media ON media."transcriptId" = transcript.id
        WHERE transcript.id = ${job.deletionTargetId} AND transcript."userId" = ${job.userId}
        FOR UPDATE OF transcript
      `;
      const row = locked[0];
      if (row && String(row.status) !== 'TRASH') {
        throw new Error('Transcript must remain in trash until deletion completes.');
      }
      const versions = row
        ? await tx.$queryRaw<Array<{ mdPath: string | null }>>`
            SELECT "mdPath" FROM "SourceContentVersion"
            WHERE "transcriptId" = ${job.deletionTargetId} AND "userId" = ${job.userId}
          `
        : [];
      if (row) {
        await deleteStorageKeys([
          row.mdPath,
          row.previewObjectKey,
          row.originalObjectKey === row.savedMediaObjectKey ? null : row.originalObjectKey,
          ...versions.map((version) => version.mdPath),
        ]);
      }
      if (row?.savedMediaId) {
        if (row.savedMediaObjectKey) {
          await tx.$executeRaw`
            UPDATE "SavedMedia"
            SET status = 'READY'::"SavedMediaStatus", "transcriptId" = NULL,
                "processedAt" = NULL, "errorMsg" = NULL, "updatedAt" = NOW()
            WHERE id = ${row.savedMediaId} AND "userId" = ${job.userId}
          `;
        } else {
          await tx.$executeRaw`
            UPDATE "SavedMedia"
            SET status = 'FAILED'::"SavedMediaStatus", "transcriptId" = NULL,
                "processedAt" = NULL,
                "errorMsg" = 'O arquivo original não está mais disponível.',
                "updatedAt" = NOW()
            WHERE id = ${row.savedMediaId} AND "userId" = ${job.userId}
          `;
        }
      }
      await deleteGraphSources(tx, job.userId, 'TRANSCRIPT', [job.deletionTargetId]);
      await tx.$executeRaw`
        DELETE FROM "Transcript" WHERE id = ${job.deletionTargetId} AND "userId" = ${job.userId}
      `;
    });
  });
}

export async function executeNoteDeletion(job: ClaimedDeletionJob): Promise<void> {
  await withGraphLease(job.userId, async () => {
    await db.$transaction(async (tx) => {
      await assertOwnership(tx, job);
      const ids = await ownedTreeIds(tx, 'Note', job.userId, job.deletionTargetId);
      await deleteGraphSources(
        tx,
        job.userId,
        'NOTE',
        ids.length > 0 ? ids : [job.deletionTargetId],
      );
      await tx.$executeRaw`
        DELETE FROM "Note" WHERE id = ${job.deletionTargetId} AND "userId" = ${job.userId}
      `;
    });
  });
}

export async function executeSavedMediaDeletion(job: ClaimedDeletionJob): Promise<void> {
  const rows = await db.$queryRaw<
    Array<{ id: string; objectKey: string | null; status: string; transcriptId: string | null }>
  >`
    SELECT id, "objectKey", status, "transcriptId"
    FROM "SavedMedia" WHERE id = ${job.deletionTargetId} AND "userId" = ${job.userId}
  `;
  const media = rows[0];
  if (media) {
    if (media.transcriptId || String(media.status) === 'PROCESSED') {
      throw new Error('Processed saved media remains linked to its transcript.');
    }
    if (['QUEUED', 'DOWNLOADING', 'PROCESSING'].includes(String(media.status))) {
      throw new Error('Saved media is still being processed.');
    }
    await deleteStorageKeys([media.objectKey]);
  }
  await db.$transaction(async (tx) => {
    await assertOwnership(tx, job);
    await tx.$executeRaw`
      DELETE FROM "SavedMedia"
      WHERE id = ${job.deletionTargetId} AND "userId" = ${job.userId} AND "transcriptId" IS NULL
    `;
  });
}

export async function executeLibraryFolderDeletion(job: ClaimedDeletionJob): Promise<void> {
  await withGraphLease(job.userId, async () => {
    await db.$transaction(async (tx) => {
      await assertOwnership(tx, job);
      let ids: string[];
      let transcriptIds: string[];
      if (job.deletionTargetId === '*') {
        const forest = await tx.$queryRaw<Array<{ id: string; userId: string }>>`
          WITH RECURSIVE tree AS (
            SELECT id, "userId" FROM "LibraryFolder" WHERE "userId" = ${job.userId}
            UNION
            SELECT child.id, child."userId"
            FROM "LibraryFolder" child
            JOIN tree parent ON child."parentId" = parent.id
          )
          SELECT id, "userId" FROM tree
        `;
        if (forest.some((row) => String(row.userId) !== job.userId)) {
          throw new Error('Cross-workspace folder relation rejected.');
        }
        ids = forest.map((row) => String(row.id));
        transcriptIds = (
          await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM "Transcript" WHERE "userId" = ${job.userId}
            AND "folderId" = ANY(${ids}::text[])
          `
        ).map((row) => String(row.id));
        await deleteGraphSources(tx, job.userId, 'FOLDER', ids);
        await tx.$executeRaw`DELETE FROM "LibraryFolder" WHERE "userId" = ${job.userId}`;
      } else {
        ids = await ownedTreeIds(tx, 'LibraryFolder', job.userId, job.deletionTargetId);
        transcriptIds = (
          await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM "Transcript" WHERE "userId" = ${job.userId}
            AND "folderId" = ANY(${ids}::text[])
          `
        ).map((row) => String(row.id));
        await deleteGraphSources(
          tx,
          job.userId,
          'FOLDER',
          ids.length > 0 ? ids : [job.deletionTargetId],
        );
        await tx.$executeRaw`
          DELETE FROM "LibraryFolder" WHERE id = ${job.deletionTargetId} AND "userId" = ${job.userId}
        `;
      }
      // Folder deletion nulls transcript.folderId via FK, so the affected
      // transcripts must be resolved before the folders are removed.
      if (transcriptIds.length > 0) {
        await tx.$executeRaw`
          UPDATE "BrainNode"
          SET metadata = COALESCE(metadata, '{}'::jsonb) - 'folderId',
              "updatedAt" = NOW()
          WHERE "userId" = ${job.userId}
            AND "sourceType" = 'TRANSCRIPT'::"BrainSourceType"
            AND "sourceId" = ANY(${transcriptIds}::text[])
        `;
      }
    });
  });
}

export async function executeTranscriptEnrichmentDeletion(job: ClaimedDeletionJob): Promise<void> {
  await withGraphLease(job.userId, async () => {
    await db.$transaction(async (tx) => {
      await assertOwnership(tx, job);
      await deleteGraphSources(tx, job.userId, 'EXTERNAL_ENRICHMENT', [job.deletionTargetId]);
      await tx.$executeRaw`
        DELETE FROM "TranscriptEnrichment"
        WHERE id = ${job.deletionTargetId} AND "userId" = ${job.userId}
      `;
    });
  });
}

export async function revertDeletingSavedMedia(args: {
  userId: string;
  deletionTargetType: string;
  deletionTargetId: string;
}): Promise<void> {
  if (args.deletionTargetType !== 'SAVED_MEDIA') return;
  const media = await db.savedMedia.findFirst({
    where: { id: args.deletionTargetId, userId: args.userId, status: 'DELETING' },
    select: { objectKey: true },
  });
  if (!media) return;
  await db.savedMedia.updateMany({
    where: { id: args.deletionTargetId, userId: args.userId },
    data: media.objectKey
      ? { status: 'READY', errorMsg: null }
      : { status: 'FAILED', errorMsg: 'O arquivo não está disponível.' },
  });
}
