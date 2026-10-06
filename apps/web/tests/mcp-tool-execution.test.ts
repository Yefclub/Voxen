import { expect, test } from 'bun:test';
import { McpServer } from '@modelcontextprotocol/server';
import { installMcpToolExecution } from '../src/routes/mcp-tool-execution';
import { serveMcpExchange } from '../src/routes/mcp-http-exchange';
import { z } from 'zod';
import { MCP_RESULT_WIRE_BYTES } from '../src/routes/mcp-result-budget';
import { fail } from '../src/routes/mcp-tool-helpers';
import { McpConcurrencyLimiter } from '../src/routes/mcp-request-protection';
import { ok } from '../src/routes/mcp-tool-helpers';

test.each([false, true])(
  'tool execution sanitizes callback failures for modern=%s',
  async (modern) => {
    for (const rejected of [false, true]) {
      const response = await serveMcpExchange(
        new Request('http://localhost:3000/mcp', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            ...(modern
              ? {
                  'MCP-Protocol-Version': '2026-07-28',
                  'Mcp-Method': 'tools/call',
                  'Mcp-Name': 'voxen_brain_hubs',
                }
              : {}),
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'voxen_brain_hubs',
              arguments: {},
              ...(modern
                ? {
                    _meta: {
                      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                      'io.modelcontextprotocol/clientCapabilities': {},
                    },
                  }
                : {}),
            },
          }),
        }),
        () => {
          const server = new McpServer({ name: 'boundary-test', version: '1' });
          installMcpToolExecution(server, { userId: 'test-owner', requestId: 'test-correlation' });
          server.registerTool('voxen_brain_hubs', { inputSchema: {} }, async () => {
            if (rejected) return fail('Note not found.');
            throw new Error('SQL PRIVATE_PATH PRIVATE_TOKEN');
          });
          return server;
        },
      );
      expect(response.status).toBe(200);
      const result = (await response.json()) as {
        result: { isError: boolean; content: { text: string }[] };
      };
      expect(result.result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
      expect(result.result.content[0]!.text).toContain(
        rejected ? 'MCP_TOOL_REJECTED' : 'MCP_TOOL_FAILED',
      );
      if (rejected)
        expect(JSON.parse(result.result.content[0]!.text).message).toBe('Note not found.');
      expect(result.result.content[0]!.text).toContain('test-correlation');
    }
  },
);

