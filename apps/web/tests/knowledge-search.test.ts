import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { db } from '../src/lib/db';
import {
  mergeKnowledgeResults,
  applyHybridRanks,
  preloadRelevantContent,
  searchKnowledgeBase,
  type KnowledgeSearchResult,
} from '../src/lib/retrieval';

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

  it('propaga a ordenação híbrida antes de mesclar as fontes', () => {
    const hybrid = applyHybridRanks(
      [
        { ...result('transcript', 'lexical-maior', 0.8) },
        { ...result('transcript', 'hibrido-maior', 0.6) },
      ],
      [
        { id: 'hibrido-maior', score: 1 },
        { id: 'lexical-maior', score: 0.7 },
      ],
    );
    const merged = mergeKnowledgeResults(
      hybrid.map((item) => ({
        ...item,
        sourceType: 'transcript' as const,
        href: `/transcricoes/${item.id}`,
      })),
    );

    expect(merged.map((item) => item.id)).toEqual(['hibrido-maior', 'lexical-maior']);
    expect(merged[0]?.rank).toBeGreaterThan(merged[1]?.rank ?? 0);
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
