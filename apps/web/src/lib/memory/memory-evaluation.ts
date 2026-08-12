import type { CompletedMemoryTurn, MemoryCandidate, MemoryProvider } from './memory-provider';

export interface MemoryEvaluationCase {
  id: string;
  userId: string;
  userContent: string;
  assistantContent: string;
  query: string;
  expectedTerms: readonly string[];
  forbiddenTerms?: readonly string[];
}

export interface MemoryEvaluationReport {
  schemaVersion: 1;
  provider: string;
  runId: string;
  cases: number;
  featureOffBaseline: {
    recall: 0;
    candidateTokens: 0;
    externalLatencyMs: 0;
    note: string;
  };
  shadow: {
    recall: number;
    provenanceRecall: number;
    contradictionRate: number;
    precision: number;
    falseMemoryRate: number;
    crossUserLeaks: number;
    deletionResidues: number;
    searchLatencyP50Ms: number;
    searchLatencyP95Ms: number;
    candidateTokens: number;
    fullReplayEstimatedTokens: number;
    tokenReductionRatio: number;
    operatorReportedCostUsd: number | null;
  };
  thresholds: {
    recallAtLeast: number;
    precisionAtLeast: number;
    falseMemoryRateAtMost: number;
    contradictionRateAtMost: number;
    crossUserLeaks: 0;
    deletionResidues: 0;
    searchLatencyP95MsAtMost: number;
  };
  passed: boolean;
  decision: 'eligible-for-controlled-review' | 'no-go-for-prompt-injection';
}

const THRESHOLDS = {
  recallAtLeast: 0.8,
  precisionAtLeast: 0.8,
  falseMemoryRateAtMost: 0.1,
  contradictionRateAtMost: 0.05,
  crossUserLeaks: 0 as const,
  deletionResidues: 0 as const,
  searchLatencyP95MsAtMost: 1_500,
};

function quantile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index] ?? 0;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function provenanceConversationIds(candidates: readonly MemoryCandidate[]): string[] {
  return candidates.flatMap((candidate) =>
    candidate.provenance.conversationId ? [candidate.provenance.conversationId] : [],
  );
}

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US');
}

function matchesExpectation(candidate: MemoryCandidate, item: MemoryEvaluationCase): boolean {
  const content = normalized(candidate.content);
  const hasExpected = item.expectedTerms.some((term) => content.includes(normalized(term)));
  const hasForbidden = (item.forbiddenTerms ?? []).some((term) =>
    content.includes(normalized(term)),
  );
  return hasExpected && !hasForbidden;
}

