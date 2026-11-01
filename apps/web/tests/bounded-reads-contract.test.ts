import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import app from '../src/index';
import { db } from '../src/lib/db';
import { hashMcpToken } from '../src/lib/mcp-tokens';
import {
  clearTranscriptReadCache,
  getTranscriptReadCacheStats,
  invalidateTranscriptReadCache,
  loadEffectiveTranscriptMarkdown,
  TranscriptReadError,
} from '../src/lib/transcript-content';

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

describeIfDb('bounded progressive reads contract (spec 216)', () => {
  const TOKEN = 'test-bounded-reads-' + 'k'.repeat(20);
  let userId = '';
  let transcriptId = '';

  beforeAll(async () => {
    process.env.STORAGE_LOCAL_PATH = await mkdtemp(join(tmpdir(), 'voxen-test-storage-'));
    const user = await db.user.create({
      data: { email: `bounded-${Date.now()}@voxen.local`, name: 'Bounded', status: 'APPROVED' },
    });
    userId = user.id;
    await db.mcpToken.create({
      data: { userId, tokenHash: hashMcpToken(TOKEN), label: 'Bounded', scopes: 'READ,WRITE' },
    });
    const transcript = await db.transcript.create({
      data: {
        userId,
        source: 'WEB',
        url: 'https://example.com/bounded',
        title: 'Documento com seções',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${userId}/transcripts/bounded.md`,
        plainText: 'Documento com seções conteúdo.',
        frontmatter: {},
      },
    });
    transcriptId = transcript.id;
    const { storagePut } = await import('../src/lib/storage');
    await storagePut({
      key: `workspaces/${userId}/transcripts/bounded.md`,
      body: '# Intro\n\ntexto base\n\n## Detalhes\n\nconteúdo detalhado\n',
      contentType: 'text/markdown',
    });
  });

  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  });

  it('repete leitura estreita pelo cache versionado sem reler o storage', async () => {
    clearTranscriptReadCache();
    const first = await loadEffectiveTranscriptMarkdown(userId, transcriptId);
    expect(first.md).toContain('## Detalhes');
    const afterFirst = getTranscriptReadCacheStats();
    expect(afterFirst.misses).toBe(1);

    const second = await loadEffectiveTranscriptMarkdown(userId, transcriptId);
    expect(second.md).toBe(first.md);
    const afterSecond = getTranscriptReadCacheStats();
    expect(afterSecond.hits).toBeGreaterThanOrEqual(1);
    expect(afterSecond.entries).toBeLessThanOrEqual(50);
  });

  it('invalidação por documento limpa o cache', async () => {
    await loadEffectiveTranscriptMarkdown(userId, transcriptId);
    expect(getTranscriptReadCacheStats().entries).toBeGreaterThanOrEqual(1);
    invalidateTranscriptReadCache(userId, transcriptId);
    expect(getTranscriptReadCacheStats().entries).toBe(0);
  });

  it('rejeita revisão desatualizada com STALE_REVISION', async () => {
    const doc = await loadEffectiveTranscriptMarkdown(userId, transcriptId);
    await expect(
      loadEffectiveTranscriptMarkdown(userId, transcriptId, {
        expectedCorrectionRevision: doc.correctionRevision + 99,
      }),
    ).rejects.toMatchObject({ name: 'TranscriptReadError', code: 'STALE_REVISION' });

    const res = await mcpCall(
      {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'voxen_outline',
          arguments: {
            transcript_id: transcriptId,
            correction_revision: doc.correctionRevision + 99,
          },
        },
      },
      TOKEN,
    );
    const body = (await res.json()) as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result?.isError).toBe(true);
    expect(JSON.stringify(body.result?.content)).toContain('STALE_REVISION');
  });

  it('reporta fonte ausente e inexistente explicitamente', async () => {
    await expect(loadEffectiveTranscriptMarkdown(userId, 'missing-id')).rejects.toMatchObject({
      name: 'TranscriptReadError',
      code: 'NOT_FOUND',
    });

    const ghost = await db.transcript.create({
      data: {
        userId,
        source: 'WEB',
        url: 'https://example.com/ghost',
        title: 'Fantasma',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${userId}/transcripts/ghost-missing.md`,
        plainText: 'Fantasma.',
        frontmatter: {},
      },
    });
    await expect(loadEffectiveTranscriptMarkdown(userId, ghost.id)).rejects.toMatchObject({
      code: 'UNAVAILABLE_SOURCE',
    });
    expect(TranscriptReadError).toBeDefined();

    const res = await mcpCall(
      {
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'voxen_read_lines',
          arguments: { transcript_id: ghost.id, from: 1, to: 3 },
        },
      },
      TOKEN,
    );
    const body = (await res.json()) as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result?.isError).toBe(true);
    expect(JSON.stringify(body.result?.content)).toContain('UNAVAILABLE_SOURCE');
  });

  it('leituras MCP estreitas funcionam sobre o cache', async () => {
    const outline = (await callTool(TOKEN, 'voxen_outline', { transcript_id: transcriptId })) as {
      sections: Array<{ heading: string }>;
    };
    expect(outline.sections.map((section) => section.heading)).toContain('Detalhes');

    const lines = (await callTool(TOKEN, 'voxen_read_lines', {
      transcript_id: transcriptId,
      from: 1,
      to: 2,
    })) as { lines: Array<{ n: number; text: string }> };
    expect(lines.lines.length).toBeGreaterThan(0);
  });
});
