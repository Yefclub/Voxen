import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { setSetting } from '../src/lib/settings';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const OWNER_EMAIL = 'saved-media-owner@voxen.local';
const FOREIGN_EMAIL = 'saved-media-foreign@voxen.local';
const PASSWORD = 'senha-super-segura-123';

async function signUp(email: string, name: string): Promise<void> {
  await app.fetch(
    new Request('http://localhost/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, name }),
    }),
  );
  await db.user.update({ where: { email }, data: { status: 'APPROVED' } });
}

async function signIn(email: string): Promise<string> {
  const response = await app.fetch(
    new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

async function removeFixtureUsers(): Promise<void> {
  await db.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, FOREIGN_EMAIL] } } });
}

describeIfDb('saved media library API', () => {
  beforeAll(async () => {
    process.env.S3_DELETE_DISABLED = 'true';
    await removeFixtureUsers();
    await setSetting('openrouter_api_key', `sk-or-v1-${'x'.repeat(40)}`);
    await setSetting('default_chat_model', 'openrouter/auto');
    await setSetting('default_transcription_model', 'x-ai/grok-stt-1.0');
  });

  afterAll(async () => {
    await removeFixtureUsers();
    delete process.env.S3_DELETE_DISABLED;
  });

  it('keeps download, processing, queued deletion, and listing isolated by user', async () => {
    await signUp(OWNER_EMAIL, 'Saved Media Owner');
    await signUp(FOREIGN_EMAIL, 'Saved Media Foreign');
    const ownerCookie = await signIn(OWNER_EMAIL);
    const foreignCookie = await signIn(FOREIGN_EMAIL);
    const owner = await db.user.findUniqueOrThrow({ where: { email: OWNER_EMAIL } });

    const createResponse = await app.fetch(
      new Request('http://localhost/api/saved-media', {
        method: 'POST',
        headers: { cookie: ownerCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30' }),
      }),
    );
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { itemId: string; jobId: string };
    const downloadJob = await db.job.findUniqueOrThrow({ where: { id: created.jobId } });
    expect(downloadJob).toMatchObject({
      userId: owner.id,
      type: 'DOWNLOAD_MEDIA',
      sourceUrl: 'https://youtu.be/dQw4w9WgXcQ',
      savedMediaId: created.itemId,
    });

    const foreignList = await app.fetch(
      new Request('http://localhost/api/saved-media', { headers: { cookie: foreignCookie } }),
    );
    expect(foreignList.status).toBe(200);
    expect(((await foreignList.json()) as { items: unknown[] }).items).toHaveLength(0);

    const foreignProcess = await app.fetch(
      new Request(`http://localhost/api/saved-media/${created.itemId}/process`, {
        method: 'POST',
        headers: { cookie: foreignCookie },
      }),
    );
    expect(foreignProcess.status).toBe(404);

    const objectKey = `workspaces/${owner.id}/uploads/${created.itemId}/video.mp4`;
    await db.savedMedia.update({
      where: { id: created.itemId },
      data: {
        status: 'READY',
        filename: 'video.mp4',
        mimeType: 'video/mp4',
        objectKey,
        byteSize: 4096,
        readyAt: new Date(),
      },
    });
    await db.job.update({ where: { id: created.jobId }, data: { status: 'DONE' } });

    const processResponse = await app.fetch(
      new Request(`http://localhost/api/saved-media/${created.itemId}/process`, {
        method: 'POST',
        headers: { cookie: ownerCookie },
      }),
    );
    expect(processResponse.status).toBe(201);
    const processed = (await processResponse.json()) as { jobId: string };
    const processJob = await db.job.findUniqueOrThrow({ where: { id: processed.jobId } });
    expect(processJob).toMatchObject({
      userId: owner.id,
      type: 'UPLOAD_AND_TRANSCRIBE',
      sourceUrl: `upload://${created.itemId}/video.mp4`,
      savedMediaId: created.itemId,
    });

    const transcript = await db.transcript.create({
      data: {
        userId: owner.id,
        source: 'YOUTUBE',
        url: 'https://youtu.be/dQw4w9WgXcQ',
        title: 'Saved media transcript',
        durationSec: 10,
        language: 'pt',
        transcriptionMethod: 'API',
        mdPath: `workspaces/${owner.id}/transcripts/saved-media.md`,
        plainText: 'conteúdo de teste',
        frontmatter: {},
        originalObjectKey: objectKey,
        originalFilename: 'video.mp4',
        originalMimeType: 'video/mp4',
        status: 'TRASH',
        trashedAt: new Date(),
      },
    });
    await db.savedMedia.update({
      where: { id: created.itemId },
      data: { status: 'PROCESSED', transcriptId: transcript.id, processedAt: new Date() },
    });

    const purgeResponse = await app.fetch(
      new Request(`http://localhost/api/transcripts/${transcript.id}`, {
        method: 'DELETE',
        headers: { cookie: ownerCookie },
      }),
    );
    expect(purgeResponse.status).toBe(202);
    const purge = (await purgeResponse.json()) as { jobId: string; queued: boolean };
    expect(purge.queued).toBe(true);
    expect(await db.job.findUniqueOrThrow({ where: { id: purge.jobId } })).toMatchObject({
      userId: owner.id,
      type: 'DELETE_KNOWLEDGE',
      status: 'QUEUED',
      deletionTargetType: 'TRANSCRIPT',
      deletionTargetId: transcript.id,
    });
    expect(await db.savedMedia.findUniqueOrThrow({ where: { id: created.itemId } })).toMatchObject({
      status: 'PROCESSED',
      transcriptId: transcript.id,
      objectKey,
    });

    // Simulate the already-covered worker outcome so this route test can
    // exercise an independent saved-media deletion request.
    await db.transcript.delete({ where: { id: transcript.id } });
    await db.savedMedia.update({
      where: { id: created.itemId },
      data: { status: 'READY', transcriptId: null, processedAt: null },
    });
    await db.savedMedia.update({
      where: { id: created.itemId },
      data: { objectKey: '../unsafe-object-key' },
    });
    const failedDelete = await app.fetch(
      new Request(`http://localhost/api/saved-media/${created.itemId}`, {
        method: 'DELETE',
        headers: { cookie: ownerCookie },
      }),
    );
    expect(failedDelete.status).toBe(202);
    const unsafeDelete = (await failedDelete.json()) as { jobId: string };
    expect(await db.savedMedia.findUniqueOrThrow({ where: { id: created.itemId } })).toMatchObject({
      status: 'DELETING',
      objectKey: '../unsafe-object-key',
    });
    const cancelUnsafe = await app.fetch(
      new Request(`http://localhost/api/jobs/${unsafeDelete.jobId}/cancel`, {
        method: 'POST',
        headers: { cookie: ownerCookie },
      }),
    );
    expect(cancelUnsafe.status).toBe(200);
    await db.savedMedia.update({
      where: { id: created.itemId },
      data: { objectKey },
    });

    await db.job.update({ where: { id: processed.jobId }, data: { status: 'DONE' } });
    const deleteResponse = await app.fetch(
      new Request(`http://localhost/api/saved-media/${created.itemId}`, {
        method: 'DELETE',
        headers: { cookie: ownerCookie },
      }),
    );
    expect(deleteResponse.status).toBe(202);
    const deleteBody = (await deleteResponse.json()) as { jobId: string; queued: boolean };
    expect(deleteBody.queued).toBe(true);
    expect(await db.savedMedia.findUnique({ where: { id: created.itemId } })).toMatchObject({
      status: 'DELETING',
      objectKey,
    });
    expect(await db.job.findUniqueOrThrow({ where: { id: deleteBody.jobId } })).toMatchObject({
      userId: owner.id,
      type: 'DELETE_KNOWLEDGE',
      status: 'QUEUED',
      deletionTargetType: 'SAVED_MEDIA',
      deletionTargetId: created.itemId,
    });
    expect(await db.job.findUniqueOrThrow({ where: { id: processed.jobId } })).toMatchObject({
      savedMediaId: created.itemId,
    });
  });
});
