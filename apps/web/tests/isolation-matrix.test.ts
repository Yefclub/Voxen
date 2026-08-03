import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { graphCacheKey, graphInvalidationChannel } from '../src/lib/graph-cache';
import { jobChannel, publishJobEvent, userChannel } from '../src/lib/job-events';
import { uploadObjectKey } from '../src/lib/media-upload';
import { findRelated, searchKnowledgeBase } from '../src/lib/retrieval';
import { db } from '../src/lib/db';
import { deleteSetting, getSetting, setSetting } from '../src/lib/settings';
import { hashMcpToken } from '../src/lib/mcp-tokens';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;
const SECRET = 'SEGREDO-MATRIZ-ISOLAMENTO-A';
const PASSWORD = 'senha-super-segura-123';

type Fixture = {
  adminCookie: string;
  ownerACookie: string;
  ownerBCookie: string;
  adminId: string;
  ownerAId: string;
  ownerBId: string;
  transcriptAId: string;
  transcriptBId: string;
  noteAId: string;
  noteBId: string;
  noteFolderAId: string;
  folderAId: string;
  jobAId: string;
  messageAId: string;
  mcpTokenA: string;
};

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(new Request(`http://localhost${path}`, init));
}

async function signUp(email: string, name: string): Promise<void> {
  const response = await call('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, name }),
  });
  expect(response.status).toBe(200);
}

