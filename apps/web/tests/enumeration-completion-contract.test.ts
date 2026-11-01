import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { hashMcpToken } from '../src/lib/mcp-tokens';
import { commitNoteVersion } from '../src/lib/note-versioning';

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

// Explicit enumeration completion (spec 217 §3): list tools report hasMore,
// and hasMore=false with a null cursor means the defined set is complete —
// no duplicates or omissions across pages.
describeIfDb('enumeration completion contract (spec 217)', () => {
  const TOKEN = 'test-enum-complete-' + 'k'.repeat(20);
  let userId = '';
  let noteId = '';

  beforeAll(async () => {
    const user = await db.user.create({
      data: { email: `enum-${Date.now()}@voxen.local`, name: 'Enum', status: 'APPROVED' },
    });
    userId = user.id;
    await db.mcpToken.create({
      data: { userId, tokenHash: hashMcpToken(TOKEN), label: 'Enum', scopes: 'READ,WRITE' },
    });
    for (let i = 0; i < 5; i++) {
      await db.transcript.create({
        data: {
          userId,
          source: 'WEB',
          url: `https://example.com/enum-${i}`,
          title: `Enum doc ${i}`,
          durationSec: 0,
          language: 'pt',
          transcriptionMethod: 'SCRAPE',
          mdPath: `workspaces/${userId}/transcripts/enum-${i}.md`,
          plainText: `Documento enum ${i}.`,
          frontmatter: {},
        },
      });
      await db.note.create({
        data: { userId, kind: 'NOTE', title: `Enum nota ${i}`, content: `Nota enum ${i}.` },
      });
    }
    const created = (await callTool(TOKEN, 'voxen_create_note', {
      title: 'Enum revisões',
      content: 'v1',
    })) as { id: string };
    noteId = created.id;
    await commitNoteVersion({
      userId,
      noteId,
      expectedRevision: 1,
      actor: 'USER',
      changeSummary: 'v2',
      changes: { content: 'v2' },
    });
    await commitNoteVersion({
      userId,
      noteId,
      expectedRevision: 2,
      actor: 'USER',
      changeSummary: 'v3',
      changes: { content: 'v3' },
    });
  });

  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  });

  it('walks transcripts without duplicates or omissions and signals completion', async () => {
    const first = (await callTool(TOKEN, 'voxen_list_transcripts', { limit: 2 })) as {
      transcripts: Array<{ id: string }>;
      nextCursor: string | null;
      hasMore: boolean;
    };
    expect(first.transcripts).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const second = (await callTool(TOKEN, 'voxen_list_transcripts', {
      limit: 2,
      cursor: first.nextCursor,
    })) as typeof first;
    expect(second.transcripts).toHaveLength(2);
    expect(second.hasMore).toBe(true);

    const last = (await callTool(TOKEN, 'voxen_list_transcripts', {
      limit: 2,
      cursor: second.nextCursor,
    })) as typeof first;
    expect(last.transcripts).toHaveLength(1);
    expect(last.hasMore).toBe(false);
    expect(last.nextCursor).toBeNull();

    const ids = [...first.transcripts, ...second.transcripts, ...last.transcripts].map(
      (item) => item.id,
    );
    expect(new Set(ids).size).toBe(5);
  });

  it('walks notes without duplicates or omissions and signals completion', async () => {
    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const page = (await callTool(TOKEN, 'voxen_list_notes', {
        limit: 2,
        ...(cursor ? { cursor } : {}),
      })) as { notes: Array<{ id: string }>; nextCursor: string | null; hasMore: boolean };
      pages += 1;
      for (const note of page.notes) {
        expect(seen.has(note.id)).toBe(false);
        seen.add(note.id);
      }
      if (!page.hasMore) {
        expect(page.nextCursor).toBeNull();
        break;
      }
      expect(page.nextCursor).not.toBeNull();
      cursor = page.nextCursor!;
      expect(pages).toBeLessThan(10);
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });

  it('walks note revisions with explicit completion', async () => {
    const first = (await callTool(TOKEN, 'voxen_list_note_revisions', {
      note_id: noteId,
      limit: 2,
    })) as { revisions: Array<{ revision: number }>; nextBefore: number | null; hasMore: boolean };
    expect(first.revisions.map((item) => item.revision)).toEqual([3, 2]);
    expect(first.hasMore).toBe(true);
    expect(first.nextBefore).toBe(2);

    const last = (await callTool(TOKEN, 'voxen_list_note_revisions', {
      note_id: noteId,
      limit: 2,
      before_revision: first.nextBefore,
    })) as typeof first;
    expect(last.revisions.map((item) => item.revision)).toEqual([1]);
    expect(last.hasMore).toBe(false);
    expect(last.nextBefore).toBeNull();
  });

  it('rejects altered pagination cursors', async () => {
    const res = await mcpCall(
      {
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/call',
        params: { name: 'voxen_list_transcripts', arguments: { cursor: 'bogus.cursor' } },
      },
      TOKEN,
    );
    const body = (await res.json()) as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result?.isError).toBe(true);
    expect(JSON.stringify(body.result?.content)).toContain('MCP_INVALID_CURSOR');
  });

  it('lists transcript corrections with explicit completion', async () => {
    const transcript = await db.transcript.findFirstOrThrow({
      where: { userId, url: 'https://example.com/enum-0' },
    });
    for (const revision of [1, 2, 3]) {
      await db.transcriptCorrectionRevision.create({
        data: {
          userId,
          transcriptId: transcript.id,
          revision,
          sourceVersion: 0,
          sourceChecksum: null,
          markdown: `# v${revision}`,
          plainText: `v${revision}`,
          checksum: `checksum-${revision}`,
          actor: 'USER',
        },
      });
    }
    const first = (await callTool(TOKEN, 'voxen_list_transcript_corrections', {
      transcript_id: transcript.id,
      limit: 2,
    })) as { revisions: Array<{ revision: number }>; nextBefore: number | null; hasMore: boolean };
    expect(first.revisions.map((item) => item.revision)).toEqual([3, 2]);
    expect(first.hasMore).toBe(true);
    expect(first.nextBefore).toBe(2);

    const last = (await callTool(TOKEN, 'voxen_list_transcript_corrections', {
      transcript_id: transcript.id,
      limit: 2,
      before_revision: first.nextBefore,
    })) as typeof first;
    expect(last.revisions.map((item) => item.revision)).toEqual([1]);
    expect(last.hasMore).toBe(false);
    expect(last.nextBefore).toBeNull();
  });
});
