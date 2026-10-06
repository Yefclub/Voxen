import { expect, test } from 'bun:test';
import { McpServer } from '@modelcontextprotocol/server';
import { serveMcpExchange } from '../src/routes/mcp-http-exchange';
import { installMcpToolExecution } from '../src/routes/mcp-tool-execution';
import { MCP_RESULT_WIRE_BYTES } from '../src/routes/mcp-result-budget';
import { boundMcpToolResponse } from '../src/routes/mcp-response-budget';
import { ok } from '../src/routes/mcp-tool-helpers';

test.each([false, true])('SDK errors remain bounded for modern=%s', async (modern) => {
  for (const variant of ['unknownMethod', 'unknownTool', 'unknownKey']) {
    const name = variant === 'unknownTool' ? 'PRIVATE_CANARY'.repeat(38000) : 'voxen_brain_hubs';
    const response = await serveMcpExchange(
      new Request('http://localhost/mcp', {
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
          method: variant === 'unknownMethod' ? 'PRIVATE_CANARY'.repeat(38000) : 'tools/call',
          params: {
            name,
            arguments: variant === 'unknownKey' ? { ['PRIVATE_CANARY'.repeat(38000)]: true } : {},
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
        const server = new McpServer({ name: 'response-budget-test', version: '1' });
        installMcpToolExecution(server, {
          userId: 'response-budget-owner',
          requestId: 'response-budget-correlation',
        });
        server.registerTool('voxen_brain_hubs', { inputSchema: {} }, async () => ok({ hubs: [] }));
        return server;
      },
    );
    const text = await response.text();
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MCP_RESULT_WIRE_BYTES);
    expect(text).not.toContain('PRIVATE_CANARY');
    expect(JSON.parse(text).error.code).toBe(variant === 'unknownKey' ? -32000 : -32600);
  }
});

test('small replies preserve status, headers and exact JSON-RPC payload', async () => {
  const text = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    error: { code: -32602, message: 'Invalid arguments' },
  });
  const response = await boundMcpToolResponse(
    new Response(text, { status: 400, headers: { 'x-mcp-test': 'preserved' } }),
    { method: 'tools/call', id: 1 },
  );
  expect(response.status).toBe(400);
  expect(response.headers.get('x-mcp-test')).toBe('preserved');
  expect(await response.text()).toBe(text);
});

test('catalog discovery and empty notification replies retain their original responses', async () => {
  const catalog = new Response('x'.repeat(MCP_RESULT_WIRE_BYTES + 1));
  expect(await boundMcpToolResponse(catalog, { method: 'tools/list' })).toBe(catalog);
  const empty = new Response(null, { status: 202 });
  expect(await boundMcpToolResponse(empty, { method: 'tools/call' })).toBe(empty);
});

test('oversized streaming reply is cancelled and gets a small retry-safe error', async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MCP_RESULT_WIRE_BYTES + 1));
      },
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { 'content-length': String(MCP_RESULT_WIRE_BYTES + 1) } },
  );
  const result = await boundMcpToolResponse(response, { method: 'tools/call', id: 'correlation' });
  expect(cancelled).toBe(true);
  expect(result.headers.has('content-length')).toBe(false);
  expect(await result.json()).toMatchObject({ id: 'correlation', error: { code: -32000 } });
});
