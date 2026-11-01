import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { hashMcpToken } from '../src/lib/mcp-tokens';
import { contentCursor, resultDigest, verifyResultCursor } from '../src/routes/mcp-content-cursor';
import {
  clearResultReuseCache,
  configureResultReuseForTests,
  getResultReuseStats,
} from '../src/routes/mcp-result-reuse';

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
    result?: { structuredContent?: unknown; isError?: boolean };
    error?: unknown;
  };
  expect(body.error ?? null).toBeNull();
  return body.result?.structuredContent;
}

async function callToolRaw(
  token: string,
  name: string,
  args: unknown,
  id = 1,
): Promise<{ status: number; body: unknown }> {
  const res = await mcpCall(
    { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
    token,
  );
  return { status: res.status, body: await res.json() };
}

function digestOf(structured: unknown): string {
  return resultDigest(JSON.stringify(structured));
}

// Bounded result reuse (spec 217 §2): page 2+ reuses the prepared result
// within TTL/memory/byte limits, preserves order, and fails closed on
// owner/argument/expiry/access changes.
describeIfDb('reusable continuation contract (spec 217)', () => {
  const TOKEN = 'test-reuse-' + 'k'.repeat(20);
  const OTHER_TOKEN = 'test-reuse-other-' + 'k'.repeat(20);
  let userId = '';
  let otherId = '';

  beforeAll(async () => {
    clearResultReuseCache();
    configureResultReuseForTests({
      maxEntries: 100,
      maxBytes: 4 * 1024 * 1024,
      ttlMs: 5 * 60 * 1000,
    });
    const user = await db.user.create({
      data: { email: `reuse-${Date.now()}@voxen.local`, name: 'Reuse', status: 'APPROVED' },
    });
    userId = user.id;
    const other = await db.user.create({
      data: { email: `reuse-other-${Date.now()}@voxen.local`, name: 'Other', status: 'APPROVED' },
    });
    otherId = other.id;
    await db.mcpToken.create({
      data: { userId, tokenHash: hashMcpToken(TOKEN), label: 'Reuse', scopes: 'READ,WRITE' },
    });
    await db.mcpToken.create({
      data: {
        userId: otherId,
        tokenHash: hashMcpToken(OTHER_TOKEN),
        label: 'Other',
        scopes: 'READ',
      },
    });
    for (let i = 0; i < 4; i++) {
      await db.transcript.create({
        data: {
          userId,
          source: 'WEB',
          url: `https://example.com/reuse-${i}`,
          title: `Fornalha industrial ${i}`,
          durationSec: 0,
          language: 'pt',
          transcriptionMethod: 'SCRAPE',
          mdPath: `workspaces/${userId}/transcripts/reuse-${i}.md`,
          plainText: `Fornalha industrial procedimento ${i} manual de operação.`,
          frontmatter: {},
        },
      });
    }
  });

  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    if (otherId) await db.user.delete({ where: { id: otherId } }).catch(() => undefined);
    clearResultReuseCache();
    configureResultReuseForTests({
      maxEntries: 100,
      maxBytes: 4 * 1024 * 1024,
      ttlMs: 5 * 60 * 1000,
    });
    await db.$disconnect();
  });

  it('serves a later page from the prepared result with identical bytes', async () => {
    const args = { query: 'fornalha industrial', limit: 2 };
    const first = (await callTool(TOKEN, 'voxen_search_transcripts', args)) as {
      results: Array<{ id: string }>;
      truncated: boolean;
    };
    expect(first.results).toHaveLength(2);
    expect(first.truncated).toBe(true);
    expect(getResultReuseStats().stores).toBeGreaterThanOrEqual(1);

    const serialized = JSON.stringify(first);
    const cursor = contentCursor(
      10,
      digestOf(first),
      { userId, tool: 'voxen_search_transcripts', args, requestId: 'r1' },
      Date.now(),
    );
    const page = (await callTool(TOKEN, 'voxen_search_transcripts', {
      ...args,
      content_cursor: cursor,
    })) as {
      dataChunk: string;
      _mcp: {
        offset: number;
        totalChars: number;
        resultChecksum: string;
        nextCursor: string | null;
      };
    };
    expect(page._mcp.resultChecksum).toBe(digestOf(first));
    expect(page.dataChunk).toBe(serialized.slice(10, 10 + page.dataChunk.length));
    expect(getResultReuseStats().hits).toBeGreaterThanOrEqual(1);
  });

  it('rejects cross-owner and altered-argument continuations', async () => {
    const args = { query: 'fornalha industrial', limit: 2 };
    const first = (await callTool(TOKEN, 'voxen_search_transcripts', args)) as unknown;
    const cursor = contentCursor(
      10,
      digestOf(first),
      { userId, tool: 'voxen_search_transcripts', args, requestId: 'r1' },
      Date.now(),
    );

    const cross = await callToolRaw(OTHER_TOKEN, 'voxen_search_transcripts', {
      ...args,
      content_cursor: cursor,
    });
    const crossBody = cross.body as { result?: { isError?: boolean } };
    expect(crossBody.result?.isError).toBe(true);

    const altered = await callToolRaw(TOKEN, 'voxen_search_transcripts', {
      query: 'fornalha industrial ALTERADA',
      limit: 2,
      content_cursor: cursor,
    });
    const alteredBody = altered.body as { result?: { isError?: boolean } };
    expect(alteredBody.result?.isError).toBe(true);
  });

  it('reports changed content with restart guidance after deletion', async () => {
    const victim = await db.transcript.create({
      data: {
        userId,
        source: 'WEB',
        url: 'https://example.com/reuse-victim',
        title: 'Fornalha vítima',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${userId}/transcripts/reuse-victim.md`,
        plainText: 'Fornalha vítima para teste de invalidação.',
        frontmatter: {},
      },
    });
    const args = { query: 'fornalha vítima', limit: 5 };
    const first = (await callTool(TOKEN, 'voxen_search_transcripts', args)) as {
      results: Array<{ id: string }>;
    };
    expect(first.results.map((item) => item.id)).toContain(victim.id);

    await db.transcript.delete({ where: { id: victim.id } });
    const cursor = contentCursor(
      10,
      digestOf(first),
      { userId, tool: 'voxen_search_transcripts', args, requestId: 'r1' },
      Date.now(),
    );
    const resumed = await callToolRaw(TOKEN, 'voxen_search_transcripts', {
      ...args,
      content_cursor: cursor,
    });
    const resumedBody = resumed.body as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(resumedBody.result?.isError).toBe(true);
    expect(JSON.stringify(resumedBody.result?.content)).toContain('MCP_CONTENT_CHANGED');
  });

  it('falls back to recompute transparently after entry expiry', async () => {
    configureResultReuseForTests({ ttlMs: 60 });
    const args = { query: 'fornalha industrial', limit: 2 };
    const first = (await callTool(TOKEN, 'voxen_search_transcripts', args)) as unknown;
    const missesBefore = getResultReuseStats().misses;
    await new Promise((resolve) => setTimeout(resolve, 90));
    const cursor = contentCursor(
      10,
      digestOf(first),
      { userId, tool: 'voxen_search_transcripts', args, requestId: 'r1' },
      Date.now(),
    );
    const page = (await callTool(TOKEN, 'voxen_search_transcripts', {
      ...args,
      content_cursor: cursor,
    })) as {
      dataChunk: string;
      _mcp: { resultChecksum: string };
    };
    expect(page._mcp.resultChecksum).toBe(digestOf(first));
    expect(getResultReuseStats().misses).toBeGreaterThan(missesBefore);
    configureResultReuseForTests({ ttlMs: 5 * 60 * 1000 });
  });

  it('evicts oldest entries under documented bounds without breaking reads', async () => {
    configureResultReuseForTests({ maxEntries: 2, maxBytes: 1024 * 1024 });
    clearResultReuseCache();
    for (const [index, term] of [
      'fornalha industrial',
      'manual operação',
      'procedimento',
    ].entries()) {
      await callTool(TOKEN, 'voxen_search_transcripts', { query: term, limit: 1 }, 100 + index);
    }
    expect(getResultReuseStats().evictions).toBeGreaterThanOrEqual(1);
    expect(getResultReuseStats().entries).toBeLessThanOrEqual(2);

    const args = { query: 'fornalha industrial', limit: 2 };
    const first = (await callTool(TOKEN, 'voxen_search_transcripts', args)) as unknown;
    const cursor = contentCursor(
      10,
      digestOf(first),
      { userId, tool: 'voxen_search_transcripts', args, requestId: 'r1' },
      Date.now(),
    );
    const page = (await callTool(TOKEN, 'voxen_search_transcripts', {
      ...args,
      content_cursor: cursor,
    })) as {
      dataChunk: string;
    };
    expect(typeof page.dataChunk).toBe('string');
    configureResultReuseForTests({ maxEntries: 100, maxBytes: 4 * 1024 * 1024 });
    clearResultReuseCache();
  });

  it('expires cursors after the documented TTL', () => {
    const context = {
      userId,
      tool: 'voxen_search_transcripts',
      args: { query: 'x' },
      requestId: 'r',
    };
    const now = Date.now();
    const cursor = contentCursor(10, 'abc', context, now);
    expect(() => verifyResultCursor({ ...context, cursor }, now + 6 * 60 * 1000)).toThrow(
      /EXPIRED/,
    );
    expect(verifyResultCursor({ ...context, cursor }, now).digest).toBe('abc');
  });
});
