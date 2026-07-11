import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { BRAIN_INDEX_VERSION } from '../src/lib/brain';
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
        title: 'Automação de conteúdo legado',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${user.id}/transcripts/legacy-graph.md`,
        plainText: 'Automação automação organiza processos internos e conhecimento operacional.',
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
      nodes: Array<{
        id: string;
        key: string;
        type: string;
        sourceType: string | null;
        source?: string;
      }>;
      edges: Array<{ from: string; to: string; kind: string; method: string }>;
    };
    expect(body.nodes).toContainEqual(
      expect.objectContaining({
        key: `TRANSCRIPT:${transcript.id}`,
        type: 'transcript',
        sourceType: 'TRANSCRIPT',
        source: 'WEB',
      }),
    );
    expect(body.nodes).toContainEqual(
      expect.objectContaining({
        key: 'TOPIC:automacao',
        type: 'topic',
        sourceType: null,
      }),
    );
    const transcriptNode = body.nodes.find((node) => node.key === `TRANSCRIPT:${transcript.id}`);
    const topicNode = body.nodes.find((node) => node.key === 'TOPIC:automacao');
    expect(transcriptNode).toBeDefined();
    expect(topicNode).toBeDefined();
    expect(body.edges).toContainEqual(
      expect.objectContaining({
        from: transcriptNode?.id,
        to: topicNode?.id,
        kind: 'mentions',
        method: 'keyword',
      }),
    );

    const persisted = await db.brainNode.findUnique({
      where: { userId_key: { userId: user.id, key: `TRANSCRIPT:${transcript.id}` } },
    });
    expect(persisted).not.toBeNull();
  });

  it('connects active contents through shared concepts', async () => {
    await signUp('shared-brain@voxen.local', 'senha-super-segura-123', 'Shared Brain');
    const signin = await signIn('shared-brain@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    const user = await db.user.findUniqueOrThrow({ where: { email: 'shared-brain@voxen.local' } });

    const noteRes = await app.fetch(
      new Request('http://localhost/api/notes', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Projeto Atlas',
          content: 'Projeto Atlas usa GraphRAG para conectar memórias do Voxen.',
        }),
      }),
    );
    expect(noteRes.status).toBe(201);
    const noteBody = (await noteRes.json()) as { note: { id: string } };

    const transcript = await db.transcript.create({
      data: {
        userId: user.id,
        source: 'WEB',
        url: 'https://example.com/atlas-graphrag',
        title: 'Projeto Atlas GraphRAG',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${user.id}/transcripts/atlas-graphrag.md`,
        plainText: 'Projeto Atlas conecta memórias, GraphRAG e base de conhecimento.',
        frontmatter: {},
      },
    });

    const graph = await app.fetch(
      new Request('http://localhost/api/graph?force=1', {
        headers: { cookie },
      }),
    );
    expect(graph.status).toBe(200);

    const noteNode = await db.brainNode.findUniqueOrThrow({
      where: { userId_key: { userId: user.id, key: `NOTE:${noteBody.note.id}` } },
    });
    const transcriptNode = await db.brainNode.findUniqueOrThrow({
      where: { userId_key: { userId: user.id, key: `TRANSCRIPT:${transcript.id}` } },
    });
    expect(
      await db.brainNode.findUnique({
        where: { userId_key: { userId: user.id, key: 'ENTITY:projeto-atlas' } },
      }),
    ).not.toBeNull();

    const related = await db.brainEdge.findFirst({
      where: {
        userId: user.id,
        kind: 'RELATED_TO',
        method: 'shared-concepts',
        OR: [
          { fromNodeId: noteNode.id, toNodeId: transcriptNode.id },
          { fromNodeId: transcriptNode.id, toNodeId: noteNode.id },
        ],
      },
    });
    expect(related).not.toBeNull();
    const evidence = await db.brainSource.findFirst({
      where: {
        userId: user.id,
        edgeId: related?.id,
        sourceType: 'TRANSCRIPT',
        sourceId: transcript.id,
      },
    });
    expect(evidence?.excerpt).toContain('Conceitos em comum');
  });

  it('connects content by semantic profile and timeline without exact concept overlap', async () => {
    await signUp('semantic-brain@voxen.local', 'senha-super-segura-123', 'Semantic Brain');
    const signin = await signIn('semantic-brain@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    const user = await db.user.findUniqueOrThrow({
      where: { email: 'semantic-brain@voxen.local' },
    });

    const first = await db.transcript.create({
      data: {
        userId: user.id,
        source: 'YOUTUBE',
        url: 'https://youtu.be/alpha-memory',
        title: 'Circuito Azul',
        channel: 'Canal A',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${user.id}/transcripts/alpha-memory.md`,
        plainText: 'Rotor celeste calibra mapa discreto.',
        frontmatter: {},
      },
    });
    const second = await db.transcript.create({
      data: {
        userId: user.id,
        source: 'YOUTUBE',
        url: 'https://youtu.be/beta-memory',
        title: 'Ponte Laranja',
        channel: 'Canal B',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${user.id}/transcripts/beta-memory.md`,
        plainText: 'Saturno dorsal organiza trilha silenciosa.',
        frontmatter: {},
      },
    });

    const graph = await app.fetch(
      new Request('http://localhost/api/graph?force=1', {
        headers: { cookie },
      }),
    );
    expect(graph.status).toBe(200);

    const firstNode = await db.brainNode.findUniqueOrThrow({
      where: { userId_key: { userId: user.id, key: `TRANSCRIPT:${first.id}` } },
    });
    const secondNode = await db.brainNode.findUniqueOrThrow({
      where: { userId_key: { userId: user.id, key: `TRANSCRIPT:${second.id}` } },
    });

    const semantic = await db.brainEdge.findFirst({
      where: {
        userId: user.id,
        kind: 'RELATED_TO',
        method: 'semantic-profile',
        OR: [
          { fromNodeId: firstNode.id, toNodeId: secondNode.id },
          { fromNodeId: secondNode.id, toNodeId: firstNode.id },
        ],
      },
    });
    expect(semantic).not.toBeNull();
    expect((semantic?.metadata as { reasons?: Array<{ kind: string }> }).reasons).toContainEqual(
      expect.objectContaining({ kind: 'domain' }),
    );

    const timeline = await db.brainEdge.findFirst({
      where: {
        userId: user.id,
        kind: 'NEXT_TO',
        method: 'timeline-adjacent',
        OR: [
          { fromNodeId: firstNode.id, toNodeId: secondNode.id },
          { fromNodeId: secondNode.id, toNodeId: firstNode.id },
        ],
      },
    });
    expect(timeline).not.toBeNull();
  });

  it('reindexes stale Brain source nodes on graph load', async () => {
    await signUp('stale-brain@voxen.local', 'senha-super-segura-123', 'Stale Brain');
    const signin = await signIn('stale-brain@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    const user = await db.user.findUniqueOrThrow({ where: { email: 'stale-brain@voxen.local' } });

    const noteRes = await app.fetch(
      new Request('http://localhost/api/notes', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Memória stale',
          content: 'Projeto Atlas precisa ser reindexado automaticamente.',
        }),
      }),
    );
    expect(noteRes.status).toBe(201);
    const noteBody = (await noteRes.json()) as { note: { id: string } };

    await db.brainNode.update({
      where: { userId_key: { userId: user.id, key: `NOTE:${noteBody.note.id}` } },
      data: { metadata: { brainIndexVersion: 1 } },
    });

    const graph = await app.fetch(
      new Request('http://localhost/api/graph', { headers: { cookie } }),
    );
    expect(graph.status).toBe(200);

    const node = await db.brainNode.findUniqueOrThrow({
      where: { userId_key: { userId: user.id, key: `NOTE:${noteBody.note.id}` } },
    });
    expect((node.metadata as { brainIndexVersion?: number }).brainIndexVersion).toBe(
      BRAIN_INDEX_VERSION,
    );
  });

  it('removes automatic topic nodes when transcript leaves the active graph', async () => {
    await signUp('graph-removal@voxen.local', 'senha-super-segura-123', 'Graph Removal');
    const signin = await signIn('graph-removal@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    const user = await db.user.findUniqueOrThrow({
      where: { email: 'graph-removal@voxen.local' },
    });
    const transcript = await db.transcript.create({
      data: {
        userId: user.id,
        source: 'WEB',
        url: 'https://example.com/removal-graph',
        title: 'Automação removível',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${user.id}/transcripts/removal-graph.md`,
        plainText: 'Automação automação aparece no grafo e depois sai.',
        frontmatter: {},
      },
    });

    const graph = await app.fetch(
      new Request('http://localhost/api/graph?force=1', {
        headers: { cookie },
      }),
    );
    expect(graph.status).toBe(200);
    expect(
      await db.brainNode.findUnique({
        where: { userId_key: { userId: user.id, key: 'TOPIC:automacao' } },
      }),
    ).not.toBeNull();

    // O cleanup de nós-conceito órfãos tem grace de 2 min (evita apagar um nó
    // recém-criado no meio de uma reconciliação concorrente). Envelhece o nó
    // automático para simular esse tempo e exercitar a remoção de fato.
    await db.brainNode.updateMany({
      where: { userId: user.id, sourceType: null },
      data: { updatedAt: new Date(Date.now() - 3 * 60 * 1000) },
    });

    const trash = await app.fetch(
      new Request(`http://localhost/api/transcripts/${transcript.id}/lifecycle`, {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'TRASH' }),
      }),
    );
    expect(trash.status).toBe(200);
    expect(
      await db.brainNode.findUnique({
        where: { userId_key: { userId: user.id, key: 'TOPIC:automacao' } },
      }),
    ).toBeNull();
    expect(await db.brainEdge.count({ where: { userId: user.id, method: 'keyword' } })).toBe(0);
  });
});
