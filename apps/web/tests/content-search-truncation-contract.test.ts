import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { hashMcpToken } from '../src/lib/mcp-tokens';
import { searchWithinNotePage, searchWithinTextPage } from '../src/lib/note-revisions';
import { searchWithinTranscriptPage } from '../src/lib/transcript-corrections';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

describe('within-document search pagination (pure)', () => {
  it('signals truncation with a take+1 probe and stable order', () => {
    const body = Array.from({ length: 5 }, (_, i) => `agulha ${i}`).join('\n');
    const page = searchWithinTextPage(body, 'agulha', { limit: 2, contextChars: 0 });
    expect(page.matches.map((match) => match.matchedText)).toEqual(['agulha', 'agulha']);
    expect(page.matches.map((match) => match.occurrence)).toEqual([1, 2]);
    expect(page.truncated).toBe(true);

    const full = searchWithinTextPage(body, 'agulha', { limit: 5, contextChars: 0 });
    expect(full.truncated).toBe(false);
    expect(full.matches).toHaveLength(5);
    expect(full.matches.slice(0, 2).map((match) => match.start)).toEqual(
      page.matches.map((match) => match.start),
    );
  });

  it('reports a complete empty search without truncation', () => {
    const page = searchWithinTextPage('texto sem o termo', 'xqzt', { limit: 5 });
    expect(page.matches).toEqual([]);
    expect(page.truncated).toBe(false);
  });

  it('works at the maximum limit', () => {
    const body = Array.from({ length: 150 }, () => 'agulha').join('\n');
    const page = searchWithinNotePage(body, 'agulha', { limit: 100, contextChars: 0 });
    expect(page.matches).toHaveLength(100);
    expect(page.truncated).toBe(true);
    const clamped = searchWithinTranscriptPage(body, 'agulha', { limit: 150, contextChars: 0 });
    expect(clamped.matches).toHaveLength(100);
    expect(clamped.truncated).toBe(true);
  });
});

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

// Within-document search contract (spec 217 §3): a full page never implies
// complete enumeration of occurrences; truncated is explicit.
describeIfDb('within-document search truncation contract (spec 217)', () => {
  const TOKEN = 'test-content-trunc-' + 'k'.repeat(20);
  let userId = '';
  let noteId = '';
  let transcriptId = '';

  beforeAll(async () => {
    const user = await db.user.create({
      data: {
        email: `content-trunc-${Date.now()}@voxen.local`,
        name: 'Content',
        status: 'APPROVED',
      },
    });
    userId = user.id;
    await db.mcpToken.create({
      data: { userId, tokenHash: hashMcpToken(TOKEN), label: 'Content', scopes: 'READ,WRITE' },
    });
    const note = await db.note.create({
      data: {
        userId,
        kind: 'NOTE',
        title: 'Caderno de agulhas',
        content: Array.from({ length: 4 }, (_, i) => `agulha número ${i}`).join('\n'),
      },
    });
    noteId = note.id;
    const transcript = await db.transcript.create({
      data: {
        userId,
        source: 'WEB',
        url: 'https://example.com/agulhas',
        title: 'Manual de agulhas',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${userId}/transcripts/agulhas.md`,
        plainText: 'Manual de agulhas.',
        frontmatter: {},
      },
    });
    transcriptId = transcript.id;
    const { storagePut } = await import('../src/lib/storage');
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    process.env.STORAGE_LOCAL_PATH = await mkdtemp(join(tmpdir(), 'voxen-content-test-'));
    await storagePut({
      key: `workspaces/${userId}/transcripts/agulhas.md`,
      body: ['# Manual', '', ...Array.from({ length: 4 }, (_, i) => `agulha número ${i}`)].join(
        '\n',
      ),
      contentType: 'text/markdown',
    });
  });

  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  });

  it('voxen_search_note_content flags truncation', async () => {
    const out = (await callTool(TOKEN, 'voxen_search_note_content', {
      note_id: noteId,
      query: 'agulha',
      limit: 2,
    })) as { matches: unknown[]; truncated: boolean };
    expect(out.matches).toHaveLength(2);
    expect(out.truncated).toBe(true);

    const full = (await callTool(TOKEN, 'voxen_search_note_content', {
      note_id: noteId,
      query: 'agulha',
      limit: 10,
    })) as { matches: unknown[]; truncated: boolean };
    expect(full.matches).toHaveLength(4);
    expect(full.truncated).toBe(false);
  });

  it('voxen_search_transcript_content flags truncation', async () => {
    const out = (await callTool(TOKEN, 'voxen_search_transcript_content', {
      transcript_id: transcriptId,
      query: 'agulha',
      limit: 2,
    })) as { matches: unknown[]; truncated: boolean };
    expect(out.matches).toHaveLength(2);
    expect(out.truncated).toBe(true);

    const full = (await callTool(TOKEN, 'voxen_search_transcript_content', {
      transcript_id: transcriptId,
      query: 'agulha',
      limit: 10,
    })) as { matches: Array<{ occurrence: number }>; truncated: boolean };
    expect(full.matches.map((match) => match.occurrence)).toEqual([1, 2, 3, 4]);
    expect(full.truncated).toBe(false);
  });
});
