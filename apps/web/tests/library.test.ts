import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';

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

async function signIn(email: string, password: string): Promise<Response> {
  return app.fetch(
    new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  );
}

function extractCookie(res: Response): string {
  const set = res.headers.get('set-cookie') ?? '';
  return set.split(';')[0] ?? '';
}

describeIfDb('library organization API', () => {
  beforeEach(async () => {
    process.env.S3_DELETE_DISABLED = 'true';
    await wipeDb();
  });

  afterAll(async () => {
    await wipeDb();
    await db.$disconnect();
    delete process.env.S3_DELETE_DISABLED;
  });

  it('requires an authenticated approved user', async () => {
    const res = await app.fetch(new Request('http://localhost/api/library/folders'));
    expect(res.status).toBe(401);
  });

  it('creates folders and assigns transcripts by user scope', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    const user = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });
    const transcript = await db.transcript.create({
      data: {
        userId: user.id,
        source: 'YOUTUBE',
        url: 'https://youtu.be/folders12345',
        title: 'Conteúdo para organizar',
        durationSec: 60,
        language: 'pt',
        transcriptionMethod: 'SUBTITLES',
        mdPath: `workspaces/${user.id}/transcripts/folders12345.md`,
        plainText: 'texto pesquisável',
        frontmatter: {},
      },
    });

    const create = await app.fetch(
      new Request('http://localhost/api/library/folders', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Pesquisa' }),
      }),
    );
    expect(create.status).toBe(201);
    const createBody = (await create.json()) as { folder: { id: string; name: string } };
    expect(createBody.folder.name).toBe('Pesquisa');

    const move = await app.fetch(
      new Request(`http://localhost/api/transcripts/${transcript.id}/organization`, {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ folderId: createBody.folder.id }),
      }),
    );
    expect(move.status).toBe(200);
    const moveBody = (await move.json()) as {
      transcript: { folder: { id: string; name: string } | null };
    };
    expect(moveBody.transcript.folder?.id).toBe(createBody.folder.id);

    const stored = await db.transcript.findUniqueOrThrow({ where: { id: transcript.id } });
    expect(stored.folderId).toBe(createBody.folder.id);
  });

  it('lista e conta um conteúdo em todas as pastas virtuais das suas tags', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    const user = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });
    const [folderA, folderB] = await Promise.all([
      db.libraryFolder.create({ data: { userId: user.id, name: 'Produto' } }),
      db.libraryFolder.create({ data: { userId: user.id, name: 'Pesquisa' } }),
    ]);
    const [tagA, tagB] = await Promise.all([
      db.tag.create({
        data: { userId: user.id, name: 'Produto', slug: 'produto', folderId: folderA.id },
      }),
      db.tag.create({
        data: { userId: user.id, name: 'Pesquisa', slug: 'pesquisa', folderId: folderB.id },
      }),
    ]);
    const transcript = await db.transcript.create({
      data: {
        userId: user.id,
        folderId: folderA.id,
        source: 'WEB',
        url: 'https://example.com/multi-tag',
        title: 'Conteúdo multi-tag',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${user.id}/transcripts/multi-tag.md`,
        plainText: 'produto pesquisa estratégia',
        frontmatter: {},
        tags: { create: [{ tagId: tagA.id }, { tagId: tagB.id }] },
      },
    });

    const list = await app.fetch(
      new Request(`http://localhost/api/transcripts?folderId=${folderB.id}`, {
        headers: { cookie },
      }),
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { transcripts: Array<{ id: string }>; total: number };
    expect(listBody.transcripts.map((item) => item.id)).toContain(transcript.id);
    expect(listBody.total).toBe(1);

    const folders = await app.fetch(
      new Request('http://localhost/api/library/folders', { headers: { cookie } }),
    );
    const body = (await folders.json()) as {
      folders: Array<{ id: string; _count: { transcripts: number } }>;
    };
    expect(body.folders.find((item) => item.id === folderA.id)?._count.transcripts).toBe(1);
    expect(body.folders.find((item) => item.id === folderB.id)?._count.transcripts).toBe(1);
  });

  it('hides trashed transcripts from default library list', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    const user = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });
    const transcript = await db.transcript.create({
      data: {
        userId: user.id,
        source: 'WEB',
        url: 'https://example.com/trash',
        title: 'Conteúdo descartável',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${user.id}/transcripts/trash.md`,
        plainText: 'texto descartável',
        frontmatter: {},
      },
    });

    const trash = await app.fetch(
      new Request(`http://localhost/api/transcripts/${transcript.id}/lifecycle`, {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'TRASH' }),
      }),
    );
    expect(trash.status).toBe(200);

    const list = await app.fetch(
      new Request('http://localhost/api/transcripts', {
        headers: { cookie },
      }),
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { transcripts: { id: string }[] };
    expect(listBody.transcripts).toHaveLength(0);

    const trashed = await db.transcript.findUniqueOrThrow({ where: { id: transcript.id } });
    expect(trashed.status).toBe('TRASH');
    expect(trashed.trashedAt).not.toBeNull();
  });

  it('serves authenticated fallback previews and hides media from other users', async () => {
    await signUp('media-owner@voxen.local', 'senha-super-segura-123', 'Media Owner');
    const signin = await signIn('media-owner@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    const user = await db.user.findUniqueOrThrow({ where: { email: 'media-owner@voxen.local' } });
    const transcript = await db.transcript.create({
      data: {
        userId: user.id,
        source: 'WEB',
        url: 'https://example.com/no-preview',
        title: 'Título sem imagem externa',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${user.id}/transcripts/no-preview.md`,
        plainText: 'texto base',
        frontmatter: {},
      },
    });

    const preview = await app.fetch(
      new Request(`http://localhost/api/transcripts/${transcript.id}/preview`, {
        headers: { cookie },
      }),
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-type')).toContain('image/svg+xml');
    expect(await preview.text()).toContain('Título sem imagem externa');

    const original = await app.fetch(
      new Request(`http://localhost/api/transcripts/${transcript.id}/original`, {
        headers: { cookie },
      }),
    );
    expect(original.status).toBe(404);

    await signUp('media-other@voxen.local', 'senha-super-segura-456', 'Media Other');
    await db.user.update({
      where: { email: 'media-other@voxen.local' },
      data: { status: 'APPROVED' },
    });
    const otherSignin = await signIn('media-other@voxen.local', 'senha-super-segura-456');
    const otherCookie = extractCookie(otherSignin);
    const foreignPreview = await app.fetch(
      new Request(`http://localhost/api/transcripts/${transcript.id}/preview`, {
        headers: { cookie: otherCookie },
      }),
    );
    expect(foreignPreview.status).toBe(404);
  });

  it('requires trash before hard delete and purges transcript records', async () => {
    await signUp('admin@voxen.local', 'senha-super-segura-123', 'Admin');
    const signin = await signIn('admin@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    const user = await db.user.findUniqueOrThrow({ where: { email: 'admin@voxen.local' } });
    const transcript = await db.transcript.create({
      data: {
        userId: user.id,
        source: 'UPLOAD',
        url: 'upload://hard-delete',
        title: 'Conteúdo para apagar',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'DOCUMENT',
        mdPath: `workspaces/${user.id}/transcripts/delete.md`,
        plainText: 'texto para purge',
        frontmatter: {},
      },
    });
    const job = await db.job.create({
      data: {
        userId: user.id,
        type: 'UPLOAD_AND_ANALYZE_DOCUMENT',
        status: 'DONE',
        sourceUrl: transcript.url,
        transcriptId: transcript.id,
      },
    });

    const activeDelete = await app.fetch(
      new Request(`http://localhost/api/transcripts/${transcript.id}`, {
        method: 'DELETE',
        headers: { cookie },
      }),
    );
    expect(activeDelete.status).toBe(409);
    expect(await db.transcript.findUnique({ where: { id: transcript.id } })).not.toBeNull();

    const trash = await app.fetch(
      new Request(`http://localhost/api/transcripts/${transcript.id}/lifecycle`, {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'TRASH' }),
      }),
    );
    expect(trash.status).toBe(200);

    const hardDelete = await app.fetch(
      new Request(`http://localhost/api/transcripts/${transcript.id}`, {
        method: 'DELETE',
        headers: { cookie },
      }),
    );
    expect(hardDelete.status).toBe(200);
    expect(await db.transcript.findUnique({ where: { id: transcript.id } })).toBeNull();
    const retainedJob = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(retainedJob.transcriptId).toBeNull();
  });

  it('creates and lists notes linked to a transcript', async () => {
    await signUp('notes-link@voxen.local', 'senha-super-segura-123', 'Notes Link');
    const signin = await signIn('notes-link@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    const user = await db.user.findUniqueOrThrow({ where: { email: 'notes-link@voxen.local' } });
    const transcript = await db.transcript.create({
      data: {
        userId: user.id,
        source: 'WEB',
        url: 'https://example.com/linked-note',
        title: 'Conteúdo com nota',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${user.id}/transcripts/linked-note.md`,
        plainText: 'texto base',
        frontmatter: {},
      },
    });

    const create = await app.fetch(
      new Request(`http://localhost/api/transcripts/${transcript.id}/notes`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Insight', content: 'Nota vinculada.' }),
      }),
    );

    expect(create.status).toBe(201);
    const createBody = (await create.json()) as { note: { id: string; title: string } };
    expect(createBody.note.title).toBe('Insight');

    const stored = await db.note.findUniqueOrThrow({ where: { id: createBody.note.id } });
    expect(stored.sourceType).toBe('TRANSCRIPT');
    expect(stored.sourceId).toBe(transcript.id);

    const list = await app.fetch(
      new Request(`http://localhost/api/transcripts/${transcript.id}/notes`, {
        headers: { cookie },
      }),
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { notes: { id: string }[] };
    expect(listBody.notes.map((note) => note.id)).toEqual([createBody.note.id]);
  });

  it('rejects linked note creation on a transcript owned by another user', async () => {
    await signUp('notes-owner-a@voxen.local', 'senha-super-segura-123', 'Owner A');
    const signin = await signIn('notes-owner-a@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    await signUp('notes-owner-b@voxen.local', 'senha-super-segura-456', 'Owner B');
    const otherUser = await db.user.findUniqueOrThrow({
      where: { email: 'notes-owner-b@voxen.local' },
    });
    const foreignTranscript = await db.transcript.create({
      data: {
        userId: otherUser.id,
        source: 'WEB',
        url: 'https://example.com/foreign-note',
        title: 'Conteúdo de outro user',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${otherUser.id}/transcripts/foreign-note.md`,
        plainText: 'texto alheio',
        frontmatter: {},
      },
    });

    const create = await app.fetch(
      new Request(`http://localhost/api/transcripts/${foreignTranscript.id}/notes`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Invasão', content: 'Não deveria existir.' }),
      }),
    );
    expect(create.status).toBe(404);

    const list = await app.fetch(
      new Request(`http://localhost/api/transcripts/${foreignTranscript.id}/notes`, {
        headers: { cookie },
      }),
    );
    expect(list.status).toBe(404);

    const stored = await db.note.count({
      where: { sourceType: 'TRANSCRIPT', sourceId: foreignTranscript.id },
    });
    expect(stored).toBe(0);
  });

  it('clears all folders and unfolders transcripts', async () => {
    await signUp('clear-folders@voxen.local', 'senha-super-segura-123', 'Clear Folders');
    const signin = await signIn('clear-folders@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    const user = await db.user.findUniqueOrThrow({ where: { email: 'clear-folders@voxen.local' } });
    const folder = await db.libraryFolder.create({
      data: { userId: user.id, name: 'Lixo Meta' },
    });
    const transcript = await db.transcript.create({
      data: {
        userId: user.id,
        source: 'WEB',
        url: 'https://example.com/clear-folders',
        title: 'Item organizado',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${user.id}/transcripts/clear-folders.md`,
        plainText: 'texto',
        frontmatter: {},
        folderId: folder.id,
      },
    });

    const clear = await app.fetch(
      new Request('http://localhost/api/library/folders/clear', {
        method: 'POST',
        headers: { cookie },
      }),
    );
    expect(clear.status).toBe(200);
    const clearBody = (await clear.json()) as { deleted: number; affectedTranscripts: number };
    expect(clearBody.deleted).toBe(1);
    expect(clearBody.affectedTranscripts).toBe(1);
    expect(await db.libraryFolder.count({ where: { userId: user.id } })).toBe(0);
    const refreshed = await db.transcript.findUniqueOrThrow({ where: { id: transcript.id } });
    expect(refreshed.folderId).toBeNull();
  });

  it('paginates transcript list with limit/offset', async () => {
    await signUp('page-list@voxen.local', 'senha-super-segura-123', 'Page List');
    const signin = await signIn('page-list@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    const user = await db.user.findUniqueOrThrow({ where: { email: 'page-list@voxen.local' } });
    for (let i = 0; i < 5; i++) {
      await db.transcript.create({
        data: {
          userId: user.id,
          source: 'WEB',
          url: `https://example.com/page-${i}`,
          title: `Item ${i}`,
          durationSec: 0,
          language: 'pt',
          transcriptionMethod: 'SCRAPE',
          mdPath: `workspaces/${user.id}/transcripts/page-${i}.md`,
          plainText: `texto ${i}`,
          frontmatter: {},
        },
      });
    }

    const page1 = await app.fetch(
      new Request('http://localhost/api/transcripts?limit=2&offset=0', { headers: { cookie } }),
    );
    expect(page1.status).toBe(200);
    const body1 = (await page1.json()) as {
      transcripts: { id: string }[];
      total: number;
      hasMore: boolean;
    };
    expect(body1.transcripts).toHaveLength(2);
    expect(body1.total).toBe(5);
    expect(body1.hasMore).toBe(true);

    const page2 = await app.fetch(
      new Request('http://localhost/api/transcripts?limit=2&offset=2', { headers: { cookie } }),
    );
    const body2 = (await page2.json()) as { transcripts: { id: string }[]; hasMore: boolean };
    expect(body2.transcripts).toHaveLength(2);
    expect(body2.hasMore).toBe(true);
    expect(body2.transcripts[0]?.id).not.toBe(body1.transcripts[0]?.id);
  });

  it('rejects POST /api/notes linked to a foreign or nonexistent transcript', async () => {
    await signUp('notes-link-a@voxen.local', 'senha-super-segura-123', 'Link A');
    const signin = await signIn('notes-link-a@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    await signUp('notes-link-b@voxen.local', 'senha-super-segura-456', 'Link B');
    const otherUser = await db.user.findUniqueOrThrow({
      where: { email: 'notes-link-b@voxen.local' },
    });
    const foreignTranscript = await db.transcript.create({
      data: {
        userId: otherUser.id,
        source: 'WEB',
        url: 'https://example.com/foreign-link',
        title: 'Conteúdo de outro user',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${otherUser.id}/transcripts/foreign-link.md`,
        plainText: 'texto alheio',
        frontmatter: {},
      },
    });

    const foreign = await app.fetch(
      new Request('http://localhost/api/notes', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Nota intrusa',
          content: 'Vínculo indevido.',
          sourceType: 'TRANSCRIPT',
          sourceId: foreignTranscript.id,
        }),
      }),
    );
    expect(foreign.status).toBe(400);
    const foreignBody = (await foreign.json()) as { error: string };
    expect(foreignBody.error).toBe('Transcrição vinculada não encontrada.');

    const missing = await app.fetch(
      new Request('http://localhost/api/notes', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Nota órfã',
          content: 'Vínculo inexistente.',
          sourceType: 'TRANSCRIPT',
          sourceId: 'transcript-que-nao-existe',
        }),
      }),
    );
    expect(missing.status).toBe(400);

    const stored = await db.note.count({ where: { sourceType: 'TRANSCRIPT' } });
    expect(stored).toBe(0);
  });
});
