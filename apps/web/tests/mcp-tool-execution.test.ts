import { expect, test } from 'bun:test';
import { McpServer } from '@modelcontextprotocol/server';
import { installMcpToolExecution } from '../src/routes/mcp-tool-execution';
import { serveMcpExchange } from '../src/routes/mcp-http-exchange';
import { ok } from '../src/routes/mcp-tool-helpers';

test.each([false, true])(
  'tool execution sanitizes callback failures for modern=%s',
  async (modern) => {
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
    expect(result.result.content[0]!.text).toContain('MCP_TOOL_FAILED');
    expect(result.result.content[0]!.text).toContain('test-correlation');
  },
);

test('registry annotations are authoritative and read results normalize Date values', async () => {
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