test('registry annotations are authoritative for each permission scope', async () => {
  const server = new McpServer({ name: 'contract-test', version: '1' });
  installMcpToolExecution(server, { userId: 'owner', requestId: 'correlation' });
  server.registerTool(
    'voxen_brain_hubs',
    { inputSchema: {}, annotations: { readOnlyHint: false } },
    async () => ok({ hubs: [], updatedAt: new Date('2026-01-01') }),
  );
  const response = await serveMcpExchange(
    new Request('http://localhost:3000/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }),
    () => server,
  );
  const result = (await response.json()) as {
    result: { tools: { annotations: Record<string, unknown>; _meta: Record<string, unknown> }[] };
  };
  expect(result.result.tools[0]!.annotations).toMatchObject({
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  expect(result.result.tools[0]!._meta['voxen.dev/requiredScope']).toBe('READ');
});

test('timed-out tool work retains capacity until its callback actually settles', async () => {
  const limiter = new McpConcurrencyLimiter(1, 1);
  let unblock!: () => void;
  let markStarted!: () => void;
  const held = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const request = () =>
    new Request('http://localhost:3000/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'voxen_brain_hubs', arguments: {} },
      }),
    });
  const factory = (hold: boolean) => () => {
    const server = new McpServer({ name: 'capacity-test', version: '1' });
    installMcpToolExecution(
      server,
      { userId: 'capacity-owner', requestId: 'capacity-correlation' },
      limiter,
    );
    server.registerTool('voxen_brain_hubs', { inputSchema: {} }, async () => {
      if (hold) {
        markStarted();
        await held;
      }
      return ok({ hubs: [] });
    });
    return server;
  };
  const exchange = serveMcpExchange(request(), factory(true), { deadlineMs: 100 });
  try {
    await started;
    expect((await exchange).status).toBe(504);
    const blocked = await serveMcpExchange(request(), factory(false));
    const denied = (await blocked.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(denied.result.isError).toBe(true);
    expect(denied.result.content[0]!.text).toContain('MCP_BUSY');
    unblock();
    const recovered = await serveMcpExchange(request(), factory(false));
    expect(await recovered.json()).toMatchObject({ result: { structuredContent: { hubs: [] } } });
  } finally {
    unblock();
    await exchange;
  }
});

test.each([false, true])(
  'large READ pages preserve contracts and visibility for modern=%s',
  async (modern) => {
    const data = { id: 'large-note', title: 'Large fixture', content: '😀\\\n"'.repeat(25_000) };
    let visible = true;
    let calls = 0;
    const factory = () => {
      const server = new McpServer({ name: 'bounded-read', version: '1' });
      installMcpToolExecution(server, { userId: 'page-owner', requestId: 'page-correlation' });
      server.registerTool(
        'voxen_read_note',
        {
          inputSchema: { note_id: z.string() },
          outputSchema: { id: z.string(), title: z.string(), content: z.string() },
        },
        async (args) => {
          calls++;
          expect(args).not.toHaveProperty('content_cursor');
          return visible ? ok(data) : fail('Note not found.');
        },
      );
      return server;
    };
    const call = async (cursor?: string) => {
      const response = await serveMcpExchange(
        new Request('http://localhost:3000/mcp', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            ...(modern
              ? {
                  'MCP-Protocol-Version': '2026-07-28',
                  'Mcp-Method': 'tools/call',
                  'Mcp-Name': 'voxen_read_note',
                }
              : {}),
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'voxen_read_note',
              ...(modern
                ? {
                    _meta: {
                      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                      'io.modelcontextprotocol/clientCapabilities': {},
                    },
                  }
                : {}),
              arguments: { note_id: 'large-note', ...(cursor ? { content_cursor: cursor } : {}) },
            },
          }),
        }),
        factory,
      );
      const body = await response.text();
      expect(Buffer.byteLength(body)).toBeLessThanOrEqual(MCP_RESULT_WIRE_BYTES);
      return JSON.parse(body) as {
        result: {
          isError?: boolean;
          structuredContent: { dataChunk: string; _mcp: { nextCursor: string | null } };
        };
      };
    };
    const first = await call();
    let joined = first.result.structuredContent.dataChunk;
    let cursor = first.result.structuredContent._mcp.nextCursor;
    while (cursor) {
      const next = await call(cursor);
      expect(next.result.isError).not.toBe(true);
      joined += next.result.structuredContent.dataChunk;
      cursor = next.result.structuredContent._mcp.nextCursor;
    }
    expect(JSON.parse(joined)).toEqual(data);
    expect(calls).toBeGreaterThan(1);
    visible = false;
    const hidden = await call(first.result.structuredContent._mcp.nextCursor!);
    expect(hidden.result.isError).toBe(true);
    expect(JSON.stringify(hidden)).not.toContain(data.content.slice(0, 100));
  },
);

test('oversized WRITE replies validate their summary without providing a write continuation', async () => {
  let writes = 0;
  const factory = () => {
    const server = new McpServer({ name: 'bounded-write', version: '1' });
    installMcpToolExecution(server, { userId: 'write-owner', requestId: 'write-correlation' });
    server.registerTool(
      'voxen_patch_transcript',
      {
        inputSchema: { transcript_id: z.string() },
        outputSchema: {
          applied: z.boolean(),
          correction: z.object({
            id: z.string(),
            transcriptId: z.string(),
            revision: z.number(),
            checksum: z.string(),
            markdown: z.string(),
          }),
        },
      },
      async () => {
        writes++;
        return ok({
          applied: true,
          correction: {
            id: 'revision-id',
            transcriptId: 'transcript-id',
            revision: 3,
            checksum: 'checksum',
            markdown: 'x'.repeat(100_000),
          },
        });
      },
    );
    return server;
  };
  const call = (args: Record<string, unknown>) =>
    serveMcpExchange(
      new Request('http://localhost:3000/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'voxen_patch_transcript', arguments: args },
        }),
      }),
      factory,
    );
  const response = await call({ transcript_id: 'transcript-id' });
  const body = await response.text();
  expect(Buffer.byteLength(body)).toBeLessThanOrEqual(MCP_RESULT_WIRE_BYTES);
  expect(JSON.parse(body)).toMatchObject({
    result: {
      structuredContent: {
        summary: { applied: true, correction: { revision: 3 } },
        _mcp: { toolExecution: 'completed', nextCursor: null },
      },
    },
  });
  expect(writes).toBe(1);
  const invalid = (await (
    await call({ transcript_id: 'transcript-id', content_cursor: 'do-not-repeat-this-write' })
  ).json()) as { error?: unknown; result?: { isError?: boolean } };
  expect(Boolean(invalid.error) || invalid.result?.isError).toBe(true);
  expect(writes).toBe(1);
});
