import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { hashMcpToken } from '../src/lib/mcp-tokens';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

async function mcpCall(body: unknown, token: string): Promise<Response> {
  return app.fetch(
    new Request(new URL('/mcp', process.env.APP_BASE_URL || 'http://localhost'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

type CallResult = {
  id: string;
  title: string;
  revision: number;
  checksum: string;
  duplicate?: boolean;
};

async function callTool(token: string, name: string, args: unknown, id = 1): Promise<unknown> {
  const res = await mcpCall(
    { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
    token,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    result?: { structuredContent?: unknown };
    error?: unknown;
  };
  expect(body.error ?? null).toBeNull();
  return body.result?.structuredContent;
}

describeIfDb('prepared-content ingestion contract v1', () => {
  const TOKEN = 'test-prepared-ingest-' + 'k'.repeat(20);
  let userId = '';

  beforeAll(async () => {
    const user = await db.user.create({
      data: { email: `prepared-${Date.now()}@voxen.local`, name: 'Prepared', status: 'APPROVED' },
    });
    userId = user.id;
    await db.mcpToken.create({
      data: { userId, tokenHash: hashMcpToken(TOKEN), label: 'Prepared', scopes: 'READ,WRITE' },
    });
  });

  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  });

  it('idempotent retries return the original note instead of duplicating', async () => {
    const first = (await callTool(TOKEN, 'voxen_create_note', {
      title: 'Prepared doc',
      content: 'Hello',
      contract_version: '1',
      idempotency_key: 'doc-1',
      producer_id: 'extractor-a',
      external_id: 'ext-1',
    })) as CallResult;
    expect(first.duplicate).toBe(false);

    const second = (await callTool(TOKEN, 'voxen_create_note', {
      title: 'Prepared doc',
      content: 'Hello',
      contract_version: '1',
      idempotency_key: 'doc-1',
      producer_id: 'extractor-a',
      external_id: 'ext-1',
    })) as CallResult;
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);

    const notes = await db.note.findMany({ where: { userId, title: 'Prepared doc' } });
    expect(notes).toHaveLength(1);
    const revisions = await db.noteRevision.count({ where: { noteId: first.id } });
    expect(revisions).toBe(1);
  });

  it('rejects unknown contract versions and invalid keys', async () => {
    const badVersion = await mcpCall(
      {
        jsonrpc: '2.0',
        id: 90,
        method: 'tools/call',
        params: {
          name: 'voxen_create_note',
          arguments: { title: 'X', contract_version: '99', idempotency_key: 'doc-2' },
        },
      },
      TOKEN,
    );
    const badBody = (await badVersion.json()) as { result?: { isError?: boolean } };
    expect(badBody.result?.isError).toBe(true);

    const badKey = await mcpCall(
      {
        jsonrpc: '2.0',
        id: 91,
        method: 'tools/call',
        params: {
          name: 'voxen_create_note',
          arguments: { title: 'X', idempotency_key: 'not a key!!' },
        },
      },
      TOKEN,
    );
    const badKeyBody = (await badKey.json()) as { result?: { isError?: boolean } };
    expect(badKeyBody.result?.isError).toBe(true);
  });

  it('batch import reports per-item outcomes without duplicating retries', async () => {
    const batch = (await callTool(TOKEN, 'voxen_import_notes', {
      contract_version: '1',
      items: [
        { title: 'Batch one', idempotency_key: 'batch-1' },
        { title: 'Batch two', idempotency_key: 'batch-2' },
        { title: '', idempotency_key: 'batch-bad' },
      ],
    })) as {
      total: number;
      created: number;
      duplicated: number;
      items: Array<{ index: number; outcome: string; noteId: string | null; error: string | null }>;
    };
    expect(batch.total).toBe(3);
    expect(batch.created).toBe(2);
    expect(batch.items[0]?.outcome).toBe('created');
    expect(batch.items[1]?.outcome).toBe('created');
    expect(batch.items[2]?.outcome).toBe('error');

    const retry = (await callTool(TOKEN, 'voxen_import_notes', {
      items: [{ title: 'Batch one', idempotency_key: 'batch-1' }],
    })) as typeof batch;
    expect(retry.created).toBe(0);
    expect(retry.duplicated).toBe(1);
    expect(retry.items[0]?.noteId).toBe(batch.items[0]?.noteId);
  });

  it('concurrent identical creates converge to a single note', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        mcpCall(
          {
            jsonrpc: '2.0',
            id: 1000 + index,
            method: 'tools/call',
            params: {
              name: 'voxen_create_note',
              arguments: { title: 'Racy doc', content: 'same', idempotency_key: 'race-1' },
            },
          },
          TOKEN,
        )
          .then(async (res) => {
            const body = (await res.json()) as unknown;
            const sc = (body as { result?: { structuredContent?: CallResult } }).result
              ?.structuredContent;
            if (!sc) return { ok: false as const, id: null as string | null };
            return { ok: true as const, id: sc.id };
          })
          .catch(() => ({ ok: false as const, id: null as string | null })),
      ),
    );
    // O servidor pode derramar carga (MCP_BUSY, limite 4 por dono); cada
    // criação admitida deve resolver para o mesmo documento armazenado.
    const ids = new Set(attempts.filter((a) => a.ok).map((a) => a.id));
    if (ids.size > 0) expect([...ids]).toHaveLength(1);
    expect(ids.size).toBeGreaterThan(0);
    const notes = await db.note.findMany({ where: { userId, title: 'Racy doc' } });
    expect(notes).toHaveLength(1);
  });

  it('isolates idempotency keys per workspace', async () => {
    const other = await db.user.create({
      data: {
        email: `prepared-other-${Date.now()}@voxen.local`,
        name: 'Other',
        status: 'APPROVED',
      },
    });
    const otherToken = `test-prepared-other-${Date.now()}`;
    await db.mcpToken.create({
      data: {
        userId: other.id,
        tokenHash: hashMcpToken(otherToken),
        label: 'O',
        scopes: 'READ,WRITE',
      },
    });
    try {
      const first = (await callTool(otherToken, 'voxen_create_note', {
        title: 'Same key',
        idempotency_key: 'shared-key',
      })) as CallResult;
      const second = (await callTool(TOKEN, 'voxen_create_note', {
        title: 'Same key',
        idempotency_key: 'shared-key',
      })) as CallResult;
      expect(first.id).not.toBe(second.id);
      expect(second.duplicate ?? false).toBe(false);
    } finally {
      await db.user.delete({ where: { id: other.id } }).catch(() => undefined);
    }
  });

  it('HTTP create honors the same contract', async () => {
    const email = `httpprep-${Date.now()}@voxen.local`;
    const signup = await app.fetch(
      new Request('http://localhost/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'senha-super-segura-123', name: 'H' }),
      }),
    );
    expect(signup.status).toBe(200);
    await db.user.update({ where: { email }, data: { status: 'APPROVED' } });
    const signin = await app.fetch(
      new Request('http://localhost/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'senha-super-segura-123' }),
      }),
    );
    expect(signin.status).toBe(200);
    const cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const post = async (
      body: unknown,
      expected: number,
    ): Promise<{ note: { id: string }; duplicate?: boolean }> => {
      const res = await app.fetch(
        new Request('http://localhost/api/notes', {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
      expect(res.status).toBe(expected);
      return (await res.json()) as { note: { id: string }; duplicate?: boolean };
    };
    const created = await post({ title: 'HTTP doc', content: 'x', idempotency_key: 'http-1' }, 201);
    expect(created.duplicate).toBe(false);
    const retried = await post({ title: 'HTTP doc', content: 'x', idempotency_key: 'http-1' }, 200);
    expect(retried.duplicate).toBe(true);
    expect(retried.note.id).toBe(created.note.id);
  });
});
