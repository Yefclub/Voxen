import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

async function wipeDb(): Promise<void> {
  await db.brainSource.deleteMany();
  await db.brainEdge.deleteMany();
  await db.brainNode.deleteMany();
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

describeIfDb('brain indexer', () => {
  beforeEach(async () => {
    await wipeDb();
  });

  afterAll(async () => {
    await wipeDb();
    await db.$disconnect();
  });

  it('indexes note nodes and wikilinks with source evidence', async () => {
    await signUp('brain@voxen.local', 'senha-super-segura-123', 'Brain User');
    const signin = await signIn('brain@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    const user = await db.user.findUniqueOrThrow({ where: { email: 'brain@voxen.local' } });

    const targetRes = await app.fetch(
      new Request('http://localhost/api/notes', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Projeto Atlas', content: 'Contexto base.' }),
      }),
    );
    expect(targetRes.status).toBe(201);
    const targetBody = (await targetRes.json()) as { note: { id: string } };

    const sourceRes = await app.fetch(
      new Request('http://localhost/api/notes', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Reunião', content: 'Ver [[Projeto Atlas]] hoje.' }),
      }),
    );
    expect(sourceRes.status).toBe(201);
    const sourceBody = (await sourceRes.json()) as { note: { id: string } };

    const sourceNode = await db.brainNode.findUniqueOrThrow({
      where: { userId_key: { userId: user.id, key: `NOTE:${sourceBody.note.id}` } },
    });
    const targetNode = await db.brainNode.findUniqueOrThrow({
      where: { userId_key: { userId: user.id, key: `NOTE:${targetBody.note.id}` } },
    });
    const edge = await db.brainEdge.findFirstOrThrow({
      where: {
        userId: user.id,
        fromNodeId: sourceNode.id,
        toNodeId: targetNode.id,
        kind: 'LINKS_TO',
        method: 'wikilink',
      },
    });
    const evidence = await db.brainSource.findFirstOrThrow({
      where: { userId: user.id, edgeId: edge.id, sourceType: 'NOTE', sourceId: sourceBody.note.id },
    });
    expect(evidence.excerpt).toBe('[[Projeto Atlas]]');
  });

  it('indexes transcript folder edges by user scope', async () => {
    await signUp('library-brain@voxen.local', 'senha-super-segura-123', 'Library Brain');
    const signin = await signIn('library-brain@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    const user = await db.user.findUniqueOrThrow({
      where: { email: 'library-brain@voxen.local' },
    });
    const transcript = await db.transcript.create({
      data: {
        userId: user.id,
        source: 'WEB',
        url: 'https://example.com/brain',
        title: 'Brain indexado',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${user.id}/transcripts/brain.md`,
        plainText: 'conteúdo para o brain',
        frontmatter: {},
      },
    });

    const folderRes = await app.fetch(
      new Request('http://localhost/api/library/folders', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Pesquisa' }),
      }),
    );
    expect(folderRes.status).toBe(201);
    const folderBody = (await folderRes.json()) as { folder: { id: string } };

    const move = await app.fetch(
      new Request(`http://localhost/api/transcripts/${transcript.id}/organization`, {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ folderId: folderBody.folder.id }),
      }),
    );
    expect(move.status).toBe(200);

    const transcriptNode = await db.brainNode.findUniqueOrThrow({
      where: { userId_key: { userId: user.id, key: `TRANSCRIPT:${transcript.id}` } },
    });
    const folderNode = await db.brainNode.findUniqueOrThrow({
      where: { userId_key: { userId: user.id, key: `FOLDER:${folderBody.folder.id}` } },
    });
    const edge = await db.brainEdge.findFirstOrThrow({
      where: {
        userId: user.id,
        fromNodeId: transcriptNode.id,
        toNodeId: folderNode.id,
        kind: 'BELONGS_TO',
        method: 'folder',
      },
    });
    const evidence = await db.brainSource.findFirstOrThrow({
      where: {
        userId: user.id,
        edgeId: edge.id,
        sourceType: 'TRANSCRIPT',
        sourceId: transcript.id,
      },
    });
    expect(evidence.excerpt).toBe('Folder: Pesquisa');
  });

  it('GET /api/graph backfills Brain nodes for legacy content', async () => {
    await signUp('graph-brain@voxen.local', 'senha-super-segura-123', 'Graph Brain');
    const signin = await signIn('graph-brain@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    const user = await db.user.findUniqueOrThrow({ where: { email: 'graph-brain@voxen.local' } });
    const transcript = await db.transcript.create({
      data: {
        userId: user.id,
        source: 'WEB',
        url: 'https://example.com/legacy-graph',
        title: 'Conteúdo legado',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${user.id}/transcripts/legacy-graph.md`,
        plainText: 'texto legado ainda sem brain node',
        frontmatter: {},
      },
    });

    expect(await db.brainNode.count({ where: { userId: user.id } })).toBe(0);

    const graph = await app.fetch(
      new Request('http://localhost/api/graph?force=1', {
        headers: { cookie },
      }),
    );
    expect(graph.status).toBe(200);
    const body = (await graph.json()) as {
      nodes: Array<{ key: string; type: string; sourceType: string; source?: string }>;
    };
    expect(body.nodes).toContainEqual(
      expect.objectContaining({
        key: `TRANSCRIPT:${transcript.id}`,
        type: 'transcript',
        sourceType: 'TRANSCRIPT',
        source: 'WEB',
      }),
    );

    const persisted = await db.brainNode.findUnique({
      where: { userId_key: { userId: user.id, key: `TRANSCRIPT:${transcript.id}` } },
    });
    expect(persisted).not.toBeNull();
  });
});
