import { describe, expect, test } from 'bun:test';
import corpus from './fixtures/retrieval-quality-pt-br.v1.json';
import {
  assertNoQualityRegression,
  evaluateRetrievalBenchmark,
  runBrainBenchmark,
  runFtsBenchmark,
  type BenchmarkCase,
} from '../src/lib/retrieval-benchmark';
import { queryTranscriptFts } from '../src/lib/retrieval';
import { searchBrainNodes } from '../src/lib/brain-search';

const cases = corpus.cases as BenchmarkCase[];
const documents = corpus.documents;

function overlap(left: readonly string[], right: readonly string[]): number {
  return right.filter((term) => left.includes(term)).length;
}

async function productionFts(item: BenchmarkCase) {
  return queryTranscriptFts(
    'benchmark-user',
    item.question,
    8,
    {},
    {
      $queryRaw: (async (_strings: TemplateStringsArray, ...values: unknown[]) => {
        const asked = String(values.find((value) => value === item.question) ?? '');
        expect(asked).toBe(item.question);
        return documents
          .filter((document) => overlap(item.lexicalTerms, document.lexicalTerms) >= 2)
          .map((document) => ({ id: document.id })) as never;
      }) as never,
    },
  );
}

async function productionBrain(item: BenchmarkCase) {
  return searchBrainNodes('benchmark-user', item.brainTerms[0] ?? '', 8, {
    $queryRaw: (async () => []) as never,
    brainNode: {
      findMany: (async (query: { where?: { OR?: Array<{ key?: { contains?: string } }> } }) => {
        const term = query.where?.OR?.[0]?.key?.contains;
        return documents
          .filter((document) => term && document.brainTerms.includes(term))
          .map((document) => ({
            id: document.id,
            sourceType: 'TRANSCRIPT',
            sourceId: document.id,
          })) as never;
      }) as never,
    },
    transcript: {
      findMany: (async (query: { where: { userId: string; id: { in: string[] } } }) => {
        expect(query.where.userId).toBe('benchmark-user');
        return documents
          .filter((document) => query.where.id.in.includes(document.id))
          .map((document) => ({ id: document.id }));
      }) as never,
    },
    transcriptEnrichment: { findMany: (async () => []) as never },
  } as never);
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

  test('compara FTS e Brain com métricas reproduzíveis', async () => {
    const fts = evaluateRetrievalBenchmark(
      cases,
      await runFtsBenchmark(cases, documents, productionFts),
    );
    const brain = evaluateRetrievalBenchmark(
      cases,
      await runBrainBenchmark(cases, documents, productionBrain),
    );

    expect(brain.citationCoverage).toBe(1);
    expect(fts.unsupportedRate).toBe(0);
    expect(fts.totalCostUsd).toBe(0);
    expect(brain.totalCostUsd).toBe(0);
    assertNoQualityRegression(fts, brain);
  });

  test('gate falha quando uma estratégia regride recuperação ou citação', async () => {
    const baseline = evaluateRetrievalBenchmark(
      cases,
      await runFtsBenchmark(cases, documents, productionFts),
    );
    const regressed = evaluateRetrievalBenchmark(cases, [
      ...(await runFtsBenchmark(cases, documents, productionFts)).filter(
        (item) => item.caseId !== 'conteudo-longo',
      ),
    ]);
    expect(() => assertNoQualityRegression(baseline, regressed)).toThrow('Regressão');
  });

  test('precisão penaliza citação inventada e o gate bloqueia resposta sem suporte', async () => {
    const baseline = evaluateRetrievalBenchmark(
      cases,
      await runFtsBenchmark(cases, documents, productionFts),
    );
    const fts = await runFtsBenchmark(cases, documents, productionFts);
    const invalidCitation = evaluateRetrievalBenchmark(cases, [
      ...fts.map((item) =>
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
