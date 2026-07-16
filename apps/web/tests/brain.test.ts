import { afterAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import app from '../src/index';
import {
  BRAIN_INDEX_VERSION,
  BRAIN_TOPIC_INDEX_VERSION,
  deleteBrainForSource,
  reindexLibraryFolderBrain,
  reindexNoteBrain,
  reindexTranscriptBrain,
} from '../src/lib/brain';
import { db } from '../src/lib/db';
import { acquireGraphIndexLease, releaseGraphIndexLease } from '../src/lib/graph-index-coordinator';

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

interface GraphTestResponse {
  indexing: boolean;
  nodes: Array<{
    id: string;
    key: string;
    type: string;
    sourceType: string | null;
    source?: string;
  }>;
  edges: Array<{ from: string; to: string; kind: string; method: string }>;
}

async function waitForGraphReindex(cookie: string, force = true): Promise<GraphTestResponse> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const query = attempt === 0 && force ? 'force=1' : `refresh=1&t=${attempt}`;
    const response = await app.fetch(
      new Request(`http://localhost/api/graph?${query}`, { headers: { cookie } }),
    );
    if (response.status !== 200) throw new Error(`Graph respondeu ${response.status}`);
    const body = (await response.json()) as GraphTestResponse;
    if (!body.indexing) return body;
    await Bun.sleep(25);
  }
  throw new Error('Reindex do Brain não terminou dentro do timeout do teste.');
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
    const metadata = transcriptNode.metadata as {
      brainIndexVersion?: number;
      topicIndexVersion?: number;
    };
    expect(metadata.brainIndexVersion).toBe(BRAIN_INDEX_VERSION);
    expect(metadata.topicIndexVersion).toBe(BRAIN_TOPIC_INDEX_VERSION);
  });

  it('leaves transcript completion markers absent when finalization fails', async () => {
    await signUp('brain-finalization@voxen.local', 'senha-super-segura-123', 'Brain Finalization');
    const user = await db.user.findUniqueOrThrow({
      where: { email: 'brain-finalization@voxen.local' },
    });
    const transcript = await db.transcript.create({
      data: {
        userId: user.id,
        source: 'WEB',
        url: 'https://example.com/brain-finalization',
        title: 'Finalização segura do Brain',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${user.id}/transcripts/brain-finalization.md`,
        plainText: 'Grafo semântico precisa concluir conceitos e conexões antes de finalizar.',
        frontmatter: {},
      },
    });

    const workerMetadata = JSON.stringify({ workerTopicExtractor: 'keyword-v1' });
    await reindexTranscriptBrain(user.id, transcript.id, {
      beforeFinalize: async () => {
        await db.$executeRaw`
          UPDATE "BrainNode"
          SET metadata = metadata || ${workerMetadata}::jsonb
          WHERE "userId" = ${user.id}
            AND key = ${`TRANSCRIPT:${transcript.id}`}
        `;
      },
    });
    const completed = await db.brainNode.findUniqueOrThrow({
      where: { userId_key: { userId: user.id, key: `TRANSCRIPT:${transcript.id}` } },
    });
    const completedMetadata = completed.metadata as {
      brainIndexVersion?: number;
      topicIndexVersion?: number;
      workerTopicExtractor?: string;
    };
    expect(completedMetadata.brainIndexVersion).toBe(BRAIN_INDEX_VERSION);
    expect(completedMetadata.topicIndexVersion).toBe(BRAIN_TOPIC_INDEX_VERSION);
    expect(completedMetadata.workerTopicExtractor).toBe('keyword-v1');

    let leaseOwned = true;
    let failure: unknown;
    try {
      await reindexTranscriptBrain(user.id, transcript.id, {
        beforeFinalize: () => {
          leaseOwned = false;
        },
        assertLeaseOwnership: async () => {
          if (!leaseOwned) throw new Error('lease-lost-inside-item');
        },
      });
    } catch (err) {
      failure = err;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('lease-lost-inside-item');

    const incomplete = await db.brainNode.findUniqueOrThrow({
      where: { userId_key: { userId: user.id, key: `TRANSCRIPT:${transcript.id}` } },
    });
    const metadata = incomplete.metadata as {
      brainIndexVersion?: number;
      topicIndexVersion?: number;
      semanticProfile?: unknown;
      workerTopicExtractor?: string;
    };
    expect(metadata.semanticProfile).toBeDefined();
    expect(metadata.workerTopicExtractor).toBe('keyword-v1');
    expect(metadata.brainIndexVersion).toBeUndefined();
    expect(metadata.topicIndexVersion).toBeUndefined();
  });

  it('leaves transcript markers absent after a real folder edge FK race', async () => {
    await signUp('brain-edge-race@voxen.local', 'senha-super-segura-123', 'Brain Edge Race');
    const user = await db.user.findUniqueOrThrow({
      where: { email: 'brain-edge-race@voxen.local' },
    });
    const folder = await db.libraryFolder.create({
      data: { userId: user.id, name: 'Pasta removida durante a aresta' },
    });
    const transcript = await db.transcript.create({
      data: {
        userId: user.id,
        folderId: folder.id,
        source: 'WEB',
        url: 'https://example.com/brain-edge-race',
        title: 'Corrida de FK do Brain',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${user.id}/transcripts/brain-edge-race.md`,
        plainText: 'Conteúdo com pasta e conceitos para materialização completa.',
        frontmatter: {},
      },
    });
    await reindexTranscriptBrain(user.id, transcript.id);
    const folderNode = await db.brainNode.findUniqueOrThrow({
      where: { userId_key: { userId: user.id, key: `FOLDER:${folder.id}` } },
    });

    const realUpsert = db.brainEdge.upsert.bind(db.brainEdge);
    const injectFkRace = async (args: Parameters<typeof realUpsert>[0]) => {
      await db.brainNode.delete({ where: { id: folderNode.id } });
      return realUpsert(args);
    };
    const edgeUpsert = spyOn(db.brainEdge, 'upsert').mockImplementationOnce(injectFkRace as never);
    let failure: unknown;
    try {
      await reindexTranscriptBrain(user.id, transcript.id);
    } catch (err) {
      failure = err;
    } finally {
      edgeUpsert.mockRestore();
    }

    expect(failure).toBeInstanceOf(Error);
    const incomplete = await db.brainNode.findUniqueOrThrow({
      where: { userId_key: { userId: user.id, key: `TRANSCRIPT:${transcript.id}` } },
    });
    const metadata = incomplete.metadata as {
      brainIndexVersion?: number;
      topicIndexVersion?: number;
    };
    expect(metadata.brainIndexVersion).toBeUndefined();
    expect(metadata.topicIndexVersion).toBeUndefined();
  });

  it('stops shared-concept linking after lease loss and leaves completion markers absent', async () => {
    await signUp('brain-shared-loop@voxen.local', 'senha-super-segura-123', 'Shared Loop');
    const user = await db.user.findUniqueOrThrow({
      where: { email: 'brain-shared-loop@voxen.local' },
    });
    const first = await db.transcript.create({
      data: {
        userId: user.id,
        source: 'WEB',
        url: 'https://example.com/shared-loop-first',
        title: 'Projeto Atlas origem',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${user.id}/transcripts/shared-loop-first.md`,
        plainText: 'Projeto Atlas usa GraphRAG para conectar memorias e conhecimento.',
        frontmatter: {},
      },
    });
    const second = await db.transcript.create({
      data: {
        userId: user.id,
        source: 'WEB',
        url: 'https://example.com/shared-loop-second',
        title: 'Projeto Atlas destino',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${user.id}/transcripts/shared-loop-second.md`,
        plainText: 'Projeto Atlas aplica GraphRAG em memorias e conhecimento.',
        frontmatter: {},
      },
    });
    await reindexTranscriptBrain(user.id, first.id);

    let leaseOwned = true;
    let sharedQueryObserved = false;
    const realFindMany = db.brainEdge.findMany.bind(db.brainEdge);
    const loseLeaseAfterSharedQuery = async (args: Parameters<typeof realFindMany>[0]) => {
      const rows = await realFindMany(args);
      sharedQueryObserved = true;
      leaseOwned = false;
      return rows;
    };
    const edgeFindMany = spyOn(db.brainEdge, 'findMany').mockImplementationOnce(
      loseLeaseAfterSharedQuery as never,
    );
    let failure: unknown;
    try {
      await reindexTranscriptBrain(user.id, second.id, {
        assertLeaseOwnership: async () => {
          if (!leaseOwned) throw new Error('lease-lost-after-shared-query');
        },
      });
    } catch (err) {
      failure = err;
    } finally {
      edgeFindMany.mockRestore();
    }

    expect(sharedQueryObserved).toBe(true);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('lease-lost-after-shared-query');
    const incomplete = await db.brainNode.findUniqueOrThrow({
      where: { userId_key: { userId: user.id, key: `TRANSCRIPT:${second.id}` } },
    });
    const metadata = incomplete.metadata as {
      brainIndexVersion?: number;
      topicIndexVersion?: number;
    };
    expect(metadata.brainIndexVersion).toBeUndefined();
    expect(metadata.topicIndexVersion).toBeUndefined();
    expect(
      await db.brainEdge.count({
        where: {
          userId: user.id,
          method: 'shared-concepts',
          OR: [{ fromNodeId: incomplete.id }, { toNodeId: incomplete.id }],
        },
      }),
    ).toBe(0);
  });

  it('does not let a direct web reindex mutate while the worker owns the shared lease', async () => {
    await signUp('brain-shared-lease@voxen.local', 'senha-super-segura-123', 'Shared Lease');
    const user = await db.user.findUniqueOrThrow({
      where: { email: 'brain-shared-lease@voxen.local' },
    });
    const transcript = await db.transcript.create({
      data: {
        userId: user.id,
        source: 'WEB',
        url: 'https://example.com/brain-shared-lease',
        title: 'Lease compartilhado',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${user.id}/transcripts/brain-shared-lease.md`,
        plainText: 'Worker e web não podem materializar o Brain ao mesmo tempo.',
        frontmatter: {},
      },
    });
    const workerOwner = 'worker:test-shared-owner';
    expect(await acquireGraphIndexLease(user.id, workerOwner)).toBe(true);
    try {
      await reindexTranscriptBrain(user.id, transcript.id);
      expect(
        await db.brainNode.findUnique({
          where: { userId_key: { userId: user.id, key: `TRANSCRIPT:${transcript.id}` } },
        }),
      ).toBeNull();
    } finally {
      await releaseGraphIndexLease(user.id, workerOwner);
    }

    await reindexTranscriptBrain(user.id, transcript.id);
    const completed = await db.brainNode.findUniqueOrThrow({
      where: { userId_key: { userId: user.id, key: `TRANSCRIPT:${transcript.id}` } },
    });
    expect((completed.metadata as { brainIndexVersion?: number }).brainIndexVersion).toBe(
      BRAIN_INDEX_VERSION,
    );
  });

  it('does not give auxiliary note and folder nodes false completion markers', async () => {
    await signUp('brain-auxiliary@voxen.local', 'senha-super-segura-123', 'Brain Auxiliary');
    const user = await db.user.findUniqueOrThrow({
      where: { email: 'brain-auxiliary@voxen.local' },
    });
    const target = await db.note.create({
      data: {
        userId: user.id,
        kind: 'NOTE',
        title: 'Nota auxiliar',
        content: 'Conteúdo ainda não indexado diretamente.',
      },
    });
    const source = await db.note.create({
      data: {
        userId: user.id,
        kind: 'NOTE',
        title: 'Nota principal',
        content: 'Conecta com [[Nota auxiliar]].',
      },
    });
    const folder = await db.libraryFolder.create({
      data: { userId: user.id, name: 'Pasta auxiliar' },
    });
    const transcript = await db.transcript.create({
      data: {
        userId: user.id,
        folderId: folder.id,
        source: 'WEB',
        url: 'https://example.com/brain-auxiliary',
        title: 'Transcrição com pasta auxiliar',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${user.id}/transcripts/brain-auxiliary.md`,
        plainText: 'Conteúdo ligado a uma pasta ainda não indexada diretamente.',
        frontmatter: {},
      },
    });

    await reindexNoteBrain(user.id, source.id);
    await reindexTranscriptBrain(user.id, transcript.id);

    const auxiliaryNote = await db.brainNode.findUniqueOrThrow({
      where: { userId_key: { userId: user.id, key: `NOTE:${target.id}` } },
    });
    const auxiliaryFolder = await db.brainNode.findUniqueOrThrow({
      where: { userId_key: { userId: user.id, key: `FOLDER:${folder.id}` } },
    });
    expect(
      (auxiliaryNote.metadata as { brainIndexVersion?: number }).brainIndexVersion,
    ).toBeUndefined();
    expect(
      (auxiliaryFolder.metadata as { brainIndexVersion?: number }).brainIndexVersion,
    ).toBeUndefined();

    await reindexNoteBrain(user.id, target.id);
    await reindexLibraryFolderBrain(user.id, folder.id);

    const completedNote = await db.brainNode.findUniqueOrThrow({
      where: { userId_key: { userId: user.id, key: `NOTE:${target.id}` } },
    });
    const completedFolder = await db.brainNode.findUniqueOrThrow({
      where: { userId_key: { userId: user.id, key: `FOLDER:${folder.id}` } },
    });
    expect((completedNote.metadata as { brainIndexVersion?: number }).brainIndexVersion).toBe(
      BRAIN_INDEX_VERSION,
    );
    expect((completedFolder.metadata as { brainIndexVersion?: number }).brainIndexVersion).toBe(
      BRAIN_INDEX_VERSION,
    );
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

    const body = await waitForGraphReindex(cookie);
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

    await waitForGraphReindex(cookie);

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

    await waitForGraphReindex(cookie);

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

    const sourceUpdatedAt = new Date(Date.now() + 1_000);
    await db.note.update({
      where: { id: noteBody.note.id },
      data: {
        title: 'Memória stale atualizada',
        content: 'A fonte mudou sem conseguir executar o reindex direto.',
        updatedAt: sourceUpdatedAt,
      },
    });

    await waitForGraphReindex(cookie, false);

    const node = await db.brainNode.findUniqueOrThrow({
      where: { userId_key: { userId: user.id, key: `NOTE:${noteBody.note.id}` } },
    });
    expect(node.label).toBe('Memória stale atualizada');
    expect((node.metadata as { brainIndexVersion?: number }).brainIndexVersion).toBe(
      BRAIN_INDEX_VERSION,
    );
    expect((node.metadata as { updatedAt?: string }).updatedAt).toBe(sourceUpdatedAt.toISOString());
  });

  it('cleans an orphan source node after a post-commit delete misses the busy lease', async () => {
    await signUp('orphan-brain@voxen.local', 'senha-super-segura-123', 'Orphan Brain');
    const signin = await signIn('orphan-brain@voxen.local', 'senha-super-segura-123');
    const cookie = extractCookie(signin);
    const user = await db.user.findUniqueOrThrow({ where: { email: 'orphan-brain@voxen.local' } });
    const transcript = await db.transcript.create({
      data: {
        userId: user.id,
        source: 'WEB',
        url: 'https://example.com/orphan-brain',
        title: 'Fonte removida com lease ocupado',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${user.id}/transcripts/orphan-brain.md`,
        plainText: 'O full pass precisa remover o nórfão depois.',
        frontmatter: {},
      },
    });
    await reindexTranscriptBrain(user.id, transcript.id);

    const workerOwner = 'worker:test-orphan-delete';
    expect(await acquireGraphIndexLease(user.id, workerOwner)).toBe(true);
    try {
      await db.transcript.delete({ where: { id: transcript.id } });
      await deleteBrainForSource(user.id, 'TRANSCRIPT', transcript.id);
      expect(
        await db.brainNode.findUnique({
          where: { userId_key: { userId: user.id, key: `TRANSCRIPT:${transcript.id}` } },
        }),
      ).not.toBeNull();
    } finally {
      await releaseGraphIndexLease(user.id, workerOwner);
    }

    await waitForGraphReindex(cookie, false);
    expect(
      await db.brainNode.findUnique({
        where: { userId_key: { userId: user.id, key: `TRANSCRIPT:${transcript.id}` } },
      }),
    ).toBeNull();
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

    await waitForGraphReindex(cookie);
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
