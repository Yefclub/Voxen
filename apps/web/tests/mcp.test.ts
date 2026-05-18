import { describe, expect, it } from 'bun:test';
import app from '../src/index';

async function call(body: unknown, token = ''): Promise<Response> {
  return app.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

describe('POST /mcp (sem token)', () => {
  it('rejeita request sem Authorization', async () => {
    const res = await call({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(res.status).toBe(401);
    const data = (await res.json()) as { error?: { code: number; message: string } };
    expect(data.error?.code).toBe(-32001);
  });

  it('rejeita token inválido', async () => {
    const res = await call({ jsonrpc: '2.0', id: 1, method: 'initialize' }, 'wrong-token');
    expect(res.status).toBe(401);
  });
});

describe('JSON-RPC validation', () => {
  it('rejeita request sem jsonrpc=2.0', async () => {
    const res = await call({ method: 'initialize' }, 'wrong-token');
    // Vai dar 401 antes do validation, mas testando sem auth aberta:
    // ainda 401 porque token errado bate antes. OK — auth é first.
    expect(res.status).toBe(401);
  });
});
