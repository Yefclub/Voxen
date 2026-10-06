import {
  createMcpHandler,
  isLegacyRequest,
  type McpServer,
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/server';
import { structuredDiagnostic } from '../lib/structured-log';

import {
  MCP_REQUEST_BYTES,
  withMcpRequest,
  cancelledMcpRequest,
  type PreparedMcpRequest,
} from './mcp-request-body';

async function completeExchange(
  request: Request,
  execute: (request: Request) => Promise<Response>,
  close: () => Promise<void>,
  deadlineMs: number,
): Promise<Response> {
  const deadline = new AbortController();
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  const timer = setTimeout(() => deadline.abort(), deadlineMs);
  let closing: Promise<void> | undefined;
  const closeOnce = () =>
    (closing ??= close().catch((error: unknown) =>
      structuredDiagnostic(
        'warning',
        'mcp-transport-close-error',
        'MCP_TRANSPORT_CLOSE_ERROR',
        error,
      ),
    ));
  const timedOut = () =>
    deadline.signal.aborted ||
    (request.signal.reason instanceof DOMException &&
      request.signal.reason.name === 'TimeoutError');
  let onAbort = () => {};
  const cancelled = new Promise<Response>((resolve) => {
    onAbort = () => {
      void closeOnce();
      resolve(cancelledMcpRequest(timedOut()));
    };
  });
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal.aborted) return cancelledMcpRequest(timedOut());
    return await Promise.race([execute(request), cancelled]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    await closeOnce();
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
  return withMcpRequest(
    request,
    (prepared) => servePreparedMcpExchange(prepared, factory),
    options,
  );
}

export async function servePreparedMcpExchange(
  prepared: PreparedMcpRequest,
  factory: () => McpServer,
): Promise<Response> {
  const { request, body, deadlineMs } = prepared;
  if (request.signal.aborted)
    return cancelledMcpRequest(
      request.signal.reason instanceof DOMException &&
        request.signal.reason.name === 'TimeoutError',
    );
  if (request.method !== 'POST') return rejectedExchange(405);

  // Voxen does not publish subscription capabilities or cross-request events.
  // Reject listen explicitly so a client cannot open an empty keepalive stream.
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
      deadlineMs,
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
    deadlineMs,
  );
}
