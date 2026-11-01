import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { hashMcpToken } from '../src/lib/mcp-tokens';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

async function mcpCall(body: unknown, token: string): Promise<Response> {
  return app.fetch(
    new Request(new URL('/mcp', process.env.APP_BASE_URL || 'http://localhost'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

async function callTool(token: string, name: string, args: unknown, id = 1): Promise<unknown> {
  const res = await mcpCall(
    { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
    token,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    result?: { structuredContent?: unknown };
    error?: unknown;
  };
  expect(body.error ?? null).toBeNull();
  return body.result?.structuredContent;
}

// Brain traversal truncation (spec 217 §3): graph reads are bounded and say so
// explicitly instead of implying complete enumeration.
describeIfDb('brain traversal truncation contract (spec 217)', () => {
  const TOKEN = 'test-brain-trunc-' + 'k'.repeat(20);
  let userId = '';
  let hubId = '';

  beforeAll(async () => {
    const user = await db.user.create({
      data: { email: `brain-trunc-${Date.now()}@voxen.local`, name: 'Brain', status: 'APPROVED' },
    });
    userId = user.id;
    await db.mcpToken.create({
      data: { userId, tokenHash: hashMcpToken(TOKEN), label: 'Brain', scopes: 'READ,WRITE' },
    });
    const hub = await db.brainNode.create({
      data: { userId, key: 'TOPIC:tronco', type: 'TOPIC', label: 'Tronco central' },
    });
    hubId = hub.id;
    for (let i = 0; i < 4; i++) {
      const leaf = await db.brainNode.create({
        data: { userId, key: `TOPIC:tronco-folha-${i}`, type: 'TOPIC', label: `Tronco folha ${i}` },
      });
      await db.brainEdge.create({
        data: { userId, fromNodeId: hub.id, toNodeId: leaf.id, kind: 'RELATED_TO' },
      });
      if (i < 3) {
        const count = i === 0 ? 3 : 1;
        for (let s = 0; s < count; s++) {
          await db.brainSource.create({
            data: { userId, nodeId: leaf.id, sourceType: 'MANUAL', sourceId: `manual-${i}-${s}` },
          });
        }
      }
    }
  });

  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  });

  it('flags truncation on brain search and completes fully', async () => {
    const page = (await callTool(TOKEN, 'voxen_brain_search', {
      query: 'Tronco',
      limit: 2,
    })) as { results: Array<{ id: string }>; truncated: boolean };
    expect(page.results).toHaveLength(2);
    expect(page.truncated).toBe(true);

    const full = (await callTool(TOKEN, 'voxen_brain_search', {
      query: 'Tronco',
      limit: 30,
    })) as typeof page;
    expect(full.truncated).toBe(false);
    expect(full.results.length).toBeGreaterThan(2);
    expect(full.results.slice(0, 2).map((item) => item.id)).toEqual(
      page.results.map((item) => item.id),
    );
  });

  it('flags truncation on neighbors without duplicates', async () => {
    const page = (await callTool(TOKEN, 'voxen_brain_neighbors', {
      node_id: hubId,
      limit: 2,
    })) as { edges: Array<{ id: string }>; truncated: boolean };
    expect(page.edges).toHaveLength(2);
    expect(page.truncated).toBe(true);

    const full = (await callTool(TOKEN, 'voxen_brain_neighbors', {
      node_id: hubId,
      limit: 30,
    })) as typeof page;
    expect(full.edges).toHaveLength(4);
    expect(full.truncated).toBe(false);
  });

  it('flags truncation on sources and hubs', async () => {
    const leaf = await db.brainNode.findFirstOrThrow({
      where: { userId, key: 'TOPIC:tronco-folha-0' },
    });
    const sources = (await callTool(TOKEN, 'voxen_brain_sources', {
      ref: leaf.id,
      limit: 2,
    })) as { sources: unknown[]; truncated: boolean };
    expect(sources.sources).toHaveLength(2);
    expect(sources.truncated).toBe(true);

    const fullSources = (await callTool(TOKEN, 'voxen_brain_sources', {
      ref: leaf.id,
      limit: 10,
    })) as typeof sources;
    expect(fullSources.sources).toHaveLength(3);
    expect(fullSources.truncated).toBe(false);

    const hubs = (await callTool(TOKEN, 'voxen_brain_hubs', { limit: 1 })) as {
      hubs: Array<{ id: string }>;
      truncated: boolean;
    };
    expect(hubs.hubs).toHaveLength(1);
    expect(hubs.hubs[0]!.id).toBe(hubId);
    expect(hubs.truncated).toBe(true);
  });

  it('reports timeline completion explicitly', async () => {
    const empty = (await callTool(TOKEN, 'voxen_brain_timeline', {
      query: 'xqzt inexistente',
      limit: 5,
    })) as { facts: unknown[]; truncated: boolean };
    expect(empty.facts).toEqual([]);
    expect(empty.truncated).toBe(false);
  });

  it('flags truncation on timeline facts', async () => {
    const transcript = await db.transcript.create({
      data: {
        userId,
        source: 'WEB',
        url: 'https://example.com/cronologia',
        title: 'Cronologia',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${userId}/transcripts/cronologia.md`,
        plainText: 'Cronologia.',
        frontmatter: {},
      },
    });
    const subject = await db.brainNode.create({
      data: { userId, key: 'ENTITY:crono-s', type: 'ENTITY', label: 'Crono S' },
    });
    const object = await db.brainNode.create({
      data: { userId, key: 'ENTITY:crono-o', type: 'ENTITY', label: 'Crono O' },
    });
    const edge = await db.brainEdge.create({
      data: { userId, fromNodeId: subject.id, toNodeId: object.id, kind: 'LINKS_TO' },
    });
    for (let i = 0; i < 3; i++) {
      const fact = await db.brainFact.create({
        data: { userId, edgeId: edge.id, factKey: `crono-fact-${i}`, predicate: 'relaciona' },
      });
      await db.brainSource.create({
        data: { userId, factId: fact.id, sourceType: 'TRANSCRIPT', sourceId: transcript.id },
      });
    }
    const page = (await callTool(TOKEN, 'voxen_brain_timeline', { limit: 2 })) as {
      facts: Array<{ id: string }>;
      truncated: boolean;
    };
    expect(page.facts).toHaveLength(2);
    expect(page.truncated).toBe(true);

    const full = (await callTool(TOKEN, 'voxen_brain_timeline', { limit: 10 })) as typeof page;
    expect(full.facts).toHaveLength(3);
    expect(full.truncated).toBe(false);
  });
});
