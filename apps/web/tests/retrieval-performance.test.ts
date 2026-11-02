import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import app from '../src/index';
import { db } from '../src/lib/db';
import { hashMcpToken } from '../src/lib/mcp-tokens';
import {
  loadEffectiveTranscriptMarkdown,
  clearTranscriptReadCache,
} from '../src/lib/transcript-content';
import { parseOutline, readLinesFromMd, searchKnowledgeBase } from '../src/lib/retrieval';
import { contentCursor, resultDigest } from '../src/routes/mcp-content-cursor';
import { getResultReuseStats } from '../src/routes/mcp-result-reuse';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

// Thresholds are generous CI budgets, not performance goals: local Postgres
// should answer FTS in ms; the gate only fails on pathological regressions
// (seconds), never on noise.
const BUDGET = {
  searchP95Ms: 3000,
  outlineP95Ms: 3000,
  narrowP95Ms: 3000,
  mcpP95Ms: 5000,
  narrowMaxBytes: 64 * 1024,
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, rank)]!;
}

async function measure<T>(
  fn: () => Promise<T>,
  rounds = 5,
): Promise<{ p50: number; p95: number; p99: number; last: T }> {
  const latencies: number[] = [];
  let last!: T;
  for (let i = 0; i < rounds; i++) {
    const start = performance.now();
    last = await fn();
    latencies.push(performance.now() - start);
  }
  latencies.sort((a, b) => a - b);
  return {
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    last,
  };
}

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

