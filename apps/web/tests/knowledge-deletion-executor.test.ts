import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { enqueueKnowledgeDeletion } from '../src/lib/knowledge-deletion';
import {
  drainPendingKnowledgeDeletions,
  runKnowledgeDeletionJob,
} from '../src/lib/knowledge-deletion-executor';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

async function wipeDb(): Promise<void> {
  await db.costEvent.deleteMany();
  await db.job.deleteMany();
  await db.transcript.deleteMany();
  await db.libraryFolder.deleteMany();
  await db.note.deleteMany();
  await db.session.deleteMany();
  await db.account.deleteMany();
  await db.verification.deleteMany();
  await db.setting.deleteMany();
  await db.user.deleteMany();
}

async function signUp(email: string, password: string, name: string): Promise<Response> {
  return app.fetch(
    new Request('http://localhost/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    }),
  );
}

async function createUser(email: string): Promise<{ id: string }> {
  await signUp(email, 'senha-super-segura-123', 'Executor');
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  return { id: user.id };
}

async function createTranscript(userId: string, status: 'ACTIVE' | 'TRASH' = 'TRASH') {
  return db.transcript.create({
    data: {
      userId,
      source: 'WEB',
      url: `https://example.com/${Math.random().toString(36).slice(2)}`,
      title: 'Apagar',
      durationSec: 0,
      language: 'pt',
      transcriptionMethod: 'SCRAPE',
      status,
      mdPath: `workspaces/${userId}/transcripts/apagar.md`,
      plainText: 'texto',
      frontmatter: {},
    },
  });
}

describeIfDb('knowledge deletion web executor', () => {
  beforeEach(async () => {
    process.env.S3_DELETE_DISABLED = 'true';
    await wipeDb();
  });

  afterAll(async () => {
    await wipeDb();
    await db.$disconnect();
    delete process.env.S3_DELETE_DISABLED;
  });

  it('executes a queued transcript deletion without the worker', async () => {
    const user = await createUser('transcript-del@voxen.local');
    const transcript = await createTranscript(user.id, 'TRASH');
    const { job, created } = await enqueueKnowledgeDeletion({
      userId: user.id,
      type: 'TRANSCRIPT',
      id: transcript.id,
    });
    expect(created).toBe(true);

    const claimed = await runKnowledgeDeletionJob(job.id);
    expect(claimed).toBe(true);
    expect(await db.transcript.findUnique({ where: { id: transcript.id } })).toBeNull();
    const finished = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(finished.status).toBe('DONE');
  });

  it('drains pending deletions on startup, including expired leases', async () => {
    const user = await createUser('drain-del@voxen.local');
    const transcript = await createTranscript(user.id, 'TRASH');
    const { job } = await enqueueKnowledgeDeletion({
      userId: user.id,
      type: 'TRANSCRIPT',
      id: transcript.id,
    });
    // Simulate a crashed executor holding an expired lease.
    await db.job.update({
      where: { id: job.id },
      data: { status: 'RUNNING', workerId: 'dead', attempt: 1, leaseExpiresAt: new Date(0) },
    });

    const { processed } = await drainPendingKnowledgeDeletions();
    expect(processed).toBe(1);
    expect(await db.transcript.findUnique({ where: { id: transcript.id } })).toBeNull();
    const finished = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(finished.status).toBe('DONE');
  });

  it('deletes note trees and marks unrecoverable jobs failed', async () => {
    const user = await createUser('note-del@voxen.local');
    const parent = await db.note.create({
      data: { userId: user.id, title: 'Pai', content: 'pai' },
    });
    const child = await db.note.create({
      data: { userId: user.id, parentId: parent.id, title: 'Filha', content: 'filha' },
    });
    const { job } = await enqueueKnowledgeDeletion({ userId: user.id, type: 'NOTE', id: parent.id });
    expect(await runKnowledgeDeletionJob(job.id)).toBe(true);
    expect(await db.note.findUnique({ where: { id: parent.id } })).toBeNull();
    expect(await db.note.findUnique({ where: { id: child.id } })).toBeNull();

    // A transcript outside trash can never satisfy the worker contract:
    // after exhausting attempts the job fails instead of looping forever.
    const active = await createTranscript(user.id, 'ACTIVE');
    const stuck = await db.job.create({
      data: {
        userId: user.id,
        type: 'DELETE_KNOWLEDGE',
        status: 'QUEUED',
        sourceUrl: `voxen://delete/transcript/${active.id}`,
        deletionTargetType: 'TRANSCRIPT',
        deletionTargetId: active.id,
        deletionTargetTitle: active.title,
        attempt: 2,
      },
    });
    expect(await runKnowledgeDeletionJob(stuck.id)).toBe(true);
    const failed = await db.job.findUniqueOrThrow({ where: { id: stuck.id } });
    expect(failed.status).toBe('FAILED');
    expect(await db.transcript.findUnique({ where: { id: active.id } })).not.toBeNull();
  });

  it('returns false for unknown jobs instead of failing the drain', async () => {
    expect(await runKnowledgeDeletionJob('missing')).toBe(false);
  });
});
