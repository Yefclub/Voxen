export type BenchmarkCase = {
  id: string;
  question: string;
  expectedSources: string[];
  expectedQuote: string | null;
  expectedTimestamp: number | null;
};

export type BenchmarkObservation = {
  caseId: string;
  sources: string[];
  citations?: Array<{ quote: string; timestamp: number | null }>;
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

export function evaluateRetrievalBenchmark(
  cases: readonly BenchmarkCase[],
  observations: readonly BenchmarkObservation[],
): BenchmarkReport {
  const byId = new Map(observations.map((item) => [item.caseId, item]));
  let expectedSources = 0;
  let foundSources = 0;
  let expectedCitations = 0;
  let coveredCitations = 0;
  let validCitations = 0;
  let returnedCitations = 0;
  let unsupported = 0;
  let latency = 0;
  let cost = 0;
  for (const item of cases) {
    const result: BenchmarkObservation = byId.get(item.id) ?? {
      caseId: item.id,
      sources: [],
      citations: [],
      latencyMs: 0,
      costUsd: 0,
    };
    expectedSources += item.expectedSources.length;
    foundSources += item.expectedSources.filter((source) => result.sources.includes(source)).length;
    if (item.expectedQuote) {
      expectedCitations += 1;
      const citations = result.citations ?? [];
      returnedCitations += citations.length;
      const valid = citations.filter(
        (citation) =>
          citation.quote.includes(item.expectedQuote ?? '') &&
          (item.expectedTimestamp === null || citation.timestamp === item.expectedTimestamp),
      );
      validCitations += valid.length;
      if (valid.length > 0) {
        coveredCitations += 1;
      }
    } else if (result.sources.length > 0 || (result.citations?.length ?? 0) > 0) unsupported += 1;
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
  ) {
    throw new Error('Regressão de retrieval ou citação contra o baseline FTS.');
  }
}
