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

  it('does not execute the same job twice', async () => {
    const user = await createUser('double-run@voxen.local');
    const transcript = await createTranscript(user.id, 'TRASH');
    const { job } = await enqueueKnowledgeDeletion({
      userId: user.id,
      type: 'TRANSCRIPT',
      id: transcript.id,
    });
    expect(await runKnowledgeDeletionJob(job.id)).toBe(true);
    expect(await runKnowledgeDeletionJob(job.id)).toBe(false);
  });

  it('cleans graph evidence and restores linked saved media', async () => {
    const user = await createUser('graph-del@voxen.local');
    const transcript = await createTranscript(user.id, 'TRASH');
    const media = await db.savedMedia.create({
      data: {
        userId: user.id,
        sourceUrl: 'https://example.com/media.mp4',
        canonicalUrl: 'https://example.com/media.mp4',
        title: 'Mídia',
        objectKey: `workspaces/${user.id}/media.mp4`,
        status: 'READY',
        transcriptId: transcript.id,
      },
    });
    const node = await db.brainNode.create({
      data: {
        userId: user.id,
        key: `transcript:${transcript.id}`,
        type: 'CONTENT',
        label: 'Apagar',
        sourceType: 'TRANSCRIPT',
        sourceId: transcript.id,
      },
    });
    await db.brainSource.create({
      data: {
        userId: user.id,
        nodeId: node.id,
        sourceType: 'TRANSCRIPT',
        sourceId: transcript.id,
      },
    });
    const { job } = await enqueueKnowledgeDeletion({
      userId: user.id,
      type: 'TRANSCRIPT',
      id: transcript.id,
    });
    expect(await runKnowledgeDeletionJob(job.id)).toBe(true);
    expect(await db.brainNode.findUnique({ where: { id: node.id } })).toBeNull();
    expect(await db.brainSource.count({ where: { userId: user.id } })).toBe(0);
    const restored = await db.savedMedia.findUniqueOrThrow({ where: { id: media.id } });
    expect(restored.status).toBe('READY');
    expect(restored.transcriptId).toBeNull();
  });

  it('reverts deleting media to ready on terminal failure', async () => {
    const user = await createUser('media-fail@voxen.local');
    const transcript = await createTranscript(user.id, 'ACTIVE');
    const media = await db.savedMedia.create({
      data: {
        userId: user.id,
        sourceUrl: 'https://example.com/stuck.mp4',
        canonicalUrl: 'https://example.com/stuck.mp4',
        title: 'Presa',
        objectKey: `workspaces/${user.id}/stuck.mp4`,
        status: 'DELETING',
        transcriptId: transcript.id,
      },
    });
    const stuck = await db.job.create({
      data: {
        userId: user.id,
        type: 'DELETE_KNOWLEDGE',
        status: 'QUEUED',
        sourceUrl: `voxen://delete/saved_media/${media.id}`,
        deletionTargetType: 'SAVED_MEDIA',
        deletionTargetId: media.id,
        deletionTargetTitle: 'Presa',
        attempt: 2,
      },
    });
    expect(await runKnowledgeDeletionJob(stuck.id)).toBe(true);
    expect(await db.job.findUniqueOrThrow({ where: { id: stuck.id } })).toMatchObject({
      status: 'FAILED',
    });
    // Linked media survives; the deleting marker is reverted so it stays usable.
    expect(await db.savedMedia.findUniqueOrThrow({ where: { id: media.id } })).toMatchObject({
      status: 'READY',
      transcriptId: transcript.id,
    });
  });

  it('clears every folder with wildcard and strips graph folder refs', async () => {
    const user = await createUser('folder-wild@voxen.local');
    const folder = await db.libraryFolder.create({
      data: { userId: user.id, name: 'Pasta' },
    });
    const transcript = await db.transcript.create({
      data: {
        userId: user.id,
        source: 'WEB',
        url: `https://example.com/foldered-${Date.now()}`,
        title: 'Na pasta',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        folderId: folder.id,
        mdPath: `workspaces/${user.id}/transcripts/foldered.md`,
        plainText: 'texto',
        frontmatter: {},
      },
    });
    await db.brainNode.create({
      data: {
        userId: user.id,
        key: `transcript:${transcript.id}`,
        type: 'CONTENT',
        label: 'Na pasta',
        metadata: { folderId: folder.id },
        sourceType: 'TRANSCRIPT',
        sourceId: transcript.id,
      },
    });
    const { job } = await enqueueKnowledgeDeletion({
      userId: user.id,
      type: 'LIBRARY_FOLDER',
      id: '*',
      allowAllLibraryFolders: true,
    });
    expect(await runKnowledgeDeletionJob(job.id)).toBe(true);
    expect(await db.libraryFolder.count({ where: { userId: user.id } })).toBe(0);
    // Transcripts survive; only the graph folder reference is stripped.
    expect(await db.transcript.findUnique({ where: { id: transcript.id } })).not.toBeNull();
    const node = await db.brainNode.findFirst({
      where: { userId: user.id, sourceId: transcript.id },
    });
    expect(node).not.toBeNull();
    expect((node!.metadata as Record<string, unknown>)['folderId']).toBeUndefined();
  });

  it('deletes enrichments with their graph evidence', async () => {
    const user = await createUser('enrich-del@voxen.local');
    const transcript = await createTranscript(user.id, 'TRASH');
    const enrichment = await db.transcriptEnrichment.create({
      data: {
        userId: user.id,
        transcriptId: transcript.id,
        runKey: 'run-1',
        trigger: 'MANUAL',
        title: 'Pesquisa',
        content: 'conteúdo',
      },
    });
    await db.brainSource.create({
      data: {
        userId: user.id,
        sourceType: 'EXTERNAL_ENRICHMENT',
        sourceId: enrichment.id,
      },
    });
    const { job } = await enqueueKnowledgeDeletion({
      userId: user.id,
      type: 'TRANSCRIPT_ENRICHMENT',
      id: enrichment.id,
    });
    expect(await runKnowledgeDeletionJob(job.id)).toBe(true);
    expect(await db.transcriptEnrichment.findUnique({ where: { id: enrichment.id } })).toBeNull();
    expect(
      await db.brainSource.count({
        where: { userId: user.id, sourceId: enrichment.id },
      }),
    ).toBe(0);
  });

  it('rejects cross-workspace trees without deleting anything', async () => {
    const owner = await createUser('tree-owner@voxen.local');
    const intruder = await createUser('tree-intruder@voxen.local');
    const parent = await db.note.create({
      data: { userId: owner.id, title: 'Pai', content: 'pai' },
    });
    // Foreign planted child: bypasses the API to simulate a corrupted tree.
    const child = await db.note.create({
      data: { userId: intruder.id, parentId: parent.id, title: 'Filha', content: 'filha' },
    });
    const { job } = await enqueueKnowledgeDeletion({
      userId: owner.id,
      type: 'NOTE',
      id: parent.id,
    });
    expect(await runKnowledgeDeletionJob(job.id)).toBe(true);
    const failed = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(['QUEUED', 'FAILED']).toContain(failed.status);
    expect(await db.note.findUnique({ where: { id: parent.id } })).not.toBeNull();
    expect(await db.note.findUnique({ where: { id: child.id } })).not.toBeNull();
  });
});