export async function runMemoryShadowEvaluation(args: {
  provider: MemoryProvider;
  cases: readonly MemoryEvaluationCase[];
  runId: string;
  now?: Date;
  operatorReportedCostUsd?: number | null;
}): Promise<MemoryEvaluationReport> {
  if (args.provider.kind === 'disabled') throw new Error('A live shadow provider is required');
  if (args.cases.length === 0) throw new Error('At least one evaluation case is required');

  const now = args.now ?? new Date();
  const conversationOwners = new Map<string, string>();
  const evaluationUsers = new Set<string>();
  let fullReplayEstimatedTokens = 0;
  let hits = 0;
  let provenanceHits = 0;
  let contradictions = 0;
  let expectedProvenanceCandidates = 0;
  let relevantCandidates = 0;
  let totalCandidates = 0;
  let crossUserLeaks = 0;
  let candidateTokens = 0;
  const latencies: number[] = [];
  for (const item of args.cases) evaluationUsers.add(item.userId);
  try {
    for (const item of args.cases) {
      const conversationId = `mem0-eval:${args.runId}:${item.id}`;
      conversationOwners.set(conversationId, item.userId);
      fullReplayEstimatedTokens += estimateTokens(item.userContent + item.assistantContent);
      const turn: CompletedMemoryTurn = {
        userId: item.userId,
        conversationId,
        userMessageId: `${conversationId}:user`,
        assistantMessageId: `${conversationId}:assistant`,
        userContent: item.userContent,
        assistantContent: item.assistantContent,
        completedAt: now,
      };
      await args.provider.addCompletedTurn(turn);
    }
    for (const item of args.cases) {
      const expectedConversationId = `mem0-eval:${args.runId}:${item.id}`;
      const startedAt = performance.now();
      const candidates = await args.provider.search({
        userId: item.userId,
        query: item.query,
        limit: 5,
      });
      latencies.push(performance.now() - startedAt);
      const candidateConversationIds = provenanceConversationIds(candidates);
      if (candidateConversationIds.includes(expectedConversationId)) provenanceHits += 1;
      const expectedCandidates = candidates.filter(
        (candidate) => candidate.provenance.conversationId === expectedConversationId,
      );
      expectedProvenanceCandidates += expectedCandidates.length;
      const relevant = expectedCandidates.filter((candidate) =>
        matchesExpectation(candidate, item),
      );
      if (relevant.length > 0) hits += 1;
      relevantCandidates += relevant.length;
      contradictions += expectedCandidates.filter((candidate) =>
        (item.forbiddenTerms ?? []).some((term) =>
          normalized(candidate.content).includes(normalized(term)),
        ),
      ).length;
      crossUserLeaks += candidateConversationIds.filter(
        (conversationId) =>
          conversationOwners.has(conversationId) &&
          conversationOwners.get(conversationId) !== item.userId,
      ).length;
      totalCandidates += candidates.length;
      candidateTokens += candidates.reduce(
        (total, candidate) => total + estimateTokens(candidate.content),
        0,
      );
    }
  } finally {
    await Promise.all([...evaluationUsers].map((userId) => args.provider.deleteUser(userId)));
  }

  let deletionResidues = 0;
  for (const item of args.cases) {
    const candidates = await args.provider.search({
      userId: item.userId,
      query: item.query,
      limit: 5,
    });
    deletionResidues += candidates.length;
  }

  const recall = hits / args.cases.length;
  const provenanceRecall = provenanceHits / args.cases.length;
  const contradictionRate =
    expectedProvenanceCandidates === 0 ? 0 : contradictions / expectedProvenanceCandidates;
  const precision = totalCandidates === 0 ? 0 : relevantCandidates / totalCandidates;
  const falseMemoryRate =
    totalCandidates === 0 ? 0 : (totalCandidates - relevantCandidates) / totalCandidates;
  const sortedLatencies = latencies.toSorted((left, right) => left - right);
  const tokenReductionRatio =
    fullReplayEstimatedTokens === 0
      ? 0
      : 1 - Math.min(1, candidateTokens / fullReplayEstimatedTokens);
  const passed =
    recall >= THRESHOLDS.recallAtLeast &&
    precision >= THRESHOLDS.precisionAtLeast &&
    falseMemoryRate <= THRESHOLDS.falseMemoryRateAtMost &&
    contradictionRate <= THRESHOLDS.contradictionRateAtMost &&
    crossUserLeaks === THRESHOLDS.crossUserLeaks &&
    deletionResidues === THRESHOLDS.deletionResidues &&
    quantile(sortedLatencies, 0.95) <= THRESHOLDS.searchLatencyP95MsAtMost;

  return {
    schemaVersion: 1,
    provider: args.provider.kind,
    runId: args.runId,
    cases: args.cases.length,
    featureOffBaseline: {
      recall: 0,
      candidateTokens: 0,
      externalLatencyMs: 0,
      note: 'Incremental memory-layer baseline only; canonical Voxen retrieval remains enabled.',
    },
    shadow: {
      recall,
      provenanceRecall,
      contradictionRate,
      precision,
      falseMemoryRate,
      crossUserLeaks,
      deletionResidues,
      searchLatencyP50Ms: quantile(sortedLatencies, 0.5),
      searchLatencyP95Ms: quantile(sortedLatencies, 0.95),
      candidateTokens,
      fullReplayEstimatedTokens,
      tokenReductionRatio,
      operatorReportedCostUsd: args.operatorReportedCostUsd ?? null,
    },
    thresholds: THRESHOLDS,
    passed,
    decision: passed ? 'eligible-for-controlled-review' : 'no-go-for-prompt-injection',
  };
}
