import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db } from './db';
import {
  NoteNotFoundError,
  NoteRevisionConflictError,
  commitNoteVersion,
  recordInitialNoteRevision,
} from './note-versioning';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('versioned note commits', () => {
  let userId = '';
  let foreignUserId = '';
  let noteId = '';

  beforeAll(async () => {
    const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const [owner, foreign] = await Promise.all([
      db.user.create({
        data: {
          email: `note-version-owner-${suffix}@voxen.local`,
          name: 'Owner',
          status: 'APPROVED',
        },
      }),
      db.user.create({
        data: {
          email: `note-version-foreign-${suffix}@voxen.local`,
          name: 'Foreign',
          status: 'APPROVED',
        },
      }),
    ]);
    userId = owner.id;
    foreignUserId = foreign.id;
    const note = await db.$transaction(async (tx) => {
      const created = await tx.note.create({
        data: { userId, kind: 'NOTE', title: 'Versioned', content: 'revision one' },
      });
      await recordInitialNoteRevision(tx, created, 'USER');
      return created;
    });
    noteId = note.id;
  });

  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    if (foreignUserId)
      await db.user.delete({ where: { id: foreignUserId } }).catch(() => undefined);
    await db.$disconnect();
  });

  test('one of two concurrent writers commits revision 2 and the other conflicts', async () => {
    const writes = await Promise.allSettled([
      commitNoteVersion({
        userId,
        noteId,
        expectedRevision: 1,
        actor: 'USER',
        changeSummary: 'Writer A',
        changes: { content: 'writer A' },
      }),
      commitNoteVersion({
        userId,
        noteId,
        expectedRevision: 1,
        actor: 'MCP',
        changeSummary: 'Writer B',
        changes: { content: 'writer B' },
      }),
    ]);
    expect(writes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = writes.find((result) => result.status === 'rejected');
    expect(rejected).toBeDefined();
    if (rejected?.status === 'rejected') {
      expect(rejected.reason).toBeInstanceOf(NoteRevisionConflictError);
    }
    const note = await db.note.findUniqueOrThrow({ where: { id: noteId } });
    expect(note.revision).toBe(2);
    const revisions = await db.noteRevision.findMany({
      where: { noteId },
      orderBy: { revision: 'asc' },
    });
    expect(revisions.map((revision) => revision.revision)).toEqual([1, 2]);
    expect(revisions[1]?.content).toBe(note.content);
  });

  test('a foreign owner cannot discover or mutate the note', async () => {
    await expect(
      commitNoteVersion({
        userId: foreignUserId,
        noteId,
        expectedRevision: 2,
        actor: 'MCP',
        changeSummary: 'Foreign edit',
        changes: { content: 'forbidden' },
      }),
    ).rejects.toBeInstanceOf(NoteNotFoundError);
  });
});
