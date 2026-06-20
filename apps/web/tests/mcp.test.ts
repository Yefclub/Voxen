import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { deleteSetting, setSetting } from '../src/lib/settings';

async function call(body: unknown, token = ''): Promise<Response> {
  return app.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

describe('POST /mcp (auth)', () => {
  it('rejeita request sem Authorization', async () => {
    const res = await call({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(res.status).toBe(401);
  });

  it('rejeita token inválido', async () => {
    const res = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'token-errado');
    expect(res.status).toBe(401);
  });

  it('rejeita Origin divergente (defesa DNS rebinding)', async () => {
    const prev = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = 'https://voxen.example.com';
    try {
      const res = await app.fetch(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            origin: 'https://evil.example.com',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        }),
      );
      expect(res.status).toBe(403);
    } finally {
      if (prev === undefined) delete process.env.APP_BASE_URL;
      else process.env.APP_BASE_URL = prev;
    }
  });
});

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

describeIfDb('MCP Streamable HTTP (com DB)', () => {
  const TOKEN = 'test-mcp-token-' + 'z'.repeat(24);
  let userId = '';

  beforeAll(async () => {
    const user = await db.user.create({
      data: { email: `mcp-test-${Date.now()}@voxen.local`, name: 'MCP Test', status: 'APPROVED' },
    });
    userId = user.id;
    await setSetting('mcp_api_token', `${userId}:${TOKEN}`);
  });

  afterAll(async () => {
    await deleteSetting('mcp_api_token').catch(() => {});
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it('initialize negocia protocolo e devolve serverInfo', async () => {
    const res = await call(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      },
      TOKEN,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { result?: { serverInfo?: { name?: string } } };
    expect(data.result?.serverInfo?.name).toBe('voxen-mcp');
  });

  it('tools/list expõe tools voxen_ com readOnlyHint', async () => {
    const res = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, TOKEN);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      result?: { tools?: { name: string; annotations?: { readOnlyHint?: boolean } }[] };
    };
    const tools = data.result?.tools ?? [];
    const names = tools.map((t) => t.name);
    expect(names).toContain('voxen_search_transcripts');
    expect(names).toContain('voxen_read_transcript');
    expect(names).toContain('voxen_brain_search');
    const search = tools.find((t) => t.name === 'voxen_search_transcripts');
    expect(search?.annotations?.readOnlyHint).toBe(true);
  });

  it('tools/call voxen_list_transcripts retorna lista vazia escopada', async () => {
    const res = await call(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'voxen_list_transcripts', arguments: {} },
      },
      TOKEN,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      result?: { structuredContent?: { transcripts?: unknown[]; nextCursor?: string | null } };
    };
    expect(Array.isArray(data.result?.structuredContent?.transcripts)).toBe(true);
    expect(data.result?.structuredContent?.transcripts?.length).toBe(0);
    expect(data.result?.structuredContent?.nextCursor).toBe(null);
  });

  it('tools/call em transcript inexistente retorna isError (não erro de protocolo)', async () => {
    const res = await call(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'voxen_read_transcript', arguments: { transcript_id: 'nao-existe' } },
      },
      TOKEN,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { result?: { isError?: boolean } };
    expect(data.result?.isError).toBe(true);
  });

  it('tools/list inclui as write tools com readOnlyHint false', async () => {
    const res = await call({ jsonrpc: '2.0', id: 5, method: 'tools/list' }, TOKEN);
    const data = (await res.json()) as {
      result?: { tools?: { name: string; annotations?: { readOnlyHint?: boolean } }[] };
    };
    const tools = data.result?.tools ?? [];
    const names = tools.map((t) => t.name);
    expect(names).toContain('voxen_create_note');
    expect(names).toContain('voxen_update_note');
    expect(names).toContain('voxen_request_transcription');
    expect(names).toContain('voxen_get_job_status');
    const createNote = tools.find((t) => t.name === 'voxen_create_note');
    expect(createNote?.annotations?.readOnlyHint).toBe(false);
  });

  it('tools/call voxen_create_note cria a nota escopada por userId', async () => {
    const res = await call(
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'voxen_create_note', arguments: { title: 'Nota MCP', content: '# oi' } },
      },
      TOKEN,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { result?: { structuredContent?: { id?: string } } };
    const noteId = data.result?.structuredContent?.id;
    expect(typeof noteId).toBe('string');
    const note = await db.note.findFirst({ where: { id: noteId, userId } });
    expect(note?.title).toBe('Nota MCP');
    expect(note?.userId).toBe(userId);
  });

  it('voxen_update_note não edita nota de outro user (isolamento)', async () => {
    const other = await db.user.create({
      data: { email: `mcp-other-${Date.now()}@voxen.local`, name: 'Other', status: 'APPROVED' },
    });
    const otherNote = await db.note.create({
      data: { userId: other.id, kind: 'NOTE', title: 'Alheia', content: 'segredo' },
      select: { id: true },
    });
    const res = await call(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'voxen_update_note',
          arguments: { note_id: otherNote.id, content: 'hackeado' },
        },
      },
      TOKEN,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { result?: { isError?: boolean } };
    expect(data.result?.isError).toBe(true);
    const unchanged = await db.note.findUnique({ where: { id: otherNote.id } });
    expect(unchanged?.content).toBe('segredo');
  });
});
