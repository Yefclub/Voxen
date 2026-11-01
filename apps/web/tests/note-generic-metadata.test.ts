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

const PASSWORD = 'safe-note-metadata-password-123';

async function httpRequest(
  path: string,
  cookie: string,
  method = 'GET',
  body?: unknown,
): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        cookie,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

// Generic prepared documents (spec 216 §2): notes carry external-document
// provenance (language/author/source URL/publication date) with no fabricated
// media values. Metadata is document-level: set at creation, preserved across
// revisions and idempotent retries.
describeIfDb('generic prepared-document metadata (spec 216 §2)', () => {
  const TOKEN = 'test-note-metadata-' + 'k'.repeat(20);
  let userId = '';
  let cookie = '';

  beforeAll(async () => {
    const email = `metadata-${Date.now()}@voxen.local`;
    const signup = await app.fetch(
      new Request('http://localhost/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: PASSWORD, name: 'Metadata' }),
      }),
    );
    expect(signup.status).toBe(200);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    await db.user.update({ where: { id: user.id }, data: { status: 'APPROVED' } });
    userId = user.id;
    const signin = await app.fetch(
      new Request('http://localhost/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: PASSWORD }),
      }),
    );
    expect(signin.status).toBe(200);
    cookie = (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    await db.mcpToken.create({
      data: { userId, tokenHash: hashMcpToken(TOKEN), label: 'Metadata', scopes: 'READ,WRITE' },
    });
  });

  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  });

  it('stores metadata on MCP create and returns it on read', async () => {
    const created = (await callTool(TOKEN, 'voxen_create_note', {
      title: 'Relatório Atlas',
      content: 'Conteúdo preparado.',
      contract_version: '1',
      idempotency_key: 'meta-1',
      language: 'pt',
      author: 'Equipe Atlas',
      source_url: 'https://example.com/atlas',
      published_at: '2024-06-01T00:00:00.000Z',
    })) as { id: string; duplicate: boolean };
    expect(created.duplicate).toBe(false);

    const read = (await callTool(TOKEN, 'voxen_read_note', { note_id: created.id })) as {
      language: string | null;
      author: string | null;
      sourceUrl: string | null;
      publishedAt: string | null;
    };
    expect(read.language).toBe('pt');
    expect(read.author).toBe('Equipe Atlas');
    expect(read.sourceUrl).toBe('https://example.com/atlas');
    expect(read.publishedAt).toBe('2024-06-01T00:00:00.000Z');
  });

  it('imports metadata per item and preserves it on idempotent retry', async () => {
    const res = await mcpCall(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'voxen_import_notes',
          arguments: {
            contract_version: '1',
            items: [
              {
                title: 'Doc importado',
                content: 'Corpo.',
                idempotency_key: 'meta-batch-1',
                language: 'en',
                author: 'Atlas Labs',
              },
            ],
          },
        },
      },
      TOKEN,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { structuredContent?: { items: Array<{ outcome: string; noteId: string }> } };
    };
    const item = body.result?.structuredContent?.items[0];
    expect(item?.outcome).toBe('created');

    const retry = await mcpCall(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'voxen_import_notes',
          arguments: {
            contract_version: '1',
            items: [{ title: 'Doc importado', idempotency_key: 'meta-batch-1', language: 'en' }],
          },
        },
      },
      TOKEN,
    );
    const retryBody = (await retry.json()) as {
      result?: { structuredContent?: { items: Array<{ outcome: string; noteId: string }> } };
    };
    expect(retryBody.result?.structuredContent?.items[0]?.outcome).toBe('duplicate');
    expect(retryBody.result?.structuredContent?.items[0]?.noteId).toBe(item?.noteId);

    const stored = await db.note.findUniqueOrThrow({ where: { id: item!.noteId } });
    expect(stored.language).toBe('en');
    expect(stored.author).toBe('Atlas Labs');
    expect(await db.noteRevision.count({ where: { noteId: item!.noteId } })).toBe(1);
  });

  it('stores metadata over HTTP and preserves it across revisions and legacy rows', async () => {
    const created = await httpRequest('/api/notes', cookie, 'POST', {
      kind: 'NOTE',
      title: 'HTTP Atlas',
      content: 'v1',
      contract_version: '1',
      idempotency_key: 'meta-http-1',
      metadata: {
        language: 'pt',
        author: 'Atlas',
        source_url: 'https://example.com/http-atlas',
        published_at: '2023-01-15T00:00:00.000Z',
      },
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      note: { id: string; language: string; author: string; sourceUrl: string };
      duplicate: boolean;
    };
    expect(createdBody.duplicate).toBe(false);
    expect(createdBody.note.language).toBe('pt');

    const detail = await httpRequest(`/api/notes/${createdBody.note.id}`, cookie);
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as {
      note: { author: string; sourceUrl: string; publishedAt: string };
    };
    expect(detailBody.note.author).toBe('Atlas');
    expect(detailBody.note.sourceUrl).toBe('https://example.com/http-atlas');

    const patched = await httpRequest(`/api/notes/${createdBody.note.id}`, cookie, 'PATCH', {
      expectedRevision: 1,
      content: 'v2 curado',
    });
    expect(patched.status).toBe(200);
    const after = await db.note.findUniqueOrThrow({ where: { id: createdBody.note.id } });
    expect(after.revision).toBe(2);
    expect(after.author).toBe('Atlas');
    expect(after.language).toBe('pt');

    const legacy = await db.note.create({
      data: { userId, kind: 'NOTE', title: 'Legado', content: 'sem metadados' },
    });
    const legacyRead = (await callTool(TOKEN, 'voxen_read_note', { note_id: legacy.id })) as {
      language: string | null;
      author: string | null;
    };
    expect(legacyRead.language).toBeNull();
    expect(legacyRead.author).toBeNull();
  });

  it('rejects invalid metadata without creating anything', async () => {
    const before = await db.note.count({ where: { userId } });
    const badDate = await mcpCall(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'voxen_create_note',
          arguments: { title: 'Ruim', published_at: 'not-a-date' },
        },
      },
      TOKEN,
    );
    expect(((await badDate.json()) as { result?: { isError?: boolean } }).result?.isError).toBe(
      true,
    );

    const badHttp = await httpRequest('/api/notes', cookie, 'POST', {
      kind: 'NOTE',
      title: 'Ruim HTTP',
      metadata: { language: 'xx!' },
    });
    expect(badHttp.status).toBe(400);
    expect(await db.note.count({ where: { userId } })).toBe(before);
  });
});
