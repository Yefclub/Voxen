import {
  createMcpHandler,
  isLegacyRequest,
  type McpServer,
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/server';
import { structuredDiagnostic } from '../lib/structured-log';

export const MCP_REQUEST_BYTES = 1024 * 1024;
export const MCP_EXCHANGE_DEADLINE_MS = 30_000;

function cancelledExchange(timedOut = false): Response {
  return Response.json(
    {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32000,
        message: timedOut
          ? 'Request deadline exceeded. Check current state before retrying writes.'
          : 'Request was cancelled.',
      },
    },
    { status: timedOut ? 504 : 499 },
  );
}

async function completeExchange(
  request: Request,
  execute: (request: Request) => Promise<Response>,
  close: () => Promise<void>,
  deadlineMs: number,
): Promise<Response> {
  const deadline = new AbortController();
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  const timer = setTimeout(() => deadline.abort(), deadlineMs);
  let onAbort = () => {};
  const cancelled = new Promise<Response>((resolve) => {
    onAbort = () => resolve(cancelledExchange(deadline.signal.aborted));
  });
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal.aborted) return cancelledExchange(deadline.signal.aborted);
    return await Promise.race([execute(request), cancelled]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    await close().catch((error: unknown) =>
      structuredDiagnostic(
        'warning',
        'mcp-transport-close-error',
        'MCP_TRANSPORT_CLOSE_ERROR',
        error,
      ),
    );
  }
}

function rejectedExchange(status: 404 | 405, id: unknown = null): Response {
  return Response.json(
    {
      jsonrpc: '2.0',
      id: typeof id === 'number' || typeof id === 'string' ? id : null,
      error: {
        code: -32601,
        message: status === 405 ? 'Method not allowed.' : 'Method not found.',
      },
    },
    { status, headers: status === 405 ? { allow: 'POST' } : {} },
  );
}

/** Both protocol eras use a fresh, owner-scoped instance with JSON responses. */
export async function serveMcpExchange(
  request: Request,
  factory: () => McpServer,
  options: { deadlineMs?: number } = {},
): Promise<Response> {
  if (request.signal.aborted) return cancelledExchange();
  if (request.method !== 'POST') return rejectedExchange(405);

  // Voxen does not publish subscription capabilities or cross-request events.
  // Reject listen explicitly so a client cannot open an empty keepalive stream.
  const body: unknown = await request
    .clone()
    .json()
    .catch(() => undefined);
  if (
    body &&
    typeof body === 'object' &&
    'method' in body &&
    body.method === 'subscriptions/listen'
  ) {
    return rejectedExchange(404, 'id' in body ? body.id : null);
  }

  if (!(await isLegacyRequest(request, body, { maxRequestBodySize: MCP_REQUEST_BYTES }))) {
    let instance: McpServer | undefined;
    const handler = createMcpHandler(
      () => {
        instance = factory();
        return instance;
      },
      {
        legacy: 'reject',
        responseMode: 'auto',
        maxRequestBodySize: MCP_REQUEST_BYTES,
        onerror: (error) =>
          structuredDiagnostic('warning', 'mcp-transport-error', 'MCP_TRANSPORT_ERROR', error),
      },
    );
    return completeExchange(
      request,
      (controlled) => handler.fetch(controlled),
      async () => {
        try {
          await handler.close();
        } finally {
          await instance?.close();
        }
      },
      options.deadlineMs ?? MCP_EXCHANGE_DEADLINE_MS,
    );
  }

  const server = factory();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  return completeExchange(
    request,
    async (controlled) => {
      await server.connect(transport);
      return transport.handleRequest(controlled);
    },
    () => server.close(),
    options.deadlineMs ?? MCP_EXCHANGE_DEADLINE_MS,
  );
}
