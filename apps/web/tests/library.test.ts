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
    await wipeDb();
  });

  afterAll(async () => {
    await wipeDb();
    await db.$disconnect();
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
});
