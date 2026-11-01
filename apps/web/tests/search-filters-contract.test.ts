import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import app from '../src/index';
import { db } from '../src/lib/db';
import { hashMcpToken } from '../src/lib/mcp-tokens';
import { ftsSearchNotes, ftsSearchTranscripts, searchKnowledgeBase } from '../src/lib/retrieval';
import { SearchFilterError } from '../src/lib/search-filters';

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

describeIfDb('search filters contract (spec 216)', () => {
  const TOKEN = 'test-search-filters-' + 'k'.repeat(20);
  let userId = '';
  let folderId = '';
  const ids = {} as Record<string, string>;

  beforeAll(async () => {
    const user = await db.user.create({
      data: { email: `filters-${Date.now()}@voxen.local`, name: 'Filters', status: 'APPROVED' },
    });
    userId = user.id;
    await db.mcpToken.create({
      data: { userId, tokenHash: hashMcpToken(TOKEN), label: 'Filters', scopes: 'READ,WRITE' },
    });
    const folder = await db.libraryFolder.create({ data: { userId, name: 'Coleção Atlas' } });
    folderId = folder.id;
    const tagA = await db.tag.create({ data: { userId, name: 'Atlas', slug: 'atlas' } });
    const tagB = await db.tag.create({ data: { userId, name: 'Orçamento', slug: 'orcamento' } });

    const mk = async (
      key: string,
      data: Record<string, unknown>,
      tagIds: string[] = [],
    ): Promise<void> => {
      const row = await db.transcript.create({
        data: {
          userId,
          source: 'WEB',
          url: `https://example.com/${key}`,
          title: 'Atlas orçamento guia',
          durationSec: 0,
          language: 'pt',
          transcriptionMethod: 'SCRAPE',
          mdPath: `workspaces/${userId}/transcripts/${key}.md`,
          plainText: 'Atlas orçamento guia referência oficial do projeto Atlas.',
          frontmatter: {},
          ...(data as Record<string, never>),
        },
      });
      ids[key] = row.id;
      for (const tagId of tagIds) {
        await db.transcriptTag.create({ data: { transcriptId: row.id, tagId } });
      }
    };

    await mk('yt', { source: 'YOUTUBE', language: 'pt' }, [tagA.id]);
    await mk('webEn', { source: 'WEB', language: 'en', title: 'Atlas budget guide' }, []);
    await mk(
      'old',
      { source: 'WEB', language: 'pt', publishedAt: new Date('2020-01-01T00:00:00Z') },
      [tagB.id],
    );
    await mk(
      'new',
      { source: 'WEB', language: 'pt', publishedAt: new Date('2024-06-01T00:00:00Z') },
      [tagA.id, tagB.id],
    );
    await mk('foldered', { source: 'WEB', language: 'pt', folderId }, [tagA.id]);
    await mk('archived', { source: 'WEB', language: 'pt', status: 'ARCHIVED' as never }, []);
    await mk('trashed', { source: 'WEB', language: 'pt', status: 'TRASH' as never }, []);
    await db.note.create({
      data: {
        userId,
        kind: 'NOTE',
        title: 'Atlas orçamento guia',
        content: 'Atlas orçamento guia nota curada.',
      },
    });
  });

  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
  });

  it('filtra por origem (source)', async () => {
    const rows = await ftsSearchTranscripts(userId, 'Atlas orçamento', 25, {
      sources: ['YOUTUBE'],
    });
    expect(rows.map((row) => row.id)).toEqual([ids['yt']!]);
  });

  it('filtra por idioma', async () => {
    const rows = await ftsSearchTranscripts(userId, 'Atlas', 25, { language: 'en' });
    for (const row of rows) {
      const stored = await db.transcript.findUniqueOrThrow({ where: { id: row.id } });
      expect(stored.language).toBe('en');
    }
    expect(rows.length).toBeGreaterThan(0);
  });

  it('filtra por data de publicação', async () => {
    const rows = await ftsSearchTranscripts(userId, 'Atlas orçamento', 25, {
      publishedAfter: new Date('2024-01-01T00:00:00Z'),
    });
    expect(rows.map((row) => row.id)).toContain(ids['new']!);
    expect(rows.map((row) => row.id)).not.toContain(ids['old']!);
  });

  it('filtra por tag e pasta', async () => {
    const byTag = await ftsSearchTranscripts(userId, 'Atlas orçamento', 25, { tags: ['atlas'] });
    expect(byTag.map((row) => row.id)).toEqual(
      expect.arrayContaining([ids['yt']!, ids['new']!, ids['foldered']!]),
    );
    expect(byTag.map((row) => row.id)).not.toContain(ids['webEn']!);

    const byFolder = await ftsSearchTranscripts(userId, 'Atlas orçamento', 25, { folderId });
    expect(byFolder.map((row) => row.id)).toEqual([ids['foldered']!]);
  });

  it('filtra por documento e exclui lixeira/arquivo por padrão', async () => {
    const rows = await ftsSearchTranscripts(userId, 'Atlas orçamento', 25, {
      transcriptIds: [ids['yt']!, ids['new']!],
    });
    expect(new Set(rows.map((row) => row.id))).toEqual(new Set([ids['yt']!, ids['new']!]));

    const all = await ftsSearchTranscripts(userId, 'Atlas orçamento', 25);
    expect(all.map((row) => row.id)).not.toContain(ids['archived']!);
    const withArchived = await ftsSearchTranscripts(userId, 'Atlas orçamento', 25, {
      includeArchived: true,
    });
    expect(withArchived.map((row) => row.id)).toContain(ids['archived']!);
    expect(withArchived.map((row) => row.id)).not.toContain(ids['trashed']!);
    const trashedOnly = await ftsSearchTranscripts(userId, 'Atlas orçamento', 25, {
      transcriptIds: [ids['trashed']!],
    });
    expect(trashedOnly).toEqual([]);
    const trashedArchived = await ftsSearchTranscripts(userId, 'Atlas orçamento', 25, {
      transcriptIds: [ids['trashed']!],
      includeArchived: true,
    });
    expect(trashedArchived).toEqual([]);
  });

  it('ordena deterministicamente por score e identidade', async () => {
    const a = await db.transcript.create({
      data: {
        userId,
        source: 'WEB',
        url: 'https://example.com/dup-a',
        title: 'Atlas guia idêntico',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${userId}/transcripts/dup-a.md`,
        plainText: 'Atlas guia idêntico conteúdo igual.',
        frontmatter: {},
      },
    });
    const b = await db.transcript.create({
      data: {
        userId,
        source: 'WEB',
        url: 'https://example.com/dup-b',
        title: 'Atlas guia idêntico',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${userId}/transcripts/dup-b.md`,
        plainText: 'Atlas guia idêntico conteúdo igual.',
        frontmatter: {},
      },
    });
    const rows = await ftsSearchTranscripts(userId, 'Atlas guia idêntico', 25, {
      transcriptIds: [a.id, b.id],
    });
    expect(rows.map((row) => row.id)).toEqual([...[a.id, b.id]].sort());
  });

  it('isola filtros por workspace', async () => {
    const other = await db.user.create({
      data: { email: `filters-other-${Date.now()}@voxen.local`, name: 'Other', status: 'APPROVED' },
    });
    try {
      await db.transcript.create({
        data: {
          userId: other.id,
          source: 'YOUTUBE',
          url: 'https://example.com/other',
          title: 'Atlas orçamento guia',
          durationSec: 0,
          language: 'pt',
          transcriptionMethod: 'SCRAPE',
          mdPath: `workspaces/${other.id}/transcripts/other.md`,
          plainText: 'Atlas orçamento guia referência oficial.',
          frontmatter: {},
        },
      });
      const rows = await ftsSearchTranscripts(userId, 'Atlas orçamento', 25, {
        sources: ['YOUTUBE'],
      });
      expect(rows.map((row) => row.id)).toEqual([ids['yt']!]);
    } finally {
      await db.user.delete({ where: { id: other.id } }).catch(() => undefined);
    }
  });

  it('rejeita filtros inválidos', async () => {
    await expect(
      ftsSearchTranscripts(userId, 'Atlas', 8, { sources: ['NOPE'] }),
    ).rejects.toBeInstanceOf(SearchFilterError);
    await expect(
      ftsSearchTranscripts(userId, 'Atlas', 8, { language: 'xx!' }),
    ).rejects.toBeInstanceOf(SearchFilterError);
    await expect(
      ftsSearchTranscripts(userId, 'Atlas', 8, {
        publishedAfter: new Date('2024-01-01T00:00:00Z'),
        publishedBefore: new Date('2020-01-01T00:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(SearchFilterError);

    const bad = await mcpCall(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'voxen_search_transcripts',
          arguments: { query: 'Atlas', sources: ['NOPE'] },
        },
      },
      TOKEN,
    );
    const body = (await bad.json()) as { result?: { isError?: boolean } };
    expect(bad.status).toBe(200);
    expect(body.result?.isError).toBe(true);
  });

  it('filtra notas por documento e data', async () => {
    const note = await db.note.create({
      data: {
        userId,
        kind: 'NOTE',
        title: 'Atlas orçamento guia',
        content: 'Atlas orçamento guia extra.',
      },
    });
    const rows = await ftsSearchNotes(userId, 'Atlas orçamento', 25, { noteIds: [note.id] });
    expect(rows.map((row) => row.id)).toEqual([note.id]);

    const empty = await ftsSearchNotes(userId, 'Atlas orçamento', 25, {
      createdAfter: new Date('2100-01-01T00:00:00Z'),
    });
    expect(empty).toEqual([]);
  });

  it('source_types restringe a busca unificada', async () => {
    const onlyNotes = await searchKnowledgeBase(userId, 'Atlas orçamento', 8, {
      sourceTypes: ['note'],
    });
    expect(onlyNotes.length).toBeGreaterThan(0);
    expect(onlyNotes.every((item) => item.sourceType === 'note')).toBe(true);
  });

  it('filtros exclusivos de transcrição não restringem notas (documentado)', async () => {
    const withTag = await searchKnowledgeBase(userId, 'Atlas orçamento', 25, {
      tags: ['atlas'],
    });
    expect(withTag.some((item) => item.sourceType === 'note')).toBe(true);
  });
});
