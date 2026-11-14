import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import app from '../src/index';
import { db } from '../src/lib/db';
import { createMcpToken } from '../src/lib/mcp-tokens';
import { executePassageIndex } from '../src/lib/passage-index/runner';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
suite('additive read-only MCP passage tools', () => {
  const users: string[] = [],
    tokens: string[] = [];
  let sourceId = '',
    writeToken = '';
  async function rpc(method: string, params: object, token = tokens[0]!) {
    return app.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      }),
    );
  }
  async function call(name: string, args: object, token = tokens[0]!) {
    const response = await rpc('tools/call', { name, arguments: args }, token);
    expect(response.status).toBe(200);
    return (await response.json()) as {
      result?: {
        isError?: boolean;
        content: Array<{ text: string }>;
        structuredContent: {
          results: Array<{ key: string; sourceId: string; revision: string; href: string }>;
          text: string;
          href: string;
          kind: string;
          authority: string | null;
        };
      };
      error?: unknown;
    };
  }
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const user = await db.user.create({
        data: {
          email: `mcp-passages-${randomUUID()}@example.test`,
          name: 'MCP passages',
          status: 'APPROVED',
        },
      });
      users.push(user.id);
      tokens.push(
        (
          await createMcpToken({
            userId: user.id,
            scopes: ['READ'],
            label: 'Passage read',
            expiresAt: null,
          })
        ).token,
      );
    }
    writeToken = (
      await createMcpToken({
        userId: users[0]!,
        scopes: ['WRITE'],
        label: 'Passage write only',
        expiresAt: null,
      })
    ).token;
    const row = await db.note.create({
      data: {
        userId: users[0]!,
        title: 'Evidence note',
        content: '# Evidence\nA literal MCP passage quotation.\n',
      },
    });
    sourceId = row.id;
    await executePassageIndex({ userId: users[0]!, type: 'note', id: sourceId });
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: users } } });
  });
  test('advertises complete output contracts and read-only scope without expanding WRITE access', async () => {
    const response = await rpc('tools/list', {});
    const body = (await response.json()) as {
      result: {
        tools: Array<{
          name: string;
          outputSchema?: object;
          annotations: {
            readOnlyHint: boolean;
            destructiveHint: boolean;
            idempotentHint: boolean;
            openWorldHint: boolean;
          };
        }>;
      };
    };
    for (const name of ['voxen_search_passages', 'voxen_read_passage']) {
      const tool = body.result.tools.find((t) => t.name === name);
      expect(tool).toBeDefined();
      expect(tool?.outputSchema).toBeDefined();
      expect(tool?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(
        (await rpc('tools/call', { name, arguments: { query: 'literal' } }, writeToken)).status,
      ).toBe(403);
    }
  });
  test('searches and verifies canonical passages over the real HTTP transport with owned absolute links', async () => {
    const searched = await call('voxen_search_passages', {
      query: 'literal MCP passage',
      source_types: ['note'],
      source_ids: [sourceId],
    });
    expect(searched.error).toBeUndefined();
    expect(searched.result?.isError).not.toBe(true);
    const hits = searched.result!.structuredContent.results;
    expect(hits.map((h) => h.sourceId)).toEqual([sourceId]);
    expect(hits[0]!.href).toBe(`http://localhost/notas/${sourceId}`);
    const read = await call('voxen_read_passage', {
      passage_key: hits[0]!.key,
      expected_revision: hits[0]!.revision,
    });
    expect(read.result?.isError).not.toBe(true);
    expect(read.result?.structuredContent).toMatchObject({
      text: '# Evidence\nA literal MCP passage quotation.\n',
      href: `http://localhost/notas/${sourceId}`,
      kind: 'ORIGINAL',
      authority: null,
    });
  });
  test('does not expose foreign passage IDs and reports stale revisions without returning old text', async () => {
    const hit = (await call('voxen_search_passages', { query: 'literal MCP passage' })).result!
      .structuredContent.results[0]!;
    const args = { passage_key: hit.key, expected_revision: hit.revision };
    const foreign = await call('voxen_read_passage', args, tokens[1]);
    const missing = await call(
      'voxen_read_passage',
      { ...args, passage_key: '0'.repeat(64) },
      tokens[1],
    );
    const domainError = (result: typeof foreign) => {
      const { requestId: _requestId, ...error } = JSON.parse(result.result!.content[0]!.text) as {
        requestId: string;
        code: string;
        message: string;
      };
      return error;
    };
    expect(domainError(foreign)).toEqual(domainError(missing));
    expect(foreign.result?.isError).toBe(true);
    expect(foreign.result?.content[0]?.text).toContain('NOT_FOUND');
    await db.note.update({
      where: { id: sourceId },
      data: { content: 'A changed note.', revision: 2 },
    });
    const stale = await call('voxen_read_passage', args);
    expect(stale.result?.isError).toBe(true);
    expect(stale.result?.content[0]?.text).toContain('STALE_REVISION');
    expect(JSON.stringify(stale)).not.toContain('literal MCP passage quotation');
  });
  test('retains all existing search output fields', async () => {
    await db.note.create({
      data: { userId: users[0]!, title: 'Contract note', content: 'A contract observation.' },
    });
    const result = await call('voxen_search_knowledge', {
      query: 'contract observation',
      source_types: ['note'],
    });
    const raw = result.result!.structuredContent.results[0]!;
    expect(Object.keys(raw).sort()).toEqual(
      [
        'createdAt',
        'folder',
        'href',
        'id',
        'rank',
        'snippet',
        'sourceType',
        'summary',
        'tags',
        'title',
      ].sort(),
    );
  });
});
