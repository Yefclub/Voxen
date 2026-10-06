import { MCP_RESULT_WIRE_BYTES } from './mcp-result-budget';

/** Bound SDK validation errors as well as domain replies; leave catalog discovery intact. */
export async function boundMcpToolResponse(response: Response, body: unknown): Promise<Response> {
  if (
    !body ||
    typeof body !== 'object' ||
    !('method' in body) ||
    body.method !== 'tools/call' ||
    !response.body
  )
    return response;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MCP_RESULT_WIRE_BYTES) {
        void reader.cancel().catch(() => undefined);
        const id = 'id' in body ? body.id : null;
        const safeId =
          (typeof id === 'string' && id.length <= 128) ||
          (typeof id === 'number' && Number.isSafeInteger(id))
            ? id
            : null;
        const headers = new Headers(response.headers);
        headers.delete('content-length');
        headers.set('content-type', 'application/json');
        return Response.json(
          {
            jsonrpc: '2.0',
            id: safeId,
            error: {
              code: -32000,
              message:
                'MCP reply exceeds the wire budget. Check current state before retrying writes.',
            },
          },
          { status: response.status, headers },
        );
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new Response(bytes, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } finally {
    reader.releaseLock();
  }
}
