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
  quote?: string | null;
  timestamp?: number | null;
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
  let preciseCitations = 0;
  let unsupported = 0;
  let latency = 0;
  let cost = 0;
  for (const item of cases) {
    const result: BenchmarkObservation = byId.get(item.id) ?? {
      caseId: item.id,
      sources: [],
      quote: null,
      timestamp: null,
      latencyMs: 0,
      costUsd: 0,
    };
    expectedSources += item.expectedSources.length;
    foundSources += item.expectedSources.filter((source) => result.sources.includes(source)).length;
    if (item.expectedQuote) {
      expectedCitations += 1;
      if (result.quote?.includes(item.expectedQuote)) {
        coveredCitations += 1;
        if (item.expectedTimestamp === null || result.timestamp === item.expectedTimestamp)
          preciseCitations += 1;
      }
    } else if (result.sources.length > 0 || result.quote) unsupported += 1;
    latency += result.latencyMs;
    cost += result.costUsd;
  }
  return {
    sourceRecall: expectedSources ? foundSources / expectedSources : 1,
    citationPrecision: coveredCitations ? preciseCitations / coveredCitations : 1,
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
    candidate.citationCoverage < baseline.citationCoverage
  ) {
    throw new Error('Regressão de retrieval ou citação contra o baseline FTS.');
  }
}
