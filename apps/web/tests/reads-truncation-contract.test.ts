import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import app from '../src/index';
import { db } from '../src/lib/db';
import { hashMcpToken } from '../src/lib/mcp-tokens';
import { MAX_OUTLINE_SECTIONS, expandContextFromMd, parseOutline } from '../src/lib/retrieval';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

describe('reads truncation (pure)', () => {
  it('parseOutline marca truncated ao cortar em 300 seções', () => {
    const md = Array.from({ length: MAX_OUTLINE_SECTIONS + 5 }, (_, i) => `# Seção ${i + 1}`).join(
      '\n\ncorpo\n',
    );
    const outline = parseOutline(md);
    expect(outline.sections).toHaveLength(MAX_OUTLINE_SECTIONS);
    expect(outline.truncated).toBe(true);
  });

  it('parseOutline não marca truncated em documento pequeno', () => {
    const outline = parseOutline('# A\n\ntexto\n\n## B\n\nmais texto\n');
    expect(outline.truncated).toBe(false);
    expect(outline.sections).toHaveLength(2);
  });

  it('expandContextFromMd propaga truncated do cap de 200 linhas', () => {
    const md = Array.from({ length: 500 }, (_, i) => `linha ${i + 1}`).join('\n');
    const expanded = expandContextFromMd(md, { line: 250 }, 200);
    expect(expanded).not.toBeNull();
    expect(expanded!.truncated).toBe(true);
    expect(expanded!.lines.length).toBeLessThanOrEqual(200);
  });

  it('expandContextFromMd não marca truncated em janela pequena', () => {
    const md = Array.from({ length: 20 }, (_, i) => `linha ${i + 1}`).join('\n');
    const expanded = expandContextFromMd(md, { line: 10 }, 2);
    expect(expanded).not.toBeNull();
    expect(expanded!.truncated).toBe(false);
    expect(expanded!.lines).toHaveLength(5);
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

describeIfDb('reads truncation contract (spec 217)', () => {
  const TOKEN = 'test-reads-trunc-' + 'k'.repeat(20);
  let userId = '';
  let transcriptId = '';

  beforeAll(async () => {
    process.env.STORAGE_LOCAL_PATH = await mkdtemp(join(tmpdir(), 'voxen-test-storage-'));
    const user = await db.user.create({
      data: { email: `reads-trunc-${Date.now()}@voxen.local`, name: 'Reads', status: 'APPROVED' },
    });
    userId = user.id;
    await db.mcpToken.create({
      data: { userId, tokenHash: hashMcpToken(TOKEN), label: 'Reads', scopes: 'READ,WRITE' },
    });
    const transcript = await db.transcript.create({
      data: {
        userId,
        source: 'WEB',
        url: 'https://example.com/reads-trunc',
        title: 'Documento longo',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${userId}/transcripts/reads-trunc.md`,
        plainText: 'Documento longo.',
        frontmatter: {},
      },
    });
    transcriptId = transcript.id;
    const { storagePut } = await import('../src/lib/storage');
    const bigMd = Array.from({ length: 500 }, (_, i) => `linha ${i + 1}`).join('\n');
    await storagePut({
      key: `workspaces/${userId}/transcripts/reads-trunc.md`,
      body: bigMd,
      contentType: 'text/markdown',
    });
  });

  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  });

  it('voxen_outline expõe truncated=false em documento pequeno', async () => {
    const outline = (await callTool(TOKEN, 'voxen_outline', {
      transcript_id: transcriptId,
    })) as { truncated: boolean; totalLines: number };
    expect(outline.truncated).toBe(false);
    expect(outline.totalLines).toBe(500);
  });

  it('voxen_expand_context expõe truncated=true quando a janela estoura o cap', async () => {
    const expanded = (await callTool(TOKEN, 'voxen_expand_context', {
      transcript_id: transcriptId,
      line: 250,
      radius: 200,
    })) as { truncated: boolean; lines: unknown[] };
    expect(expanded.truncated).toBe(true);
    expect(expanded.lines.length).toBeLessThanOrEqual(200);
  });
});
