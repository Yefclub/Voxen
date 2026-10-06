import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Client as LegacyClient } from 'mcp-legacy-test-client/client/index.js';
import { StreamableHTTPClientTransport as LegacyTransport } from 'mcp-legacy-test-client/client/streamableHttp.js';
import app from '../src/index';
import { db } from '../src/lib/db';
import { createMcpToken } from '../src/lib/mcp-tokens';

const MODERN = '2026-07-28';
const endpoint = new URL('/mcp', process.env.APP_BASE_URL || 'http://localhost:3000');
const localFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
  app.fetch(new Request(input, init));

describe.skipIf(!process.env.DATABASE_URL)('MCP protocol conformance', () => {
  let userId = '';
  let token = '';
  let noteId = '';
  const headers = () => ({
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  });

  beforeAll(async () => {
    const user = await db.user.create({
      data: {
        name: 'Protocol Test',
        email: `mcp-protocol-${crypto.randomUUID()}@example.test`,
        status: 'APPROVED',
      },
    });
    userId = user.id;
    token = (
      await createMcpToken({ userId, label: 'Protocol tests', scopes: ['READ'], expiresAt: null })
    ).token;
    const note = await db.note.create({
      data: { userId, title: 'Protocol fixture', content: 'Owned protocol evidence.' },
    });
    noteId = note.id;
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { id: userId } });
  });

  test('a real maintenance v1 client initializes, lists, searches and reads', async () => {
    const client = new LegacyClient({ name: 'voxen-conformance-v1', version: '1' });
    const transport = new LegacyTransport(endpoint, {
      fetch: localFetch,
      requestInit: { headers: headers() },
    });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.some((tool) => tool.name === 'voxen_read_note')).toBe(
        true,
      );
      const search = await client.callTool({
        name: 'voxen_search_notes',
        arguments: { query: 'Protocol fixture' },
      });
      expect(JSON.stringify(search)).toContain(noteId);
      const read = await client.callTool({
        name: 'voxen_read_note',
        arguments: { note_id: noteId },
      });
      expect(JSON.stringify(read)).toContain('Owned protocol evidence.');
    } finally {
      await client.close();
    }
  });

  test.each(['auto', 'pin'] as const)(
    'a real v2 client negotiates modern traffic in %s mode',
    async (mode) => {
      const client = new Client(
        { name: 'voxen-conformance-v2', version: '1' },
        {
          versionNegotiation: { mode: mode === 'pin' ? { pin: MODERN } : 'auto' },
        },
      );
      const transport = new StreamableHTTPClientTransport(endpoint, {
        fetch: localFetch,
        requestInit: { headers: headers() },
      });
      try {
        await client.connect(transport);
        expect(client.getProtocolEra()).toBe('modern');
        expect(client.getServerCapabilities()?.tools?.listChanged).not.toBe(true);
        expect(
          (await client.listTools()).tools.some((tool) => tool.name === 'voxen_read_note'),
        ).toBe(true);
        const search = await client.callTool({
          name: 'voxen_search_notes',
          arguments: { query: 'Protocol fixture' },
        });
        expect(JSON.stringify(search)).toContain(noteId);
        const read = await client.callTool({
          name: 'voxen_read_note',
          arguments: { note_id: noteId },
        });
        expect(JSON.stringify(read)).toContain('Owned protocol evidence.');
      } finally {
        await client.close();
      }
    },
  );

  const legacyRequest = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
  const modernRequest = (method = 'tools/list', params: Record<string, unknown> = {}) => ({
    jsonrpc: '2.0',
    id: 1,
    method,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': MODERN,
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  });
  const post = (body: string, additional: Record<string, string> = {}) =>
    localFetch(endpoint, {
      method: 'POST',
      headers: { ...headers(), ...additional },
      body,
    });

  test.each([
    ['malformed JSON', '{', {}, 400],
    ['wrong Content-Type', JSON.stringify(legacyRequest), { 'content-type': 'text/plain' }, 415],
    ['wrong Accept', JSON.stringify(legacyRequest), { accept: 'text/html' }, 406],
    [
      'unsupported version',
      JSON.stringify(legacyRequest),
      { 'MCP-Protocol-Version': '2099-01-01' },
      400,
    ],
  ] as const)('returns a protocol error for %s', async (_name, body, additional, status) => {
    const response = await post(body, additional);
    expect(response.status).toBe(status);
    const error = (await response.json()) as { jsonrpc?: string; error?: { code?: number } };
    expect(error.jsonrpc).toBe('2.0');
    expect(typeof error.error?.code).toBe('number');
  });

  test.each([
    ['version', { 'MCP-Protocol-Version': '2025-11-25', 'Mcp-Method': 'tools/list' }],
    ['method', { 'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'tools/call' }],
  ] as const)('rejects modern %s header/body mismatch', async (_name, additional) => {
    const response = await post(JSON.stringify(modernRequest()), additional);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error?: unknown }).error).toBeDefined();
  });

  test('rejects a modern tool-name mismatch', async () => {
    const response = await post(
      JSON.stringify(
        modernRequest('tools/call', {
          name: 'voxen_read_note',
          arguments: { note_id: noteId },
        }),
      ),
      {
        'MCP-Protocol-Version': MODERN,
        'Mcp-Method': 'tools/call',
        'Mcp-Name': 'voxen_search_notes',
      },
    );
    expect(response.status).toBe(400);
  });

  test.each(['MCP-Protocol-Version', 'Mcp-Method', 'Mcp-Name'])(
    'requires the modern %s header',
    async (missing) => {
      const additional: Record<string, string> = {
        'MCP-Protocol-Version': MODERN,
        'Mcp-Method': 'tools/call',
        'Mcp-Name': 'voxen_read_note',
      };
      delete additional[missing];
      const response = await post(
        JSON.stringify(
          modernRequest('tools/call', {
            name: 'voxen_read_note',
            arguments: { note_id: noteId },
          }),
        ),
        additional,
      );
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error?: { code?: number } }).error?.code).toBe(-32020);
    },
  );

  test('accepts a correctly encoded modern tool-name header', async () => {
    const response = await post(
      JSON.stringify(
        modernRequest('tools/call', {
          name: 'voxen_read_note',
          arguments: { note_id: noteId },
        }),
      ),
      {
        'MCP-Protocol-Version': MODERN,
        'Mcp-Method': 'tools/call',
        'Mcp-Name': `=?base64?${Buffer.from('voxen_read_note').toString('base64')}?=`,
      },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Owned protocol evidence.');
  });

  test('reports supported revisions for an unsupported modern version', async () => {
    const body = modernRequest();
    body.params._meta['io.modelcontextprotocol/protocolVersion'] = '2099-01-01';
    const response = await post(JSON.stringify(body), {
      'MCP-Protocol-Version': '2099-01-01',
      'Mcp-Method': 'tools/list',
    });
    expect(response.status).toBe(400);
    const result = (await response.json()) as {
      error?: { code?: number; data?: { supported?: string[] } };
    };
    expect(result.error?.code).toBe(-32022);
    expect(result.error?.data?.supported).toContain(MODERN);
  });

  test('rejects a modern envelope missing client capabilities', async () => {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {
        _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN },
      },
    };
    const response = await post(JSON.stringify(body), {
      'MCP-Protocol-Version': MODERN,
      'Mcp-Method': 'tools/list',
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error?: { code?: number } }).error?.code).toBe(-32602);
  });

  test('rejects a body exceeding one MiB before tool execution', async () => {
    const response = await post(
      JSON.stringify({ ...legacyRequest, padding: 'x'.repeat(1024 * 1024) }),
    );
    expect(response.status).toBe(413);
  });

  test.each(['GET', 'DELETE'])('rejects unsupported standalone %s exchanges', async (method) => {
    const response = await localFetch(endpoint, { method, headers: headers() });
    await response.body?.cancel();
    expect(response.status).toBe(405);
    expect(response.headers.get('content-type')).not.toContain('text/event-stream');
  });

  test('does not open unsupported modern subscription streams', async () => {
    const response = await post(
      JSON.stringify(modernRequest('subscriptions/listen', { subscriptions: [] })),
      {
        'MCP-Protocol-Version': MODERN,
        'Mcp-Method': 'subscriptions/listen',
      },
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).not.toContain('text/event-stream');
  });
});
