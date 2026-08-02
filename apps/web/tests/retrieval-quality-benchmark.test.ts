import { describe, expect, test } from 'bun:test';
import corpus from './fixtures/retrieval-quality-pt-br.v1.json';
import {
  assertNoQualityRegression,
  evaluateRetrievalBenchmark,
  type BenchmarkCase,
  type BenchmarkObservation,
} from '../src/lib/retrieval-benchmark';

const cases = corpus.cases as BenchmarkCase[];

function observations(strategy: 'fts' | 'hybrid' | 'brain'): BenchmarkObservation[] {
  return cases.map((item) => {
    const isBuzz = item.expectedSources.includes('buzz-repo');
    const semanticBuzz = strategy !== 'fts' && isBuzz;
    const sources =
      item.expectedSources.length === 0
        ? []
        : semanticBuzz
          ? ['buzz-repo']
          : isBuzz
            ? []
            : item.expectedSources;
    return {
      caseId: item.id,
      sources,
      quote: item.expectedQuote,
      timestamp: item.expectedTimestamp,
      latencyMs: strategy === 'fts' ? 12 : strategy === 'hybrid' ? 28 : 18,
      costUsd: strategy === 'hybrid' ? 0.00001 : 0,
    };
  });
}

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

  test('compara FTS, híbrido e Brain com métricas reproduzíveis', () => {
    const fts = evaluateRetrievalBenchmark(cases, observations('fts'));
    const hybrid = evaluateRetrievalBenchmark(cases, observations('hybrid'));
    const brain = evaluateRetrievalBenchmark(cases, observations('brain'));

    expect(hybrid.sourceRecall).toBeGreaterThan(fts.sourceRecall);
    expect(brain.citationCoverage).toBe(1);
    expect(hybrid.totalCostUsd).toBeGreaterThan(0);
    expect(fts.unsupportedRate).toBe(0);
    assertNoQualityRegression(fts, hybrid);
    assertNoQualityRegression(fts, brain);
  });

  test('gate falha quando uma estratégia regride recuperação ou citação', () => {
    const baseline = evaluateRetrievalBenchmark(cases, observations('fts'));
    const regressed = evaluateRetrievalBenchmark(cases, [
      ...observations('hybrid').filter((item) => item.caseId !== 'conteudo-longo'),
    ]);
    expect(() => assertNoQualityRegression(baseline, regressed)).toThrow('Regressão');
  });
});
