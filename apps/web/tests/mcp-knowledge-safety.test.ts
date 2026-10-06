import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { createMcpToken } from '../src/lib/mcp-tokens';
import { keepCurrentOwnedSources } from '../src/routes/mcp-brain-source-lifecycle';

type Path = {
  fromNodeId: string;
  toNodeId: string;
  depth: number;
  nodeIds: string[];
  edges: Array<{ id: string; reversed: boolean }>;
};
type Reply<T> = { isError?: boolean; structuredContent?: T };

describe.skipIf(!process.env.DATABASE_URL)('MCP current knowledge', () => {
  let ownerId = '';
  let foreignId = '';
  let token = '';
  let sequence = 0;

  async function tool<T>(name: string, args: Record<string, unknown>): Promise<Reply<T>> {
    const response = await app.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-11-25',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: ++sequence,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      }),
    );
    expect(response.status).toBe(200);
    const reply = (await response.json()) as { result?: Reply<T> };
    expect(reply.result).toBeDefined();
    return reply.result!;
  }

  beforeAll(async () => {
    for (const name of ['owner', 'foreign']) {
      const user = await db.user.create({
        data: {
          email: `mcp-safety-${name}-${crypto.randomUUID()}@example.test`,
          name,
          status: 'APPROVED',
        },
      });
      if (name === 'owner') ownerId = user.id;
      else foreignId = user.id;
    }
    token = (
      await createMcpToken({
        userId: ownerId,
        label: 'Safety tests',
        scopes: ['READ'],
        expiresAt: null,
      })
    ).token;
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: [ownerId, foreignId] } } });
    await db.$disconnect();
  });

  test.each([
    [1, false],
    [1, true],
    [2, false],
    [2, true],
    [3, false],
    [3, true],
  ] as const)('preserves endpoints at depth %s with reversed=%s', async (depth, reversed) => {
    const nodes = await Promise.all(
      Array.from({ length: depth + 1 }, (_, index) =>
        db.brainNode.create({
          data: {
            userId: ownerId,
            key: `TOPIC:${crypto.randomUUID()}`,
            type: 'TOPIC',
            label: `N${index}`,
          },
        }),
      ),
    );
    for (let index = 0; index < depth; index++) {
      await db.brainEdge.create({
        data: {
          userId: ownerId,
          fromNodeId: nodes[reversed ? index + 1 : index]!.id,
          toNodeId: nodes[reversed ? index : index + 1]!.id,
          kind: 'RELATED_TO',
          confidence: 1,
          method: 'fixture',
        },
      });
    }
    const reply = await tool<{ paths: Path[] }>('voxen_brain_path', {
      from_node_id: nodes[0]!.id,
      to_node_id: nodes[depth]!.id,
      max_depth: depth,
    });
    const path = reply.structuredContent!.paths[0]!;
    expect(path.fromNodeId).toBe(nodes[0]!.id);
    expect(path.toNodeId).toBe(nodes[depth]!.id);
    expect(path.nodeIds).toEqual(nodes.map((node) => node.id));
    expect(path.edges.map((edge) => edge.reversed)).toEqual(Array(depth).fill(reversed));
    expect(path.depth).toBe(depth);
  });

  test('does not treat a cyclic walk as a path', async () => {
    const node = await db.brainNode.create({
      data: { userId: ownerId, key: `TOPIC:${crypto.randomUUID()}`, type: 'TOPIC', label: 'Self' },
    });
    await db.brainEdge.create({
      data: {
        userId: ownerId,
        fromNodeId: node.id,
        toNodeId: node.id,
        kind: 'RELATED_TO',
        confidence: 1,
        method: 'fixture',
      },
    });
    const reply = await tool<{ paths: Path[] }>('voxen_brain_path', {
      from_node_id: node.id,
      to_node_id: node.id,
    });
    expect(reply.structuredContent!.paths).toEqual([]);
  });

  test('bounds parallel paths and excludes a foreign endpoint', async () => {
    const nodes = await Promise.all(
      [ownerId, ownerId, foreignId].map((userId) =>
        db.brainNode.create({
          data: { userId, key: `TOPIC:${crypto.randomUUID()}`, type: 'TOPIC', label: 'Parallel' },
        }),
      ),
    );
    await db.brainEdge.createMany({
      data: Array.from({ length: 20 }, (_, index) => ({
        userId: ownerId,
        fromNodeId: nodes[0]!.id,
        toNodeId: nodes[1]!.id,
        kind: 'RELATED_TO' as const,
        confidence: 1,
        method: `parallel-${index}`,
      })),
    });
    const reply = await tool<{ paths: Path[] }>('voxen_brain_path', {
      from_node_id: nodes[0]!.id,
      to_node_id: nodes[1]!.id,
      max_depth: 1,
    });
    expect(reply.structuredContent!.paths).toHaveLength(15);
    expect(reply.structuredContent!.paths.every((path) => path.edges[0]!.reversed === false)).toBe(
      true,
    );
    const foreign = await tool<{ paths: Path[] }>('voxen_brain_path', {
      from_node_id: nodes[0]!.id,
      to_node_id: nodes[2]!.id,
    });
    expect(foreign.structuredContent!.paths).toEqual([]);
  });

  test('archived queries omit trash and foreign nodes', async () => {
    const label = `Lifecycle-${crypto.randomUUID()}`;
    const nodes = await Promise.all(
      (['ACTIVE', 'ARCHIVED', 'TRASH'] as const).map((status) =>
        db.brainNode.create({
          data: {
            userId: ownerId,
            key: `TOPIC:${crypto.randomUUID()}`,
            type: 'TOPIC',
            label,
            status,
          },
        }),
      ),
    );
    await db.brainNode.create({
      data: { userId: foreignId, key: `TOPIC:${crypto.randomUUID()}`, type: 'TOPIC', label },
    });
    const reply = await tool<{ results: Array<{ id: string }> }>('voxen_brain_search', {
      query: label,
      include_archived: true,
    });
    expect(reply.structuredContent!.results.map((node) => node.id).sort()).toEqual(
      nodes
        .slice(0, 2)
        .map((node) => node.id)
        .sort(),
    );
    const trash = await tool('voxen_brain_neighbors', {
      node_id: nodes[2]!.id,
      include_archived: true,
    });
    expect(trash.isError).toBe(true);
  });

  async function researchFixture() {
    const transcript = await db.transcript.create({
      data: {
        userId: ownerId,
        source: 'WEB',
        url: `https://example.test/${crypto.randomUUID()}`,
        title: 'Research source',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath: 'safety.md',
        plainText: 'Source',
        frontmatter: {},
        sourceVersion: 2,
        sourceChecksum: 'current',
      },
    });
    const research = await db.transcriptEnrichment.create({
      data: {
        userId: ownerId,
        transcriptId: transcript.id,
        runKey: crypto.randomUUID(),
        trigger: 'MCP',
        status: 'READY',
        reviewState: 'ACCEPTED',
        title: 'Research',
        content: 'Earlier source',
        sourceVersion: 1,
        sourceChecksum: 'old',
      },
    });
    const node = await db.brainNode.create({
      data: {
        userId: ownerId,
        key: `EXTERNAL_ENRICHMENT:${research.id}`,
        type: 'CONTENT',
        label: 'Research node',
        sourceType: 'EXTERNAL_ENRICHMENT',
        sourceId: research.id,
      },
    });
    const evidence = await db.brainSource.create({
      data: {
        userId: ownerId,
        nodeId: node.id,
        sourceType: 'EXTERNAL_ENRICHMENT',
        sourceId: research.id,
        excerpt: 'Outdated evidence',
      },
    });
    return { transcript, research, node, evidence };
  }

  test('omits research evidence when its source version is stale', async () => {
    const { node } = await researchFixture();
    const reply = await tool<{ sources: unknown[] }>('voxen_brain_sources', { ref: node.id });
    expect(reply.structuredContent!.sources).toEqual([]);
  });

  test('read-only research reports freshness without changing records or projections', async () => {
    const { transcript, research, node } = await researchFixture();
    const listed = await tool<{ enrichments: Array<{ id: string; staleReason: string | null }> }>(
      'voxen_list_transcript_enrichments',
      { transcript_id: transcript.id },
    );
    expect(listed.structuredContent!.enrichments[0]!.staleReason).toBe('source-version-changed');
    const read = await tool<{ enrichment: { staleReason: string | null } }>(
      'voxen_read_transcript_enrichment',
      { enrichment_id: research.id },
    );
    expect(read.structuredContent!.enrichment.staleReason).toBe('source-version-changed');
    expect(await db.transcriptEnrichment.findUnique({ where: { id: research.id } })).toEqual(
      research,
    );
    expect(await db.brainNode.count({ where: { id: node.id } })).toBe(1);
  });

  test('research attached to trash is unavailable', async () => {
    const { transcript, research } = await researchFixture();
    await db.transcript.update({ where: { id: transcript.id }, data: { status: 'TRASH' } });
    const reply = await tool('voxen_read_transcript_enrichment', { enrichment_id: research.id });
    expect(reply.isError).toBe(true);
  });

  test('validates note ownership and research freshness before retaining evidence', async () => {
    const note = await db.note.create({ data: { userId: ownerId, title: 'Owned note' } });
    const foreign = await db.note.create({ data: { userId: foreignId, title: 'Foreign note' } });
    const { transcript, research } = await researchFixture();
    const inputs = [
      { sourceType: 'NOTE' as const, sourceId: note.id },
      { sourceType: 'NOTE' as const, sourceId: foreign.id },
      { sourceType: 'NOTE' as const, sourceId: 'missing' },
      { sourceType: 'EXTERNAL_ENRICHMENT' as const, sourceId: research.id },
    ];
    expect(await keepCurrentOwnedSources(ownerId, inputs)).toEqual([inputs[0]!]);
    await db.transcriptEnrichment.update({
      where: { id: research.id },
      data: { sourceVersion: transcript.sourceVersion, sourceChecksum: transcript.sourceChecksum },
    });
    expect(await keepCurrentOwnedSources(ownerId, inputs)).toEqual([inputs[0]!, inputs[3]!]);
    await db.transcriptEnrichment.update({
      where: { id: research.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await keepCurrentOwnedSources(ownerId, inputs)).toEqual([inputs[0]!]);
  });

  test('keeps canonical NOTE folder projections accessible across Brain tools', async () => {
    const folder = await db.note.create({
      data: { userId: ownerId, kind: 'FOLDER', title: `Folder ${crypto.randomUUID()}` },
    });
    const node = await db.brainNode.create({
      data: {
        userId: ownerId,
        key: `NOTE:${folder.id}`,
        type: 'FOLDER',
        label: folder.title,
        sourceType: 'NOTE',
        sourceId: folder.id,
      },
    });
    const topic = await db.brainNode.create({
      data: {
        userId: ownerId,
        key: `TOPIC:${crypto.randomUUID()}`,
        type: 'TOPIC',
        label: 'Folder topic',
      },
    });
    const edge = await db.brainEdge.create({
      data: {
        userId: ownerId,
        fromNodeId: node.id,
        toNodeId: topic.id,
        kind: 'RELATED_TO',
        confidence: 1,
        method: 'fixture',
      },
    });
    const source = await db.brainSource.create({
      data: {
        userId: ownerId,
        nodeId: node.id,
        sourceType: 'NOTE',
        sourceId: folder.id,
        excerpt: folder.title,
      },
    });
    const search = await tool<{ results: Array<{ id: string }> }>('voxen_brain_search', {
      query: folder.title,
    });
    expect(search.structuredContent!.results.map((item) => item.id)).toContain(node.id);
    const neighbors = await tool<{ edges: Array<{ id: string }> }>('voxen_brain_neighbors', {
      node_id: node.id,
    });
    expect(neighbors.structuredContent!.edges.map((item) => item.id)).toContain(edge.id);
    const paths = await tool<{ paths: Path[] }>('voxen_brain_path', {
      from_node_id: node.id,
      to_node_id: topic.id,
    });
    expect(paths.structuredContent!.paths[0]!.nodeIds).toEqual([node.id, topic.id]);
    const hubs = await tool<{ hubs: Array<{ id: string }> }>('voxen_brain_hubs', { limit: 30 });
    expect(hubs.structuredContent!.hubs.map((item) => item.id)).toContain(node.id);
    const sources = await tool<{ sources: Array<{ id: string }> }>('voxen_brain_sources', {
      ref: node.id,
    });
    expect(sources.structuredContent!.sources.map((item) => item.id)).toContain(source.id);
  });

  test('retains existing owned folders, completed jobs and unarchived conversations', async () => {
    const noteFolder = await db.note.create({
      data: { userId: ownerId, kind: 'FOLDER', title: 'Note folder' },
    });
    const libraryFolder = await db.libraryFolder.create({
      data: { userId: ownerId, name: 'Library folder' },
    });
    const job = await db.job.create({
      data: {
        userId: ownerId,
        type: 'SCRAPE_WEB',
        status: 'DONE',
        sourceUrl: 'https://example.test/finished',
      },
    });
    const conversation = await db.conversation.create({ data: { userId: ownerId } });
    const inputs = [
      { sourceType: 'FOLDER' as const, sourceId: noteFolder.id },
      { sourceType: 'FOLDER' as const, sourceId: libraryFolder.id },
      { sourceType: 'JOB' as const, sourceId: job.id },
      { sourceType: 'CHAT' as const, sourceId: conversation.id },
    ];
    expect(await keepCurrentOwnedSources(ownerId, inputs)).toEqual(inputs);
    await db.job.update({ where: { id: job.id }, data: { status: 'CANCELLED' } });
    await db.conversation.update({
      where: { id: conversation.id },
      data: { archivedAt: new Date() },
    });
    expect(await keepCurrentOwnedSources(ownerId, inputs)).toEqual(inputs.slice(0, 2));
  });
});
