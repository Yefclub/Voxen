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

type Card = {
  id: string;
  kind: string;
  title: string;
  description: string;
  topics: string[];
  collection: string | null;
  identifiers: Record<string, string>;
  provenance: Record<string, string>;
  href: string;
};

type DiscoverOut = {
  cards: Card[];
  topics: string[];
  collections: string[];
  truncated: boolean;
};

// Discovery catalog (spec 217 §4): deterministic name/topic/collection lookup
// over indexed metadata, no model calls, no enrichment required. Cards guide
// exploration; body-text evidence stays with voxen_search_*.
describeIfDb('discovery catalog contract (spec 217)', () => {
  const TOKEN = 'test-discover-' + 'k'.repeat(20);
  let userId = '';
  let otherId = '';

  beforeAll(async () => {
    const user = await db.user.create({
      data: { email: `discover-${Date.now()}@voxen.local`, name: 'Discover', status: 'APPROVED' },
    });
    userId = user.id;
    const other = await db.user.create({
      data: {
        email: `discover-other-${Date.now()}@voxen.local`,
        name: 'Other',
        status: 'APPROVED',
      },
    });
    otherId = other.id;
    await db.mcpToken.create({
      data: { userId, tokenHash: hashMcpToken(TOKEN), label: 'Discover', scopes: 'READ,WRITE' },
    });
    const tag = await db.tag.create({ data: { userId, name: 'Torno', slug: 'torno' } });
    const folder = await db.libraryFolder.create({ data: { userId, name: 'Oficina Atlas' } });

    const mk = async (
      key: string,
      title: string,
      body: string,
      extra: Record<string, unknown> = {},
    ): Promise<string> => {
      const row = await db.transcript.create({
        data: {
          userId,
          source: 'WEB',
          url: `https://example.com/${key}`,
          title,
          durationSec: 0,
          language: 'pt',
          transcriptionMethod: 'SCRAPE',
          mdPath: `workspaces/${userId}/transcripts/${key}.md`,
          plainText: body,
          frontmatter: {},
          ...extra,
        },
      });
      return row.id;
    };

    await mk('torno-exato', 'Torno', 'Manual do torno mecânico.');
    await mk('torno-prefixo', 'Torno CNC 3000', 'Torno CNC para usinagem.');
    await mk('torno-parcial', 'Guia do torno vertical', 'Guia do torno vertical.');
    await mk('sem-enriquecimento', 'Prensa manual', 'Prensa manual de bancada.');
    const tagged = await mk('torno-tag', 'Torno de bancada', 'Torno de bancada pequeno.');
    await db.transcriptTag.create({ data: { transcriptId: tagged, tagId: tag.id } });
    await db.transcript.update({ where: { id: tagged }, data: { folderId: folder.id } });
    // Body-only detail: present in FTS body text, absent from every card field.
    await mk('detalhe-corpo', 'Guia de manutenção', 'O bunker precisa de revisão trimestral.');
  });

  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    if (otherId) await db.user.delete({ where: { id: otherId } }).catch(() => undefined);
    await db.$disconnect();
  });

  it('orders exact, prefix, then contains matches deterministically', async () => {
    const out = (await callTool(TOKEN, 'voxen_discover', {
      query: 'torno',
      limit: 10,
    })) as DiscoverOut;
    const titles = out.cards.map((card) => card.title);
    expect(titles[0]).toBe('Torno');
    expect(titles).toContain('Torno CNC 3000');
    expect(titles).toContain('Guia do torno vertical');
    expect(titles).toContain('Torno de bancada');
    expect(out.truncated).toBe(false);
    // Stable across calls.
    const again = (await callTool(TOKEN, 'voxen_discover', {
      query: 'torno',
      limit: 10,
    })) as DiscoverOut;
    expect(again.cards.map((card) => card.id)).toEqual(out.cards.map((card) => card.id));
  });

  it('flags truncation instead of implying complete enumeration', async () => {
    const out = (await callTool(TOKEN, 'voxen_discover', {
      query: 'torno',
      limit: 2,
    })) as DiscoverOut;
    expect(out.cards).toHaveLength(2);
    expect(out.truncated).toBe(true);
    expect(out.cards[0]?.title).toBe('Torno');
  });

  it('lists matching topics and collections', async () => {
    const topics = (await callTool(TOKEN, 'voxen_discover', {
      query: 'torn',
      limit: 5,
    })) as DiscoverOut;
    expect(topics.topics).toContain('Torno');
    const folders = (await callTool(TOKEN, 'voxen_discover', {
      query: 'oficina',
      limit: 5,
    })) as DiscoverOut;
    expect(folders.collections).toContain('Oficina Atlas');
    expect(folders.cards).toEqual([]);
  });

  it('includes documents without enrichment and carries tag/folder context', async () => {
    const out = (await callTool(TOKEN, 'voxen_discover', {
      query: 'prensa manual',
      limit: 5,
    })) as DiscoverOut;
    expect(out.cards.map((card) => card.title)).toContain('Prensa manual');

    const tagged = (await callTool(TOKEN, 'voxen_discover', {
      query: 'torno de bancada',
      limit: 5,
    })) as DiscoverOut;
    const card = tagged.cards.find((item) => item.title === 'Torno de bancada');
    expect(card?.topics).toContain('Torno');
    expect(card?.collection).toBe('Oficina Atlas');
    expect(card?.identifiers.url).toBe('https://example.com/torno-tag');
    expect(card?.provenance.source).toBe('WEB');
    expect(card?.href).toContain('/transcricoes/');
  });

  it('carries producer provenance for contract-created notes', async () => {
    const created = (await callTool(TOKEN, 'voxen_create_note', {
      title: 'Atlas torno nota',
      content: 'Nota curada sobre torno.',
      contract_version: '1',
      idempotency_key: 'discover-note-1',
      producer_id: 'atlas-press',
      external_id: 'ext-9',
    })) as { id: string };
    const out = (await callTool(TOKEN, 'voxen_discover', {
      query: 'atlas torno nota',
      limit: 5,
    })) as DiscoverOut;
    const card = out.cards.find((item) => item.id === created.id);
    expect(card?.kind).toBe('note');
    expect(card?.provenance.producerId).toBe('atlas-press');
    expect(card?.provenance.externalId).toBe('ext-9');
    expect(card?.href).toContain('/notas/');
  });

  it('does not surface body-only details, which stay with passage search', async () => {
    const out = (await callTool(TOKEN, 'voxen_discover', {
      query: 'bunker',
      limit: 5,
    })) as DiscoverOut;
    expect(out.cards).toEqual([]);

    const search = (await callTool(TOKEN, 'voxen_search_knowledge', {
      query: 'bunker',
      limit: 5,
    })) as {
      results: Array<{ id: string }>;
    };
    expect(search.results.length).toBeGreaterThan(0);
  });

  it('isolates the catalog by workspace', async () => {
    await db.transcript.create({
      data: {
        userId: otherId,
        source: 'WEB',
        url: 'https://example.com/other-torno',
        title: 'Torno alheio',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${otherId}/transcripts/other.md`,
        plainText: 'Torno alheio.',
        frontmatter: {},
      },
    });
    const out = (await callTool(TOKEN, 'voxen_discover', {
      query: 'torno alheio',
      limit: 5,
    })) as DiscoverOut;
    expect(out.cards).toEqual([]);
  });

  it('rejects empty queries', async () => {
    const res = await mcpCall(
      {
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/call',
        params: { name: 'voxen_discover', arguments: { query: '   ' } },
      },
      TOKEN,
    );
    const body = (await res.json()) as { result?: { isError?: boolean } };
    expect(body.result?.isError).toBe(true);
  });
});
