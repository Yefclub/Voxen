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

type RelatedOut = {
  results: Array<{ id: string; title: string; kind: string }>;
  truncated: boolean;
};

// Related-documents truncation (spec 217 §3): fused Brain + FTS candidates
// report truncation explicitly instead of implying complete enumeration.
describeIfDb('related truncation contract (spec 217)', () => {
  const TOKEN = 'test-related-trunc-' + 'k'.repeat(20);
  let userId = '';

  beforeAll(async () => {
    const user = await db.user.create({
      data: { email: `related-${Date.now()}@voxen.local`, name: 'Related', status: 'APPROVED' },
    });
    userId = user.id;
    await db.mcpToken.create({
      data: { userId, tokenHash: hashMcpToken(TOKEN), label: 'Related', scopes: 'READ,WRITE' },
    });
    for (let i = 0; i < 5; i++) {
      await db.transcript.create({
        data: {
          userId,
          source: 'WEB',
          url: `https://example.com/rel-${i}`,
          title: `Relacionado vitrola ${i}`,
          durationSec: 0,
          language: 'pt',
          transcriptionMethod: 'SCRAPE',
          mdPath: `workspaces/${userId}/transcripts/rel-${i}.md`,
          plainText: `Documento sobre vitrola número ${i} para teste de relacionados.`,
          frontmatter: {},
        },
      });
    }
  });

  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  });

  it('flags truncation when fused candidates exceed the limit', async () => {
    const page = (await callTool(TOKEN, 'voxen_related', {
      query: 'vitrola',
      limit: 2,
    })) as RelatedOut;
    expect(page.results).toHaveLength(2);
    expect(page.truncated).toBe(true);

    const full = (await callTool(TOKEN, 'voxen_related', {
      query: 'vitrola',
      limit: 25,
    })) as RelatedOut;
    expect(full.truncated).toBe(false);
    expect(full.results.length).toBeGreaterThan(2);
    expect(full.results.slice(0, 2).map((item) => item.id)).toEqual(
      page.results.map((item) => item.id),
    );
  });

  it('reports a completed empty related search without truncation', async () => {
    const out = (await callTool(TOKEN, 'voxen_related', {
      query: 'xqzt inexistente',
      limit: 5,
    })) as RelatedOut;
    expect(out.results).toEqual([]);
    expect(out.truncated).toBe(false);
  });
});
