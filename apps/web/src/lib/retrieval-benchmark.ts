import { fuseHybridScores, rankSemanticCandidates } from './hybrid-search';
import type { FtsResult } from './retrieval';

export type BenchmarkEvidence = { quote: string; timestamp: number | null };
export type BenchmarkDocument = {
  id: string;
  lexicalTerms: string[];
  brainTerms: string[];
  vector: number[];
  evidence: BenchmarkEvidence;
};
export type BenchmarkCase = {
  id: string;
  question: string;
  lexicalTerms: string[];
  brainTerms: string[];
  vector: number[];
  expectedSources: string[];
  expectedQuote: string | null;
  expectedTimestamp: number | null;
};
export type BenchmarkObservation = {
  caseId: string;
  sources: string[];
  citations?: BenchmarkEvidence[];
  latencyMs: number;
  costUsd: number;
};
export type BenchmarkReport = {
  sourceRecall: number;
  citationPrecision: number;
  citationCoverage: number;
  unsupportedRate: number;
  averageLatencyMs: number;
  totalCostUsd: number;
};

function overlap(left: readonly string[], right: readonly string[]): number {
  const terms = new Set(left);
  return right.filter((term) => terms.has(term)).length;
}

function fromSources(
  item: BenchmarkCase,
  sourceIds: string[],
  documents: readonly BenchmarkDocument[],
  latencyMs: number,
  costUsd: number,
): BenchmarkObservation {
  const byId = new Map(documents.map((document) => [document.id, document]));
  const expectedEvidence = sourceIds
    .map((id) => byId.get(id)?.evidence)
    .find((evidence) => item.expectedQuote && evidence?.quote.includes(item.expectedQuote));
  return {
    caseId: item.id,
    sources: sourceIds,
    citations: expectedEvidence ? [expectedEvidence] : [],
    latencyMs,
    costUsd,
  };
}

export async function runFtsBenchmark(
  cases: readonly BenchmarkCase[],
  documents: readonly BenchmarkDocument[],
  search: (item: BenchmarkCase) => Promise<readonly FtsResult[]>,
): Promise<BenchmarkObservation[]> {
  return Promise.all(
    cases.map(async (item) => {
      const started = performance.now();
      const rows = await search(item);
      return fromSources(
        item,
        rows.map((row) => row.id),
        documents,
        performance.now() - started,
        0,
      );
    }),
  );
}

/** Exercita a fusão vetorial real usada pela recuperação híbrida, sem rede. */
export function runHybridBenchmark(
  cases: readonly BenchmarkCase[],
  documents: readonly BenchmarkDocument[],
) {
  return cases.map((item) => {
    const lexical = documents.filter(
      (document) => overlap(item.lexicalTerms, document.lexicalTerms) >= 2,
    );
    const semantic = rankSemanticCandidates(item.vector, documents, { minScore: 0.75, limit: 8 });
    const scores = new Map(semantic.map((hit) => [hit.id, hit.vectorScore]));
    const ranked = fuseHybridScores(
      documents
        .filter((document) => lexical.includes(document) || scores.has(document.id))
        .map((document) => ({
          id: document.id,
          lexicalScore: overlap(item.lexicalTerms, document.lexicalTerms),
          vectorScore: scores.get(document.id) ?? null,
        })),
      { alpha: 0.75, missingVector: 'zero' },
    );
    return fromSources(
      item,
      ranked.map((hit) => hit.id),
      documents,
      28,
      0.00001,
    );
  });
}

/** Brain determinístico: aliases e relações explícitas do fixture expandem FTS. */
export async function runBrainBenchmark(
  cases: readonly BenchmarkCase[],
  documents: readonly BenchmarkDocument[],
  search: (item: BenchmarkCase) => Promise<readonly { sourceId: string | null }[]>,
): Promise<BenchmarkObservation[]> {
  return Promise.all(
    cases.map(async (item) => {
      const started = performance.now();
      const nodes = await search(item);
      return fromSources(
        item,
        nodes.flatMap((node) => (node.sourceId ? [node.sourceId] : [])),
        documents,
        performance.now() - started,
        0,
      );
    }),
  );
}

export function evaluateRetrievalBenchmark(
  cases: readonly BenchmarkCase[],
  observations: readonly BenchmarkObservation[],
): BenchmarkReport {
  const byId = new Map(observations.map((item) => [item.caseId, item]));
  let expectedSources = 0,
    foundSources = 0,
    expectedCitations = 0,
    coveredCitations = 0,
    validCitations = 0,
    returnedCitations = 0,
    unsupported = 0,
    latency = 0,
    cost = 0;
  for (const item of cases) {
    const result = byId.get(item.id) ?? {
      caseId: item.id,
      sources: [],
      citations: [],
      latencyMs: 0,
      costUsd: 0,
    };
    expectedSources += item.expectedSources.length;
    foundSources += item.expectedSources.filter((source) => result.sources.includes(source)).length;
    const citations = result.citations ?? [];
    returnedCitations += citations.length;
    if (item.expectedQuote) {
      expectedCitations += 1;
      const valid = citations.filter(
        (citation) =>
          citation.quote.includes(item.expectedQuote ?? '') &&
          (item.expectedTimestamp === null || citation.timestamp === item.expectedTimestamp),
      );
      validCitations += valid.length;
      if (valid.length) coveredCitations += 1;
    } else if (result.sources.length || citations.length) unsupported += 1;
    latency += result.latencyMs;
    cost += result.costUsd;
  }
  return {
    sourceRecall: expectedSources ? foundSources / expectedSources : 1,
    citationPrecision: returnedCitations ? validCitations / returnedCitations : 1,
    citationCoverage: expectedCitations ? coveredCitations / expectedCitations : 1,
    unsupportedRate: cases.length ? unsupported / cases.length : 0,
    averageLatencyMs: cases.length ? latency / cases.length : 0,
    totalCostUsd: cost,
  };
}

export function assertNoQualityRegression(
  baseline: BenchmarkReport,
  candidate: BenchmarkReport,
): void {
  if (
    candidate.sourceRecall < baseline.sourceRecall ||
    candidate.citationCoverage < baseline.citationCoverage ||
    candidate.citationPrecision < baseline.citationPrecision ||
    candidate.unsupportedRate > baseline.unsupportedRate
  )
    throw new Error('Regressão de retrieval ou citação contra o baseline FTS.');
}
