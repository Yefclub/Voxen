// ============================================================================
// Shared prepared-note creation with contract idempotency (spec 216 §1).
// Used by MCP (voxen_create_note, voxen_import_notes) and HTTP POST /api/notes.
// Validation of anchors/transcripts stays with the callers; the key claim and
// the duplicate fast-path live here so every entrypoint behaves identically.
// ============================================================================

import { db } from './db';
import { noteContentChecksum } from './note-revisions';
import {
  assertIngestContractVersion,
  assertIngestKey,
  claimIngestKey,
  findIngestTarget,
  PreparedIngestContractError,
} from './prepared-ingest';

export { PreparedIngestContractError };
import type { ValidatedNoteAnchor } from './note-anchors';
import { noteSourceCreateData } from './note-anchors';
import { recordInitialNoteRevision, syncNoteGraph } from './note-versioning';

export type PreparedNoteInput = {
  title: string;
  content?: string;
  parentId?: string | null;
  transcriptIds: readonly string[];
  anchors: readonly ValidatedNoteAnchor[];
  actor: 'MCP' | 'USER';
  idempotencyKey?: string;
  producerId?: string;
  externalId?: string;
  contractVersion?: string;
};

export type PreparedNoteResult = {
  id: string;
  title: string;
  revision: number;
  checksum: string;
  duplicate: boolean;
};

async function readNoteBrief(userId: string, noteId: string) {
  const note = await db.note.findFirst({
    where: { id: noteId, userId, kind: 'NOTE' },
    select: { id: true, title: true, content: true, revision: true },
  });
  if (!note) throw new PreparedIngestContractError('Idempotency target no longer exists.');
  return {
    id: note.id,
    title: note.title,
    revision: note.revision,
    checksum: noteContentChecksum(note.title, note.content),
  };
}

export async function createPreparedNote(
  userId: string,
  input: PreparedNoteInput,
): Promise<PreparedNoteResult> {
  assertIngestContractVersion(input.contractVersion);
  const title = input.title.trim();
  if (!title) throw new PreparedIngestContractError('Title is required.');
  if (input.idempotencyKey !== undefined) assertIngestKey(input.idempotencyKey);

  if (input.idempotencyKey !== undefined) {
    const existing = await findIngestTarget(userId, input.idempotencyKey);
    if (existing) {
      return { ...(await readNoteBrief(userId, existing.targetId)), duplicate: true };
    }
  }

  try {
    const created = await db.$transaction(async (tx) => {
      const note = await tx.note.create({
        data: {
          userId,
          parentId: input.parentId ?? null,
          kind: 'NOTE',
          title,
          content: input.content ?? '',
          sourceType: input.transcriptIds.length > 0 ? 'TRANSCRIPT' : null,
          sourceId: input.transcriptIds[0] ?? null,
          ...(input.transcriptIds.length > 0
            ? {
                transcriptSources: {
                  create: noteSourceCreateData(userId, [...input.transcriptIds], input.anchors),
                },
              }
            : {}),
        },
      });
      await recordInitialNoteRevision(tx, note, input.actor);
      if (input.idempotencyKey !== undefined) {
        await claimIngestKey(tx, {
          userId,
          key: input.idempotencyKey,
          targetType: 'NOTE',
          targetId: note.id,
          producerId: input.producerId,
          externalId: input.externalId,
        });
      }
      return note;
    });
    return {
      id: created.id,
      title: created.title,
      revision: created.revision,
      checksum: noteContentChecksum(created.title, created.content),
      duplicate: false,
    };
  } catch (error) {
    if (input.idempotencyKey !== undefined && error instanceof PreparedIngestContractError) {
      if (error.code === 'CONFLICT') throw error;
      const raced = await findIngestTarget(userId, input.idempotencyKey);
      if (raced) return { ...(await readNoteBrief(userId, raced.targetId)), duplicate: true };
    }
    throw error;
  }
}

export type PreparedNoteHttpResult = {
  note: { id: string };
  checksum: string;
  graphSync: string;
  duplicate: boolean;
};

export async function createPreparedNoteForHttp(
  userId: string,
  input: PreparedNoteInput,
): Promise<PreparedNoteHttpResult> {
  const result = await createPreparedNote(userId, input);
  const graphSync = result.duplicate ? 'DUPLICATE' : await syncNoteGraph(userId, result.id);
  const full = await db.note.findFirst({ where: { id: result.id, userId } });
  if (!full) throw new PreparedIngestContractError('Nota não encontrada.');
  return { note: full, checksum: result.checksum, graphSync, duplicate: result.duplicate };
}