describeIfDb('reproducible retrieval benchmark (Postgres + storage)', () => {
  const TOKEN = 'test-benchmark-' + randomUUID().replaceAll('-', '');
  let userId = '';
  const ids: Record<string, string> = {};
  let previousStoragePath: string | undefined;
  let storageDir = '';
  const docId = (key: string): string => {
    const id = ids[key];
    if (!id) throw new Error(`missing fixture: ${key}`);
    return id;
  };

  beforeAll(async () => {
    previousStoragePath = process.env.STORAGE_LOCAL_PATH;
    storageDir = await mkdtemp(join(tmpdir(), 'voxen-bench-storage-'));
    process.env.STORAGE_LOCAL_PATH = storageDir;
    const user = await db.user.create({
      data: { email: `bench-${Date.now()}@voxen.local`, name: 'Bench', status: 'APPROVED' },
    });
    userId = user.id;
    await db.mcpToken.create({
      data: { userId, tokenHash: hashMcpToken(TOKEN), label: 'Bench', scopes: 'READ,WRITE' },
    });
    const { storagePut } = await import('../src/lib/storage');
    const put = async (
      key: string,
      mdBody: string,
      extra: Record<string, string | Date | null> & { title: string } = {} as never,
    ) => {
      const { title, ...rest } = extra;
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
          plainText: mdBody.replace(/^#.*$/m, '').trim().slice(0, 20000),
          frontmatter: {},
          ...rest,
        },
      });
      ids[key] = row.id;
      await storagePut({
        key: `workspaces/${userId}/transcripts/${key}.md`,
        body: mdBody,
        contentType: 'text/markdown',
      });
      return row;
    };

    await put(
      'repo',
      '# Repositório oficial\n\nO repositório oficial do projeto Atlas fica em github.com/atlas/central.',
      { title: 'Repositório oficial' },
    );
    await put(
      'sinonimo',
      '# Guarda de valores\n\nO cofre guarda os valores do projeto Atlas com segurança máxima.',
      { title: 'Sinônimo cofre' },
    );
    await put(
      'informal',
      '# Link do zap\n\nManda o link do repo no zap pra galera do Atlas por favor.',
      { title: 'Link informal' },
    );
    await put(
      'longo',
      '# Manual extenso\n\n' +
        'Parágrafo sobre o Atlas e seus procedimentos operacionais.\n'.repeat(800),
      { title: 'Documento longo Atlas' },
    );
    await put(
      'multi-a',
      '# Fonte Alpha\n\nO Atlas usa o protocolo Aurora para sincronizar os nós com quorum dinâmico.',
      { title: 'Fonte Alpha' },
    );
    await put('multi-b', '# Fonte Beta\n\nO protocolo Aurora do Atlas exige quorum de três nós.', {
      title: 'Fonte Beta',
    });
    await put('conflito-a', '# Versão antiga\n\nO Atlas foi fundado em 2019 em Lisboa.', {
      title: 'Conflito A',
    });
    await put('conflito-b', '# Versão revisada\n\nO Atlas foi fundado em 2021 no Porto.', {
      title: 'Conflito B',
    });
    await put(
      'titulo-distintivo',
      '# Caldeira industrial\n\nProcedimentos operacionais padrão para equipamentos térmicos.',
      { title: 'Caldeira industrial Atlas' },
    );
    const tornoDoc = await put(
      'etiqueta-exclusiva',
      '# Manual de bancada\n\nProcedimentos de segurança para equipamentos rotativos.',
      { title: 'Manual de bancada' },
    );
    const tagMecanica = await db.tag.create({
      data: { userId, name: 'Torno mecânico', slug: 'torno-mecanico' },
    });
    await db.transcriptTag.create({
      data: { transcriptId: tornoDoc.id, tagId: tagMecanica.id },
    });
    const pastaSerralheria = await db.libraryFolder.create({
      data: { userId, name: 'Serralheria' },
    });
    const bancadaDoc = await put(
      'colecao-exclusiva',
      '# Bancada de trabalho\n\nInstruções de organização da bancada.',
      { title: 'Bancada de trabalho' },
    );
    await db.transcript.update({
      where: { id: bancadaDoc.id },
      data: { folderId: pastaSerralheria.id },
    });
  });

  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    if (previousStoragePath === undefined) delete process.env.STORAGE_LOCAL_PATH;
    else process.env.STORAGE_LOCAL_PATH = previousStoragePath;
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
    await db.$disconnect();
  });

  it('recupera as fontes esperadas com ranking determinístico', async () => {
    const first = await searchKnowledgeBase(userId, 'repositório oficial Atlas', 8);
    expect(first.map((item) => item.id)).toContain(ids['repo']!);
    const second = await searchKnowledgeBase(userId, 'repositório oficial Atlas', 8);
    expect(second.map((item) => item.id)).toEqual(first.map((item) => item.id));

    const multi = await searchKnowledgeBase(userId, 'protocolo Aurora quorum', 8);
    expect(multi.map((item) => item.id)).toEqual(
      expect.arrayContaining([ids['multi-a']!, ids['multi-b']!]),
    );

    const conflict = await searchKnowledgeBase(userId, 'Atlas fundado', 8);
    expect(conflict.map((item) => item.id)).toEqual(
      expect.arrayContaining([ids['conflito-a']!, ids['conflito-b']!]),
    );

    const synonym = await searchKnowledgeBase(userId, 'cofre valores Atlas', 8);
    expect(synonym.map((item) => item.id)).toContain(ids['sinonimo']!);

    const informal = await searchKnowledgeBase(userId, 'link repo zap Atlas', 8);
    expect(informal.map((item) => item.id)).toContain(ids['informal']!);

    // Title-only terms (absent from every body) must still retrieve the
    // owning document first: titles are indexed with weight A (spec 217 §5).
    const titleOnly = await searchKnowledgeBase(userId, 'caldeira', 8);
    expect(titleOnly.map((item) => item.id)).toContain(ids['titulo-distintivo']!);
    expect(titleOnly[0]?.id).toBe(ids['titulo-distintivo']);

    // Tag-only terms (absent from title and body) must retrieve the tagged
    // document: tags are indexed with weight B, like body text (spec 217 §5).
    const tagOnly = await searchKnowledgeBase(userId, 'torno', 8);
    expect(tagOnly.map((item) => item.id)).toContain(ids['etiqueta-exclusiva']!);
    expect(tagOnly[0]?.id).toBe(ids['etiqueta-exclusiva']);

    // Folder-only terms (absent from title and body) must retrieve documents
    // in the matching collection: folder names are indexed like tags (§5).
    const folderOnly = await searchKnowledgeBase(userId, 'serralheria', 8);
    expect(folderOnly.map((item) => item.id)).toContain(ids['colecao-exclusiva']!);
    expect(folderOnly[0]?.id).toBe(ids['colecao-exclusiva']);

    // Renaming the collection refreshes the index through the same trigger.
    await db.libraryFolder.updateMany({
      where: { userId, name: 'Serralheria' },
      data: { name: 'Arquivo' },
    });
    const renamed = await searchKnowledgeBase(userId, 'arquivo', 8);
    expect(renamed.map((item) => item.id)).toContain(ids['colecao-exclusiva']!);
    const stale = await searchKnowledgeBase(userId, 'serralheria', 8);
    expect(stale.map((item) => item.id)).not.toContain(ids['colecao-exclusiva']!);

    const none = await searchKnowledgeBase(userId, 'xqzt jogo de tabuleiro inexistente', 8);
    expect(none).toEqual([]);
  });

  it('mede latência real de busca, outline e leitura estreita', async () => {
    clearTranscriptReadCache();
    const search = await measure(() => searchKnowledgeBase(userId, 'protocolo Aurora', 8));
    expect(search.p95).toBeLessThan(BUDGET.searchP95Ms);

    const outline = await measure(async () => {
      const doc = await loadEffectiveTranscriptMarkdown(userId, docId('longo'));
      return parseOutline(doc.md);
    });
    expect(outline.p95).toBeLessThan(BUDGET.outlineP95Ms);
    expect(outline.last.totalLines).toBeGreaterThan(100);

    const narrow = await measure(async () => {
      const doc = await loadEffectiveTranscriptMarkdown(userId, docId('longo'));
      return readLinesFromMd(doc.md, 1, 10);
    });
    expect(narrow.p95).toBeLessThan(BUDGET.narrowP95Ms);
    const bytes = Buffer.byteLength(JSON.stringify(narrow.last), 'utf8');
    expect(bytes).toBeLessThan(BUDGET.narrowMaxBytes);
  });

  it('mede round trips MCP reais', async () => {
    const call = async (name: string, args: unknown, id: number): Promise<unknown> => {
      const res = await mcpCall(
        { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
        TOKEN,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        result?: { structuredContent?: unknown };
        error?: unknown;
      };
      expect(body.error ?? null).toBeNull();
      return body.result?.structuredContent;
    };
    const timed = await measure(() =>
      call('voxen_search_knowledge', { query: 'protocolo Aurora', limit: 5 }, 101),
    );
    expect(timed.p95).toBeLessThan(BUDGET.mcpP95Ms);
    expect((timed.last as { results: unknown[] }).results.length).toBeGreaterThan(0);

    const outline = (await call('voxen_outline', { transcript_id: ids['longo']! }, 102)) as {
      totalLines: number;
    };
    expect(outline.totalLines).toBeGreaterThan(100);
  });

  it('mede continuação com reuso (page 2 via content_cursor)', async () => {
    const call = async (args: unknown, id: number): Promise<unknown> => {
      const res = await mcpCall(
        {
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name: 'voxen_search_knowledge', arguments: args },
        },
        TOKEN,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        result?: { structuredContent?: unknown };
        error?: unknown;
      };
      expect(body.error ?? null).toBeNull();
      return body.result?.structuredContent;
    };
    const args = { query: 'protocolo Aurora', limit: 5 };
    const first = (await call(args, 201)) as Record<string, unknown>;
    const serialized = JSON.stringify(first);
    const digest = resultDigest(serialized);
    const hitsBefore = getResultReuseStats().hits;

    const page2 = await measure(async () => {
      const cursor = contentCursor(
        10,
        digest,
        { userId, tool: 'voxen_search_knowledge', args, requestId: 'bench-continuation' },
        Date.now(),
      );
      return (await call({ ...args, content_cursor: cursor }, 202)) as {
        dataChunk: string;
        _mcp: { resultChecksum: string };
      };
    });
    expect(page2.p95).toBeLessThan(BUDGET.mcpP95Ms);
    // Mesmo checksum do resultado preparado: a página veio do reuso, sem recomputar.
    expect(page2.last._mcp.resultChecksum).toBe(digest);
    expect(page2.last.dataChunk).toBe(serialized.slice(10, 10 + page2.last.dataChunk.length));
    expect(getResultReuseStats().hits).toBeGreaterThan(hitsBefore);
  });
});
