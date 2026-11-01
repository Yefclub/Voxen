import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { hashMcpToken } from '../src/lib/mcp-tokens';
import { searchKnowledgeBasePage } from '../src/lib/search';

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

// Ranked search bounds (spec 217 §3): a full page never implies complete
// enumeration. Results carry an explicit truncated flag computed with a
// take+1 probe, keeping deterministic ordering.
describeIfDb('ranked search truncation contract (spec 217)', () => {
  const TOKEN = 'test-truncation-' + 'k'.repeat(20);
  let userId = '';

  beforeAll(async () => {
    const user = await db.user.create({
      data: { email: `trunc-${Date.now()}@voxen.local`, name: 'Trunc', status: 'APPROVED' },
    });
    userId = user.id;
    await db.mcpToken.create({
      data: { userId, tokenHash: hashMcpToken(TOKEN), label: 'Trunc', scopes: 'READ,WRITE' },
    });
    for (let i = 0; i < 5; i++) {
      await db.transcript.create({
        data: {
          userId,
          source: 'WEB',
          url: `https://example.com/trunc-${i}`,
          title: `Manual do guindaste ${i}`,
          durationSec: 0,
          language: 'pt',
          transcriptionMethod: 'SCRAPE',
          mdPath: `workspaces/${userId}/transcripts/trunc-${i}.md`,
          plainText: `Manual do guindaste procedimento ${i} referência oficial.`,
          frontmatter: {},
        },
      });
    }
    await db.note.create({
      data: {
        userId,
        kind: 'NOTE',
        title: 'Guindaste nota',
        content: 'Manual do guindaste resumo curado.',
      },
    });
  });

  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  });

  it('flags truncation when candidates exceed the limit', async () => {
    const page = await searchKnowledgeBasePage(userId, 'manual guindaste', 2);
    expect(page.results).toHaveLength(2);
    expect(page.truncated).toBe(true);

    const full = await searchKnowledgeBasePage(userId, 'manual guindaste', 25);
    expect(full.truncated).toBe(false);
    expect(full.results.length).toBeGreaterThan(2);
    // Ordering is stable between the narrow and the full page.
    expect(full.results.slice(0, 2).map((item) => item.id)).toEqual(
      page.results.map((item) => item.id),
    );
  });

  it('reports truncated=false on a completed empty search', async () => {
    const page = await searchKnowledgeBasePage(userId, 'xqzt inexistente', 8);
    expect(page.results).toEqual([]);
    expect(page.truncated).toBe(false);
  });

  it('exposes truncated on MCP search tools without changing result order', async () => {
    const kb = (await callTool(TOKEN, 'voxen_search_knowledge', {
      query: 'manual guindaste',
      limit: 2,
    })) as { results: Array<{ id: string }>; truncated: boolean };
    expect(kb.results).toHaveLength(2);
    expect(kb.truncated).toBe(true);

    const tx = (await callTool(TOKEN, 'voxen_search_transcripts', {
      query: 'manual guindaste',
      limit: 2,
    })) as { results: Array<{ id: string }>; truncated: boolean };
    expect(tx.results).toHaveLength(2);
    expect(tx.truncated).toBe(true);

    const notes = (await callTool(TOKEN, 'voxen_search_notes', {
      query: 'manual guindaste',
      limit: 1,
    })) as { results: Array<{ id: string }>; truncated: boolean };
    expect(notes.results).toHaveLength(1);
    expect(notes.truncated).toBe(false);

    expect(kb.results.map((item) => item.id)).toEqual(
      (await searchKnowledgeBasePage(userId, 'manual guindaste', 2)).results.map((item) => item.id),
    );
  });
});
