import { describe, expect, test } from 'bun:test';
import corpus from './fixtures/retrieval-quality-pt-br.v1.json';
import {
  assertNoQualityRegression,
  evaluateRetrievalBenchmark,
  runBrainBenchmark,
  runFtsBenchmark,
  runHybridBenchmark,
  type BenchmarkCase,
} from '../src/lib/retrieval-benchmark';
import { queryTranscriptFts } from '../src/lib/retrieval';
import { searchBrainNodes } from '../src/lib/brain-search';

const cases = corpus.cases as BenchmarkCase[];
const documents = corpus.documents;

describe('benchmark de qualidade de retrieval em PT-BR', () => {
  test('corpus versionado cobre sinônimo, informalidade, longo, múltiplo, conflito e ausência', () => {
    expect(cases.map((item) => item.id)).toEqual([
      'sinonimo-repo',
      'informal-link',
      'conteudo-longo',
      'multiplas-fontes',
      'conflito',
      'sem-evidencia',
    ]);
    expect(JSON.stringify(corpus)).not.toMatch(/sk-|password|secret/i);
  });

  test('adaptadores exercitam as consultas FTS e Brain de produção com repositório determinístico', async () => {
    const ftsCalls: unknown[] = [];
    const fts = await queryTranscriptFts('benchmark-user', 'código buzz', 8, {
      $queryRaw: (async (query: unknown) => {
        ftsCalls.push(query);
        return [];
      }) as never,
    });
    const brainCalls: unknown[] = [];
    const brain = await searchBrainNodes('benchmark-user', 'buzz', 8, {
      brainNode: {
        findMany: (async (query: unknown) => {
          brainCalls.push(query);
          return [];
        }) as never,
      },
    } as never);

    expect(fts).toEqual([]);
    expect(brain).toEqual([]);
    expect(String(ftsCalls[0])).toContain('websearch_to_tsquery');
    expect(JSON.stringify(brainCalls[0])).toContain('benchmark-user');
    expect(JSON.stringify(brainCalls[0])).toContain('ACTIVE');
  });

  test('compara FTS, híbrido e Brain com métricas reproduzíveis', () => {
    const fts = evaluateRetrievalBenchmark(cases, runFtsBenchmark(cases, documents));
    const hybrid = evaluateRetrievalBenchmark(cases, runHybridBenchmark(cases, documents));
    const brain = evaluateRetrievalBenchmark(cases, runBrainBenchmark(cases, documents));

    expect(hybrid.sourceRecall).toBeGreaterThan(fts.sourceRecall);
    expect(brain.citationCoverage).toBe(1);
    expect(hybrid.totalCostUsd).toBeGreaterThan(0);
    expect(fts.unsupportedRate).toBe(0);
    assertNoQualityRegression(fts, hybrid);
    assertNoQualityRegression(fts, brain);
  });

  test('gate falha quando uma estratégia regride recuperação ou citação', () => {
    const baseline = evaluateRetrievalBenchmark(cases, runHybridBenchmark(cases, documents));
    const regressed = evaluateRetrievalBenchmark(cases, [
      ...runHybridBenchmark(cases, documents).filter((item) => item.caseId !== 'conteudo-longo'),
    ]);
    expect(() => assertNoQualityRegression(baseline, regressed)).toThrow('Regressão');
  });

  test('precisão penaliza citação inventada e o gate bloqueia resposta sem suporte', () => {
    const baseline = evaluateRetrievalBenchmark(cases, runFtsBenchmark(cases, documents));
    const invalidCitation = evaluateRetrievalBenchmark(cases, [
      ...runHybridBenchmark(cases, documents).map((item) =>
        item.caseId === 'conteudo-longo'
          ? { ...item, citations: [{ quote: 'trecho errado', timestamp: 1 }] }
          : item,
      ),
      { caseId: 'sem-evidencia', sources: ['vazamento'], citations: [], latencyMs: 1, costUsd: 0 },
    ]);
    expect(invalidCitation.citationPrecision).toBeLessThan(1);
    expect(() => assertNoQualityRegression(baseline, invalidCitation)).toThrow('Regressão');
  });
});
