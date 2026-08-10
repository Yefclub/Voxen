import type {
  Prisma,
  BrainSourceType,
  NoteKind,
  NoteRevisionActor,
} from '../../prisma-generated/client';
import { reindexNoteBrain } from './brain';
import { runWithBrainIndexLease } from './brain-index-lease';
import { db } from './db';
import { invalidateGraphCache } from './graph-cache';
import { noteContentChecksum } from './note-revisions';

export class NoteNotFoundError extends Error {
  constructor() {
    super('Note not found.');
    this.name = 'NoteNotFoundError';
  }
}

export class NoteRevisionConflictError extends Error {
  readonly currentRevision: number;
  readonly currentChecksum: string;

  constructor(currentRevision: number, currentChecksum: string) {
    super(`Expected note revision is stale; current revision is ${currentRevision}.`);
    this.name = 'NoteRevisionConflictError';
    this.currentRevision = currentRevision;
    this.currentChecksum = currentChecksum;
  }
}

export type NoteVersionActor = NoteRevisionActor;

type RevisionSource = {
  id: string;
  userId: string;
  title: string;
  content: string;
  revision: number;
};

export async function recordInitialNoteRevision(
  tx: Prisma.TransactionClient,
  note: RevisionSource,
  actor: NoteVersionActor,
  changeSummary = 'Initial note revision',
): Promise<void> {
  await tx.noteRevision.create({
    data: {
      userId: note.userId,
      noteId: note.id,
      revision: note.revision,
      title: note.title,
      content: note.content,
      checksum: noteContentChecksum(note.title, note.content),
      actor,
      changeSummary: changeSummary.slice(0, 500),
    },
  });
}

export type NoteScalarChanges = {
  parentId?: string | null;
  title?: string;
  content?: string;
  sourceType?: 'TRANSCRIPT' | null;
  sourceId?: string | null;
};

export type CommitNoteVersionInput = {
  userId: string;
  noteId: string;
  expectedRevision: number;
  actor: NoteVersionActor;
  changeSummary: string;
  changes?: NoteScalarChanges;
  mutateRelations?: (tx: Prisma.TransactionClient) => Promise<void>;
};

export type CommittedNoteVersion = {
  id: string;
  userId: string;
  parentId: string | null;
  sourceType: BrainSourceType | null;
  sourceId: string | null;
  kind: NoteKind;
  title: string;
  content: string;
  revision: number;
  checksum: string;
  updatedAt: Date;
};

export async function commitNoteVersion(
  input: CommitNoteVersionInput,
): Promise<CommittedNoteVersion> {
  return db.$transaction((tx) => commitNoteVersionInTransaction(tx, input));
}

export async function commitNoteVersionInTransaction(
  tx: Prisma.TransactionClient,
  input: CommitNoteVersionInput,
): Promise<CommittedNoteVersion> {
  const current = await tx.note.findFirst({
    where: { id: input.noteId, userId: input.userId },
    select: {
      id: true,
      userId: true,
      kind: true,
      title: true,
      content: true,
      revision: true,
    },
  });
  if (!current) throw new NoteNotFoundError();
  if (current.revision !== input.expectedRevision) {
    throw new NoteRevisionConflictError(
      current.revision,
      noteContentChecksum(current.title, current.content),
    );
  }

  const title = input.changes?.title ?? current.title;
  const content = input.changes?.content ?? current.content;
  const nextRevision = current.revision + 1;
  const claimed = await tx.note.updateMany({
    where: { id: current.id, userId: input.userId, revision: input.expectedRevision },
    data: {
      ...(input.changes ?? {}),
      revision: { increment: 1 },
    },
  });
  if (claimed.count !== 1) {
    const head = await tx.note.findFirst({
      where: { id: current.id, userId: input.userId },
      select: { title: true, content: true, revision: true },
    });
    if (!head) throw new NoteNotFoundError();
    throw new NoteRevisionConflictError(
      head.revision,
      noteContentChecksum(head.title, head.content),
    );
  }

  await input.mutateRelations?.(tx);
  const checksum = noteContentChecksum(title, content);
  await tx.noteRevision.create({
    data: {
      userId: input.userId,
      noteId: current.id,
      revision: nextRevision,
      title,
      content,
      checksum,
      actor: input.actor,
      changeSummary: input.changeSummary.trim().slice(0, 500) || null,
    },
  });
  const note = await tx.note.findFirstOrThrow({
    where: { id: current.id, userId: input.userId },
    select: {
      id: true,
      userId: true,
      parentId: true,
      sourceType: true,
      sourceId: true,
      kind: true,
      title: true,
      content: true,
      revision: true,
      updatedAt: true,
    },
  });
  return { ...note, checksum };
}

export type NoteGraphSyncState = 'READY' | 'PENDING';

export async function syncNoteGraph(userId: string, noteId: string): Promise<NoteGraphSyncState> {
  let ready = false;
  try {
    ready = await runWithBrainIndexLease(userId, async (guard) => {
      await reindexNoteBrain(userId, noteId, guard);
    });
  } catch (error) {
    console.warn('[notes] source graph refresh deferred', {
      userId,
      noteId,
      reason: error instanceof Error ? error.name : 'unknown',
    });
  }
  await invalidateGraphCache(userId).catch(() => undefined);
  return ready ? 'READY' : 'PENDING';
}

export function currentNoteChecksum(note: { title: string; content: string }): string {
  return noteContentChecksum(note.title, note.content);
}
