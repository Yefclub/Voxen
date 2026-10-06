export const MCP_REQUEST_BYTES = 1024 * 1024;
export const MCP_EXCHANGE_DEADLINE_MS = 30_000;

export type PreparedMcpRequest = {
  request: Request;
  body: unknown;
  deadlineMs: number;
};

export function cancelledMcpRequest(timedOut = false): Response {
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

class BodyTooLarge extends Error {}
class CancelledBody extends Error {}

/** Start the deadline before reading any bytes; never wait for a stalled reader. */
export async function withMcpRequest(
  request: Request,
  handle: (prepared: PreparedMcpRequest) => Promise<Response>,
  options: { deadlineMs?: number } = {},
): Promise<Response> {
  if (request.signal.aborted) return cancelledMcpRequest();
  const deadlineMs = options.deadlineMs ?? MCP_EXCHANGE_DEADLINE_MS;
  const started = performance.now();
  const deadline = new AbortController();
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  const timer = setTimeout(
    () => deadline.abort(new DOMException('Request deadline exceeded', 'TimeoutError')),
    deadlineMs,
  );
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cancel!: () => void;
  const cancelled = new Promise<Response>((resolve) => {
    cancel = () => {
      void reader?.cancel().catch(() => undefined);
      resolve(cancelledMcpRequest(deadline.signal.aborted));
    };
  });
  signal.addEventListener('abort', cancel, { once: true });

  const readAndHandle = async (): Promise<Response> => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (request.body) {
      reader = request.body.getReader();
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > MCP_REQUEST_BYTES) throw new BodyTooLarge();
        chunks.push(next.value);
      }
    }
    if (signal.aborted) throw new CancelledBody();
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder().decode(bytes);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    if (body && typeof body === 'object' && !Array.isArray(body) && 'id' in body) {
      const id = body.id;
      if (
        (typeof id === 'string' && id.length > 128) ||
        (typeof id === 'number' && !Number.isSafeInteger(id))
      ) {
        return Response.json(
          {
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32600,
              message:
                'RPC identifiers must be strings of at most 128 characters or safe integers.',
            },
          },
          { status: 400 },
        );
      }
    }
    // A fresh buffered body avoids transferring a live Bun request stream.
    const prepared = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      signal,
      ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body: bytes }),
    });
    return handle({
      request: prepared,
      body,
      deadlineMs: Math.max(1, deadlineMs - (performance.now() - started)),
    });
  };

  try {
    return await Promise.race([readAndHandle(), cancelled]);
  } catch (error) {
    if (error instanceof BodyTooLarge) {
      void reader?.cancel().catch(() => undefined);
      return Response.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: 'Request body exceeds one MiB.' },
        },
        { status: 413 },
      );
    }
    if (error instanceof CancelledBody) return cancelledMcpRequest(deadline.signal.aborted);
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    try {
      reader?.releaseLock();
    } catch {
      /* A cancelled read may still be settling. */
    }
  }
}
