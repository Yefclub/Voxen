import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { db } from '../src/lib/db';
import {
  mergeKnowledgeResults,
  preloadRelevantContent,
  searchKnowledgeBase,
  type KnowledgeSearchResult,
} from '../src/lib/retrieval';
import {
  fuseKnowledgeQueryResults,
  normalizeKnowledgeQueries,
  searchKnowledgeBaseMultiQuery,
} from '../src/lib/knowledge-search-multiquery';

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

function result(
  sourceType: KnowledgeSearchResult['sourceType'],
  id: string,
  rank: number,
): KnowledgeSearchResult {
  return {
    id,
    sourceType,
    href: `/${sourceType}s/${id}`,
    title: id,
    snippet: id,
    rank,
    createdAt: new Date('2026-08-02T12:00:00.000Z'),
    summary: null,
    tags: [],
    folder: null,
  };
}

describe('mergeKnowledgeResults', () => {
  it('prioriza nota curada quando a relevância é comparável', () => {
    const merged = mergeKnowledgeResults([
      result('transcript', 'video-buzz', 0.4),
      result('note', 'nota-links-buzz', 0.37),
    ]);

    expect(merged.map((item) => item.id)).toEqual(['nota-links-buzz', 'video-buzz']);
  });

  it('não deixa uma nota pouco relevante ocultar uma fonte mais precisa', () => {
    const merged = mergeKnowledgeResults([
      result('note', 'nota-vaga', 0.1),
      result('transcript', 'video-especifico', 0.6),
    ]);

    expect(merged.map((item) => item.id)).toEqual(['video-especifico', 'nota-vaga']);
  });

  it('desempata por recência sem misturar fontes de workspaces diferentes', () => {
    const old = result('transcript', 'antigo', 0.4);
    old.createdAt = new Date('2026-08-01T12:00:00.000Z');
    const fresh = result('transcript', 'novo', 0.4);
    const merged = mergeKnowledgeResults([old, fresh]);

    expect(merged.map((item) => item.id)).toEqual(['novo', 'antigo']);
  });
});

describe('multiquery knowledge search', () => {
  it('normaliza consultas e limita o plano a três variantes distintas', () => {
    expect(
      normalizeKnowledgeQueries(['  repo   oficial ', 'REPO oficial', 'GitHub origem', 'quarta']),
    ).toEqual(['repo oficial', 'GitHub origem', 'quarta']);
  });

  it('funde e deduplica resultados por reciprocal-rank fusion', () => {
    const fused = fuseKnowledgeQueryResults([
      [result('transcript', 'a', 0.9), result('note', 'b', 0.8)],
      [result('note', 'b', 0.9), result('external_enrichment', 'c', 0.8)],
    ]);

    expect(fused.map((item) => `${item.sourceType}:${item.id}`)).toEqual([
      'note:b',
      'transcript:a',
      'external_enrichment:c',
    ]);
  });

  it('mantém o limite padrão para valores não finitos', () => {
    const candidates = Array.from({ length: 9 }, (_, index) =>
      result('transcript', `resultado-${index}`, 0.9),
    );

    expect(fuseKnowledgeQueryResults([candidates], Number.NaN)).toHaveLength(8);
    expect(fuseKnowledgeQueryResults([candidates], Number.POSITIVE_INFINITY)).toHaveLength(8);
  });

  it('executa as consultas normalizadas e expõe um plano seguro', async () => {
    const calls: string[] = [];
    const search = async (_userId: string, query: string) => {
      calls.push(query);
      return query === 'principal'
        ? [result('transcript', 'video', 0.9)]
        : [
            { ...result('transcript', 'video', 0.8), retrievalSource: 'hybrid' as const },
            result('note', 'nota', 0.7),
          ];
    };

    const output = await searchKnowledgeBaseMultiQuery(
      'user-a',
      ['principal', 'variante', 'principal'],
      8,
      search,
    );

    expect(calls).toEqual(['principal', 'variante']);
    expect(output.results.map((item) => item.id)).toEqual(['video', 'nota']);
    expect(output.plan).toEqual({
      queries: ['principal', 'variante'],
      strategy: 'reciprocal-rank-fusion',
      sourceCounts: { transcript: 1, note: 1, external_enrichment: 0 },
      semanticRescueUsed: true,
    });
  });
});

describeIfDb('searchKnowledgeBase (com DB)', () => {
  let userId = '';

  beforeAll(async () => {
    const user = await db.user.create({
      data: {
        email: `knowledge-search-${Date.now()}@voxen.local`,
        name: 'Knowledge Search',
        status: 'APPROVED',
      },
      select: { id: true },
    });
    userId = user.id;
    await db.transcript.create({
      data: {
        userId,
        source: 'WEB',
        url: 'https://example.com/buzz-video',
        title: 'Vídeo sobre o Buzz',
        durationSec: 0,
        language: 'pt',
        transcriptionMethod: 'SCRAPE',
        mdPath: `workspaces/${userId}/transcripts/buzz.md`,
        plainText: 'O repositório oficial do Buzz é github.com/block/buzz.',
        frontmatter: {},
      },
    });
    await db.note.create({
      data: {
        userId,
        kind: 'NOTE',
        title: 'Buzz (Block) — Links oficiais de referência',
        content: 'Repositório oficial: https://github.com/block/buzz',
      },
    });
  });

  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it('encontra a nota curada do Buzz na recuperação inicial junto da transcrição', async () => {
    const results = await preloadRelevantContent(userId, 'Qual o link do repo do Buzz?');

    expect(results.some((item) => item.sourceType === 'note')).toBe(true);
    expect(results.some((item) => item.sourceType === 'transcript')).toBe(true);
    expect(results[0]?.title).toBe('Buzz (Block) — Links oficiais de referência');
    expect(results.find((item) => item.sourceType === 'note')?.href).toMatch(/^\/notas\//u);
  });

  it('retorna o mesmo domínio unificado para MCP e chat', async () => {
    const results = await searchKnowledgeBase(userId, 'Buzz repositório oficial');

    expect(results.map((item) => item.sourceType)).toEqual(
      expect.arrayContaining(['note', 'transcript']),
    );
  });
});
