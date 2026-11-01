import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import app from '../src/index';
import { db } from '../src/lib/db';
import { hashMcpToken } from '../src/lib/mcp-tokens';
import { findEnclosingSection, parseOutline } from '../src/lib/retrieval';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

const MD = [
  '# Manual da prensa',
  '',
  'Introdução geral sem seção detalhada.',
  '',
  '## Segurança',
  '',
  'Use EPI sempre.',
  '',
  '### Travamento',
  '',
  'Trave a prensa antes de ajustar.',
  '',
  '## Operação',
  '',
  'Ligue no painel principal.',
].join('\n');

describe('findEnclosingSection (pure)', () => {
  it('maps lines to their innermost section', () => {
    expect(findEnclosingSection(MD, 1)).toMatchObject({ index: 0, heading: 'Manual da prensa' });
    expect(findEnclosingSection(MD, 4)).toMatchObject({ index: 0, heading: 'Manual da prensa' });
    expect(findEnclosingSection(MD, 7)).toMatchObject({ index: 1, heading: 'Segurança' });
    expect(findEnclosingSection(MD, 11)).toMatchObject({ index: 2, heading: 'Travamento' });
    expect(findEnclosingSection(MD, 15)).toMatchObject({ index: 3, heading: 'Operação' });
  });

  it('returns null without headings or before the first heading', () => {
    expect(findEnclosingSection('linha 1\nlinha 2', 2)).toBeNull();
    expect(findEnclosingSection('\n\n# Título', 1)).toBeNull();
  });

  it('agrees with parseOutline section boundaries', () => {
    const { sections } = parseOutline(MD);
    for (const section of sections) {
      expect(findEnclosingSection(MD, section.startLine)).toMatchObject({ index: section.index });
    }
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

// Structural context in narrow reads (spec 217 §5): every narrow passage
// carries its enclosing section (index navigable via voxen_read_section)
// while quoted lines stay byte-identical.
describeIfDb('section context in narrow reads (spec 217)', () => {
  const TOKEN = 'test-section-ctx-' + 'k'.repeat(20);
  let userId = '';
  let transcriptId = '';

  beforeAll(async () => {
    process.env.STORAGE_LOCAL_PATH = await mkdtemp(join(tmpdir(), 'voxen-test-storage-'));
    const user = await db.user.create({
      data: { email: `section-${Date.now()}@voxen.local`, name: 'Section', status: 'APPROVED' },
    });
    userId = user.id;
    await db.mcpToken.create({
      data: { userId, tokenHash: hashMcpToken(TOKEN), label: 'Section', scopes: 'READ,WRITE' },
    });
    const transcript = await db.transcript.create({
      data: {
        userId,
        source: 'WEB',
        url: 'https://example.com/prensa',
        title: 'Manual da prensa',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${userId}/transcripts/prensa.md`,
        plainText: 'Manual da prensa.',
        frontmatter: {},
      },
    });
    transcriptId = transcript.id;
    const { storagePut } = await import('../src/lib/storage');
    await storagePut({
      key: `workspaces/${userId}/transcripts/prensa.md`,
      body: MD,
      contentType: 'text/markdown',
    });
  });

  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  });

  it('voxen_read_lines reports the enclosing section without changing lines', async () => {
    const out = (await callTool(TOKEN, 'voxen_read_lines', {
      transcript_id: transcriptId,
      from: 6,
      to: 8,
    })) as {
      lines: Array<{ n: number; text: string }>;
      section: { index: number; heading: string } | null;
    };
    expect(out.lines.map((line) => line.n)).toEqual([6, 7, 8]);
    expect(out.section).toMatchObject({ index: 1, heading: 'Segurança' });
  });

  it('voxen_expand_context anchors section navigation', async () => {
    const out = (await callTool(TOKEN, 'voxen_expand_context', {
      transcript_id: transcriptId,
      line: 11,
      radius: 0,
    })) as { anchorLine: number; section: { index: number; heading: string } | null };
    expect(out.anchorLine).toBe(11);
    expect(out.section).toMatchObject({ index: 2, heading: 'Travamento' });

    const section = (await callTool(TOKEN, 'voxen_read_section', {
      transcript_id: transcriptId,
      index: out.section!.index,
    })) as { section: { heading: string } };
    expect(section.section.heading).toBe('Travamento');
  });

  it('reports null section for documents without headings', async () => {
    const plain = await db.transcript.create({
      data: {
        userId,
        source: 'WEB',
        url: 'https://example.com/plano',
        title: 'Texto plano',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${userId}/transcripts/plano.md`,
        plainText: 'Texto plano.',
        frontmatter: {},
      },
    });
    const { storagePut } = await import('../src/lib/storage');
    await storagePut({
      key: `workspaces/${userId}/transcripts/plano.md`,
      body: 'apenas texto sem estrutura',
      contentType: 'text/markdown',
    });
    const out = (await callTool(TOKEN, 'voxen_read_lines', {
      transcript_id: plain.id,
      from: 1,
      to: 1,
    })) as { section: unknown };
    expect(out.section).toBeNull();
  });
});