async function signIn(email: string): Promise<string> {
  const response = await call('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

function withCookie(cookie: string, body?: unknown): RequestInit {
  return {
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

async function mcpCall(token: string, body: unknown): Promise<Response> {
  return call('/mcp', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function expectSafeNotFound(response: Response): Promise<void> {
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain(SECRET);
}

describeIfDb('matriz de isolamento entre usuários (spec 137)', () => {
  let fixture: Fixture;
  let previousAllowSignups: string | null = null;
  let previousMcpToken: string | null = null;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    previousAllowSignups = await getSetting('allow_signups').catch(() => null);
    previousMcpToken = await getSetting('mcp_api_token').catch(() => null);
    await setSetting('allow_signups', 'true');

    const adminEmail = `isolation-admin-${suffix}@voxen.local`;
    const ownerAEmail = `isolation-a-${suffix}@voxen.local`;
    const ownerBEmail = `isolation-b-${suffix}@voxen.local`;
    await signUp(adminEmail, 'Admin da matriz');
    await signUp(ownerAEmail, 'Dono A');
    await signUp(ownerBEmail, 'Dono B');

    const [admin, ownerA, ownerB] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { email: adminEmail } }),
      db.user.findUniqueOrThrow({ where: { email: ownerAEmail } }),
      db.user.findUniqueOrThrow({ where: { email: ownerBEmail } }),
    ]);
    await Promise.all([
      db.user.update({ where: { id: admin.id }, data: { role: 'ADMIN', status: 'APPROVED' } }),
      db.user.update({ where: { id: ownerA.id }, data: { status: 'APPROVED' } }),
      db.user.update({ where: { id: ownerB.id }, data: { status: 'APPROVED' } }),
    ]);

    const [adminCookie, ownerACookie, ownerBCookie] = await Promise.all([
      signIn(adminEmail),
      signIn(ownerAEmail),
      signIn(ownerBEmail),
    ]);
    const folderA = await db.libraryFolder.create({
      data: { userId: ownerA.id, name: `${SECRET} — pasta` },
    });
    const tagA = await db.tag.create({
      data: { userId: ownerA.id, name: `${SECRET} — tag`, slug: `matrix-a-${suffix}` },
    });
    const transcriptA = await db.transcript.create({
      data: {
        userId: ownerA.id,
        folderId: folderA.id,
        source: 'WEB',
        url: `https://example.com/isolation-a-${suffix}`,
        title: `${SECRET} — transcrição`,
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${ownerA.id}/transcripts/isolation-a.md`,
        originalObjectKey: `workspaces/${ownerA.id}/uploads/isolation-a/original.pdf`,
        previewObjectKey: `workspaces/${ownerA.id}/uploads/isolation-a/preview.jpg`,
        plainText: SECRET,
        frontmatter: {},
        tags: { create: [{ tagId: tagA.id }] },
      },
    });
    const transcriptB = await db.transcript.create({
      data: {
        userId: ownerB.id,
        source: 'WEB',
        url: `https://example.com/isolation-b-${suffix}`,
        title: 'Transcrição do dono B',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${ownerB.id}/transcripts/isolation-b.md`,
        plainText: 'Conteúdo do dono B.',
        frontmatter: {},
      },
    });
    const [noteFolderA, noteA, noteB, jobA, conversationA] = await Promise.all([
      db.note.create({
        data: { userId: ownerA.id, kind: 'FOLDER', title: `${SECRET} — pasta de notas` },
      }),
      db.note.create({
        data: { userId: ownerA.id, kind: 'NOTE', title: `${SECRET} — nota`, content: SECRET },
      }),
      db.note.create({
        data: { userId: ownerB.id, kind: 'NOTE', title: 'Nota do dono B', content: 'Íntegra B' },
      }),
      db.job.create({
        data: {
          userId: ownerA.id,
          type: 'SCRAPE_WEB',
          status: 'QUEUED',
          sourceUrl: `https://example.com/isolation-job-a-${suffix}`,
        },
      }),
      db.conversation.create({ data: { userId: ownerA.id } }),
    ]);
    const messageA = await db.chatMessage.create({
      data: { conversationId: conversationA.id, role: 'USER', content: SECRET },
    });
    await Promise.all([
      db.brainNode.create({
        data: {
          userId: ownerA.id,
          key: `MANUAL:isolation-${suffix}`,
          type: 'TOPIC',
          label: SECRET,
          sourceType: 'MANUAL',
        },
      }),
      db.costEvent.create({
        data: { userId: ownerA.id, kind: 'CHAT', model: `model-${SECRET}`, costUsd: '0.010000' },
      }),
    ]);
    const mcpTokenA = `isolation-mcp-${crypto.randomUUID().replaceAll('-', '')}`;
    await db.mcpToken.create({
      data: {
        userId: ownerA.id,
        tokenHash: hashMcpToken(mcpTokenA),
        label: 'Matriz A',
        scopes: 'READ,WRITE',
      },
    });

    fixture = {
      adminCookie,
      ownerACookie,
      ownerBCookie,
      adminId: admin.id,
      ownerAId: ownerA.id,
      ownerBId: ownerB.id,
      transcriptAId: transcriptA.id,
      transcriptBId: transcriptB.id,
      noteAId: noteA.id,
      noteBId: noteB.id,
      noteFolderAId: noteFolderA.id,
      folderAId: folderA.id,
      jobAId: jobA.id,
      messageAId: messageA.id,
      mcpTokenA,
    };
  });

  afterAll(async () => {
    if (previousMcpToken === null) await deleteSetting('mcp_api_token').catch(() => undefined);
    else await setSetting('mcp_api_token', previousMcpToken);
    if (previousAllowSignups === null) await deleteSetting('allow_signups').catch(() => undefined);
    else await setSetting('allow_signups', previousAllowSignups);
    if (fixture) {
      await db.user.deleteMany({
        where: { id: { in: [fixture.adminId, fixture.ownerAId, fixture.ownerBId] } },
      });
    }
    await db.$disconnect();
  });

  it('não expõe nem altera transcrições, jobs, notas, pastas ou tags de outro workspace', async () => {
    const { ownerBCookie, transcriptAId, noteAId, noteFolderAId, folderAId, jobAId } = fixture;

    const transcriptList = await call(
      '/api/transcripts?q=SEGREDO-MATRIZ',
      withCookie(ownerBCookie),
    );
    expect(transcriptList.status).toBe(200);
    expect(await transcriptList.text()).not.toContain(SECRET);
    await expectSafeNotFound(
      await call(`/api/transcripts/${transcriptAId}`, withCookie(ownerBCookie)),
    );
    await expectSafeNotFound(
      await call(`/api/transcripts/${transcriptAId}/original`, withCookie(ownerBCookie)),
    );
    await expectSafeNotFound(
      await call(`/api/transcripts/${transcriptAId}/organization`, {
        ...withCookie(ownerBCookie, { folderId: null }),
        method: 'PATCH',
      }),
    );
    await expectSafeNotFound(
      await call(`/api/transcripts/${transcriptAId}/lifecycle`, {
        ...withCookie(ownerBCookie, { status: 'TRASH' }),
        method: 'PATCH',
      }),
    );
    await expectSafeNotFound(
      await call(`/api/transcripts/${transcriptAId}`, {
        ...withCookie(ownerBCookie),
        method: 'DELETE',
      }),
    );

    const noteList = await call('/api/notes', withCookie(ownerBCookie));
    expect(noteList.status).toBe(200);
    expect(await noteList.text()).not.toContain(SECRET);
    await expectSafeNotFound(await call(`/api/notes/${noteAId}`, withCookie(ownerBCookie)));
    await expectSafeNotFound(
      await call(`/api/notes/${noteAId}`, {
        ...withCookie(ownerBCookie, { content: 'tentativa cross-user' }),
        method: 'PATCH',
      }),
    );
    await expectSafeNotFound(
      await call(`/api/notes/${noteAId}`, { ...withCookie(ownerBCookie), method: 'DELETE' }),
    );
    const foreignParent = await call('/api/notes', {
      ...withCookie(ownerBCookie, { title: 'Não deve nascer', parentId: noteFolderAId }),
      method: 'POST',
    });
    expect(foreignParent.status).toBe(400);
    expect(await foreignParent.text()).not.toContain(SECRET);

    const folders = await call('/api/library/folders', withCookie(ownerBCookie));
    expect(folders.status).toBe(200);
    expect(await folders.text()).not.toContain(SECRET);
    await expectSafeNotFound(
      await call(`/api/library/folders/${folderAId}`, {
        ...withCookie(ownerBCookie, { name: 'capturada' }),
        method: 'PATCH',
      }),
    );
    await expectSafeNotFound(
      await call(`/api/library/folders/${folderAId}`, {
        ...withCookie(ownerBCookie),
        method: 'DELETE',
      }),
    );
    const tags = await call('/api/library/tags?q=SEGREDO-MATRIZ', withCookie(ownerBCookie));
    expect(tags.status).toBe(200);
    expect(await tags.text()).not.toContain(SECRET);

    const jobs = await call('/api/jobs', withCookie(ownerBCookie));
    expect(jobs.status).toBe(200);
    expect(await jobs.text()).not.toContain(SECRET);
    await expectSafeNotFound(await call(`/api/jobs/${jobAId}`, withCookie(ownerBCookie)));
    await expectSafeNotFound(
      await call(`/api/jobs/${jobAId}/cancel`, { ...withCookie(ownerBCookie), method: 'POST' }),
    );
    await expectSafeNotFound(await call(`/api/jobs/${jobAId}/events`, withCookie(ownerBCookie)));

    expect(await db.transcript.findUniqueOrThrow({ where: { id: transcriptAId } })).toMatchObject({
      status: 'ACTIVE',
      userId: fixture.ownerAId,
    });
    expect(await db.note.findUniqueOrThrow({ where: { id: noteAId } })).toMatchObject({
      content: SECRET,
    });
    expect(await db.note.findUniqueOrThrow({ where: { id: noteFolderAId } })).toMatchObject({
      kind: 'FOLDER',
      userId: fixture.ownerAId,
    });
    expect(await db.libraryFolder.findUniqueOrThrow({ where: { id: folderAId } })).toMatchObject({
      userId: fixture.ownerAId,
    });
    expect(await db.job.findUniqueOrThrow({ where: { id: jobAId } })).toMatchObject({
      status: 'QUEUED',
      userId: fixture.ownerAId,
    });
  });

  it('mantém chat, recuperação auxiliar, Brain e custos sem bypass de workspace', async () => {
    const { ownerBCookie, ownerBId, transcriptAId, messageAId } = fixture;
    const chat = await call('/api/chat', withCookie(ownerBCookie));
    expect(chat.status).toBe(200);
    expect(await chat.text()).not.toContain(SECRET);
    await expectSafeNotFound(
      await call(`/api/chat/messages/${messageAId}/versions`, {
        ...withCookie(ownerBCookie, { content: 'não criar versão alheia' }),
        method: 'POST',
      }),
    );

    const [knowledge, related] = await Promise.all([
      searchKnowledgeBase(ownerBId, SECRET),
      findRelated(ownerBId, { transcriptId: transcriptAId }),
    ]);
    expect(JSON.stringify(knowledge)).not.toContain(SECRET);
    expect(JSON.stringify(related)).not.toContain(SECRET);

    const graph = await call('/api/graph?view=full', withCookie(ownerBCookie));
    expect(graph.status).toBe(200);
    expect(await graph.text()).not.toContain(SECRET);
    expect(graphCacheKey(fixture.ownerAId)).not.toBe(graphCacheKey(ownerBId));
    expect(graphInvalidationChannel(fixture.ownerAId)).not.toBe(graphInvalidationChannel(ownerBId));
    expect(jobChannel(fixture.ownerAId, fixture.jobAId)).not.toBe(
      jobChannel(ownerBId, fixture.jobAId),
    );
    expect(userChannel(fixture.ownerAId)).not.toBe(userChannel(ownerBId));
    expect(uploadObjectKey(fixture.ownerAId, 'upload-1', 'aula.mp4')).not.toBe(
      uploadObjectKey(ownerBId, 'upload-1', 'aula.mp4'),
    );

    const nonAdminCosts = await call('/api/admin/custos', withCookie(ownerBCookie));
    expect(nonAdminCosts.status).toBe(403);
    expect(await nonAdminCosts.text()).not.toContain(SECRET);
    const adminUsers = await call('/api/admin/usuarios', withCookie(fixture.adminCookie));
    expect(adminUsers.status).toBe(200);
    expect(await adminUsers.text()).not.toContain(SECRET);
  });

  it('recusa IDs e referências do dono B quando a chamada MCP usa o token do dono A', async () => {
    const { mcpTokenA, noteBId, transcriptBId } = fixture;
    const read = await mcpCall(mcpTokenA, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'voxen_read_note', arguments: { note_id: noteBId } },
    });
    expect(read.status).toBe(200);
    const readBody = (await read.json()) as { result?: { isError?: boolean } };
    expect(readBody.result?.isError).toBe(true);
    expect(JSON.stringify(readBody)).not.toContain('Íntegra B');

    const transcriptRead = await mcpCall(mcpTokenA, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'voxen_read_transcript', arguments: { transcript_id: transcriptBId } },
    });
    expect(transcriptRead.status).toBe(200);
    const transcriptReadBody = (await transcriptRead.json()) as { result?: { isError?: boolean } };
    expect(transcriptReadBody.result?.isError).toBe(true);
    expect(JSON.stringify(transcriptReadBody)).not.toContain('Transcrição do dono B');
    expect(JSON.stringify(transcriptReadBody)).not.toContain('Conteúdo do dono B.');

    const update = await mcpCall(mcpTokenA, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'voxen_update_note',
        arguments: { note_id: noteBId, content: 'alteração indevida' },
      },
    });
    expect(update.status).toBe(200);
    expect(((await update.json()) as { result?: { isError?: boolean } }).result?.isError).toBe(
      true,
    );

    const foreignSource = await mcpCall(mcpTokenA, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'voxen_create_note',
        arguments: { title: 'Fonte alheia', source_transcript_ids: [transcriptBId] },
      },
    });
    expect(foreignSource.status).toBe(200);
    expect(
      ((await foreignSource.json()) as { result?: { isError?: boolean } }).result?.isError,
    ).toBe(true);
    expect(await db.note.findUniqueOrThrow({ where: { id: noteBId } })).toMatchObject({
      content: 'Íntegra B',
      userId: fixture.ownerBId,
    });
  });

  it('não persiste evento web quando o publicador recebe job de outro workspace', async () => {
    await expect(
      publishJobEvent(fixture.ownerBId, { jobId: fixture.jobAId, stage: 'indexing' }, {} as never),
    ).rejects.toThrow('não pertence');
    expect(
      await db.jobProgressEvent.count({
        where: { jobId: fixture.jobAId, userId: fixture.ownerBId },
      }),
    ).toBe(0);
  });
});
