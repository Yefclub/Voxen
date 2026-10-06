import { expect, test } from 'bun:test';
import { McpServer } from '@modelcontextprotocol/server';
import { serveMcpExchange } from '../src/routes/mcp-http-exchange';

function request(modern: boolean, signal?: AbortSignal): Request {
  return new Request('http://localhost:3000/mcp', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(modern
        ? { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': 'probe' }
        : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'probe',
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
  });
}

test.each([false, true])(
  'closes successful and failed exchanges with modern=%s',
  async (modern) => {
    for (const fails of [false, true]) {
      let closed = 0;
      const response = await serveMcpExchange(request(modern), () => {
        const server = new McpServer({ name: 'lifecycle', version: '1' });
        const close = server.close.bind(server);
        server.close = async () => {
          closed++;
          await close();
        };
        server.registerTool('probe', { inputSchema: {} }, async () => {
          if (fails) throw new Error('Controlled callback failure');
          return { content: [{ type: 'text' as const, text: 'ok' }] };
        });
        return server;
      });
      expect(response.status).toBe(200);
      expect(closed).toBeGreaterThan(0);
      const result = (await response.json()) as { result?: { isError?: boolean } };
      expect(Boolean(result.result?.isError)).toBe(fails);
    }
  },
);

test.each([false, true])('releases an aborted exchange with modern=%s', async (modern) => {
  let closed = 0;
  let start!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const abort = new AbortController();
  const exchange = serveMcpExchange(request(modern, abort.signal), () => {
    const server = new McpServer({ name: 'lifecycle', version: '1' });
    const close = server.close.bind(server);
    server.close = async () => {
      closed++;
      await close();
    };
    server.registerTool('probe', { inputSchema: {} }, async () => {
      start();
      await held;
      return { content: [{ type: 'text' as const, text: 'late reply' }] };
    });
    return server;
  });
  await started;
  abort.abort();
  try {
    const response = await exchange;
    expect(response.status).toBe(499);
    expect(closed).toBeGreaterThan(0);
    expect(await response.text()).not.toContain('late reply');
  } finally {
    release();
  }
});

test('does not create a server for an already aborted request', async () => {
  const abort = new AbortController();
  abort.abort();
  const response = await serveMcpExchange(request(false, abort.signal), () => {
    throw new Error('Factory must not run');
  });
  expect(response.status).toBe(499);
});

test.each([false, true])('bounds a stalled exchange with modern=%s', async (modern) => {
  let closed = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const exchange = serveMcpExchange(
    request(modern),
    () => {
      const server = new McpServer({ name: 'deadline', version: '1' });
      const close = server.close.bind(server);
      server.close = async () => {
        closed++;
        await close();
      };
      server.registerTool('probe', { inputSchema: {} }, async () => {
        await held;
        return { content: [{ type: 'text' as const, text: 'late reply' }] };
      });
      return server;
    },
    { deadlineMs: 25 },
  );
  try {
    const response = await exchange;
    expect(response.status).toBe(504);
    expect(closed).toBeGreaterThan(0);
    expect(await response.text()).not.toContain('late reply');
  } finally {
    release();
  }
});
