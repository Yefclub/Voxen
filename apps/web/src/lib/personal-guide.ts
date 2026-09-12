import type { GraphReadEdge, GraphReadNode } from './graph-read-model';
import type { InterestProjectionSnapshot } from './personal-interest-projections';
import type { GraphCommunity } from '../shared/graph-community';
import type { GraphCentralityResult } from '../shared/graph-centrality';

export const PERSONAL_GUIDE_ALGORITHM_VERSION = 'personal-guide-v1';
export const PERSONAL_GUIDE_TREND_DELTA = 0.12;
export const PERSONAL_GUIDE_MIN_SCORE = 0.03;
export const PERSONAL_GUIDE_TRENDS_PER_CLASSIFICATION = 8;
export const PERSONAL_GUIDE_RECOMMENDATION_LIMIT = 12;

export type PersonalGuideTrendClassification = 'EMERGING' | 'STEADY' | 'COOLING';
export type PersonalGuideReasonKind = 'INTEREST' | 'COMMUNITY' | 'PERSONALIZATION' | 'STRUCTURAL';

export interface PersonalGuideSource {
  transcriptId: string;
  title: string;
  description: string | null;
  source: string;
  thumbnailUrl: string | null;
  createdAt: string;
}

export interface PersonalGuideTrend {
  dimension: string;
  key: string;
  label: string;
  brainNodeId: string | null;
  classification: PersonalGuideTrendClassification;
  score: number;
  scores: { short: number; medium: number; long: number };
  evidence: {
    explicitTranscripts: number;
    observedEvents: number;
    transcriptIds: string[];
  };
  lastEventAt: string;
}

export interface PersonalGuideReason {
  kind: PersonalGuideReasonKind;
  label: string;
  score: number;
  evidenceTranscriptIds: string[];
  community?: { id: number; label: string; cohesion: number };
}

export interface PersonalGuideRecommendation extends PersonalGuideSource {
  brainNodeId: string;
  score: number;
  structuralScore: number;
  personalizedScore: number;
  personalizationLift: number;
  reasons: PersonalGuideReason[];
}

export interface PersonalGuide {
  metadata: {
    algorithmVersion: string;
    generatedAt: string;
    projectionAlgorithmVersions: string[];
    projectionWatermark: string | null;
    rankingAlgorithmVersion: string;
    personalizationMode: GraphCentralityResult['metadata']['personalizationMode'];
    graphTruncated: boolean;
    matchedSeedNodes: number;
  };
  trends: PersonalGuideTrend[];
  recommendations: PersonalGuideRecommendation[];
  evidenceSources: PersonalGuideSource[];
}

interface BuildPersonalGuideInput {
  projections: InterestProjectionSnapshot[];
  graph: { nodes: GraphReadNode[]; edges: GraphReadEdge[]; truncated: boolean };
  centrality: GraphCentralityResult;
  communities: GraphCommunity[];
  sourcesByTranscriptId: Map<string, PersonalGuideSource>;
  now?: Date;
}

interface TrendAggregate {
  dimension: string;
  key: string;
  label: string;
  brainNodeId: string | null;
  scores: { short: number; medium: number; long: number };
  explicitTranscripts: number;
  observedEvents: number;
  transcriptIds: Set<string>;
  lastEventAt: string;
}

export function buildPersonalGuide(input: BuildPersonalGuideInput): PersonalGuide {
  const now = input.now ?? new Date();
  const trends = buildTrends(input.projections, input.sourcesByTranscriptId);
  const interestByNodeId = new Map(
    trends
      .filter((trend) => trend.brainNodeId && trend.score > 0)
      .map((trend) => [trend.brainNodeId!, trend] as const),
  );
  const recommendations = buildRecommendations({
    graph: input.graph,
    centrality: input.centrality,
    communities: input.communities,
    sourcesByTranscriptId: input.sourcesByTranscriptId,
    interestByNodeId,
  });
  const evidenceTranscriptIds = new Set<string>();
  for (const trend of trends) {
    for (const transcriptId of trend.evidence.transcriptIds)
      evidenceTranscriptIds.add(transcriptId);
  }
  for (const recommendation of recommendations) {
    for (const reason of recommendation.reasons) {
      for (const transcriptId of reason.evidenceTranscriptIds) {
        evidenceTranscriptIds.add(transcriptId);
      }
    }
  }

  return {
    metadata: {
      algorithmVersion: PERSONAL_GUIDE_ALGORITHM_VERSION,
      generatedAt: now.toISOString(),
      projectionAlgorithmVersions: [
        ...new Set(input.projections.map((snapshot) => snapshot.algorithmVersion)),
      ].sort(),
      projectionWatermark:
        input.projections
          .map((snapshot) => snapshot.eventWatermark)
          .filter((watermark): watermark is string => Boolean(watermark))
          .sort()
          .at(-1) ?? null,
      rankingAlgorithmVersion: input.centrality.metadata.algorithmVersion,
      personalizationMode: input.centrality.metadata.personalizationMode,
      graphTruncated: input.graph.truncated || input.centrality.metadata.snapshotTruncated,
      matchedSeedNodes: input.centrality.metadata.matchedSeedNodes,
    },
    trends,
    recommendations,
    evidenceSources: [...evidenceTranscriptIds]
      .map((transcriptId) => input.sourcesByTranscriptId.get(transcriptId))
      .filter((source): source is PersonalGuideSource => Boolean(source))
      .sort(
        (left, right) =>
          left.title.localeCompare(right.title) ||
          left.transcriptId.localeCompare(right.transcriptId),
      ),
  };
}

function buildTrends(
  projections: InterestProjectionSnapshot[],
  sourcesByTranscriptId: Map<string, PersonalGuideSource>,
): PersonalGuideTrend[] {
  const aggregates = new Map<string, TrendAggregate>();
  for (const snapshot of projections) {
    const horizonKey = horizonScoreKey(snapshot.horizon);
    for (const item of snapshot.items) {
      if (!item.evidence.transcriptIds.some((id) => sourcesByTranscriptId.has(id))) continue;
      const score = finiteScore(item.score);
      const aggregateKey = `${item.dimension}:${item.key}`;
      const aggregate = aggregates.get(aggregateKey) ?? {
        dimension: item.dimension,
        key: item.key,
        label: item.label,
        brainNodeId: item.brainNodeId,
        scores: { short: 0, medium: 0, long: 0 },
        explicitTranscripts: 0,
        observedEvents: 0,
        transcriptIds: new Set<string>(),
        lastEventAt: item.lastEventAt,
      };
      aggregate.scores[horizonKey] = score;
      // Horizons overlap by design. Using the maximum prevents the same stored
      // event from being counted once per projection window.
      aggregate.explicitTranscripts = Math.max(
        aggregate.explicitTranscripts,
        Math.max(0, item.evidence.explicitTranscripts),
      );
      aggregate.observedEvents = Math.max(
        aggregate.observedEvents,
        Math.max(0, item.evidence.observedEvents),
      );
      for (const transcriptId of item.evidence.transcriptIds) {
        if (sourcesByTranscriptId.has(transcriptId)) aggregate.transcriptIds.add(transcriptId);
      }
      if (item.lastEventAt > aggregate.lastEventAt) aggregate.lastEventAt = item.lastEventAt;
      if (!aggregate.brainNodeId && item.brainNodeId) aggregate.brainNodeId = item.brainNodeId;
      aggregates.set(aggregateKey, aggregate);
    }
  }

  const classificationOrder: Record<PersonalGuideTrendClassification, number> = {
    EMERGING: 0,
    STEADY: 1,
    COOLING: 2,
  };
  const trends = [...aggregates.values()]
    .filter((aggregate) => Math.max(...Object.values(aggregate.scores)) >= PERSONAL_GUIDE_MIN_SCORE)
    .filter((aggregate) => Math.max(...Object.values(aggregate.scores)) > 0)
    .map((aggregate): PersonalGuideTrend | null => {
      const classification = classifyTrend(aggregate.scores);
      if (!classification) return null;
      return {
        dimension: aggregate.dimension,
        key: aggregate.key,
        label: aggregate.label,
        brainNodeId: aggregate.brainNodeId,
        classification,
        score: roundScore(
          aggregate.scores.short * 0.5 +
            aggregate.scores.medium * 0.3 +
            aggregate.scores.long * 0.2,
        ),
        scores: aggregate.scores,
        evidence: {
          explicitTranscripts: aggregate.explicitTranscripts,
          observedEvents: aggregate.observedEvents,
          transcriptIds: [...aggregate.transcriptIds].sort().slice(0, 5),
        },
        lastEventAt: aggregate.lastEventAt,
      };
    })
    .filter((trend): trend is PersonalGuideTrend => trend !== null)
    .sort(
      (left, right) =>
        classificationOrder[left.classification] - classificationOrder[right.classification] ||
        right.score - left.score ||
        left.label.localeCompare(right.label) ||
        left.key.localeCompare(right.key),
    );

  return (['EMERGING', 'STEADY', 'COOLING'] as const).flatMap((classification) =>
    trends
      .filter((trend) => trend.classification === classification)
      .slice(0, PERSONAL_GUIDE_TRENDS_PER_CLASSIFICATION),
  );
}

function classifyTrend(scores: TrendAggregate['scores']): PersonalGuideTrendClassification | null {
  if (scores.short > 0 && scores.short - scores.long >= PERSONAL_GUIDE_TREND_DELTA) {
    return 'EMERGING';
  }
  if (
    scores.long >= PERSONAL_GUIDE_MIN_SCORE &&
    scores.short <= Math.max(PERSONAL_GUIDE_MIN_SCORE, scores.long - PERSONAL_GUIDE_TREND_DELTA)
  ) {
    return 'COOLING';
  }
  const supportedHorizons = Object.values(scores).filter(
    (score) => score >= PERSONAL_GUIDE_MIN_SCORE,
  ).length;
  return supportedHorizons >= 2 ? 'STEADY' : null;
}

function buildRecommendations(input: {
  graph: BuildPersonalGuideInput['graph'];
  centrality: GraphCentralityResult;
  communities: GraphCommunity[];
  sourcesByTranscriptId: Map<string, PersonalGuideSource>;
  interestByNodeId: Map<string, PersonalGuideTrend>;
}): PersonalGuideRecommendation[] {
  const centralityByNodeId = new Map(input.centrality.nodes.map((score) => [score.id, score]));
  const neighbors = buildNeighbors(input.graph.edges);
  const communityByNodeId = new Map<string, GraphCommunity>();
  for (const community of input.communities) {
    for (const nodeId of community.nodeIds) communityByNodeId.set(nodeId, community);
  }

  const ranked = input.graph.nodes
    .map((node): PersonalGuideRecommendation | null => {
      const transcriptId = canonicalTranscriptId(node);
      if (!transcriptId) return null;
      const source = input.sourcesByTranscriptId.get(transcriptId);
      const score = centralityByNodeId.get(node.id);
      if (!source || !score) return null;
      const reasons: PersonalGuideReason[] = [];
      const directlyMatched = matchingInterestTrends(node.id, neighbors, input.interestByNodeId);
      if (directlyMatched.length > 0) {
        const strongest = directlyMatched[0]!;
        reasons.push({
          kind: 'INTEREST',
          label: strongest.label,
          score: strongest.score,
          evidenceTranscriptIds: strongest.evidence.transcriptIds,
        });
      }
      const community = communityByNodeId.get(node.id);
      if (community) {
        const communityInterests = community.nodeIds
          .map((nodeId) => input.interestByNodeId.get(nodeId))
          .filter((trend): trend is PersonalGuideTrend => Boolean(trend))
          .sort(compareTrendStrength);
        if (communityInterests.length > 0) {
          const strongest = communityInterests[0]!;
          reasons.push({
            kind: 'COMMUNITY',
            label: strongest.label,
            score: roundScore(community.cohesion),
            evidenceTranscriptIds: strongest.evidence.transcriptIds,
            community: {
              id: community.id,
              label: community.label,
              cohesion: roundScore(community.cohesion),
            },
          });
        }
      }
      if (
        input.centrality.metadata.personalizationMode === 'durable-interest' &&
        score.personalizationLift > 0.05
      ) {
        reasons.push({
          kind: 'PERSONALIZATION',
          label: 'personalized-pagerank',
          score: roundScore(score.personalizationLift),
          evidenceTranscriptIds: directlyMatched.flatMap((trend) => trend.evidence.transcriptIds),
        });
      }
      if (reasons.length === 0) {
        reasons.push({
          kind: 'STRUCTURAL',
          label: 'weighted-pagerank',
          score: roundScore(score.pageRank),
          evidenceTranscriptIds: [],
        });
      }
      return {
        ...source,
        brainNodeId: node.id,
        score: roundScore(
          input.centrality.metadata.personalizationMode === 'durable-interest'
            ? score.personalizedPageRank
            : score.pageRank,
        ),
        structuralScore: roundScore(score.pageRank),
        personalizedScore: roundScore(score.personalizedPageRank),
        personalizationLift: roundScore(score.personalizationLift),
        reasons: dedupeReasons(reasons),
      };
    })
    .filter((recommendation): recommendation is PersonalGuideRecommendation =>
      Boolean(recommendation),
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.structuralScore - left.structuralScore ||
        left.title.localeCompare(right.title) ||
        left.transcriptId.localeCompare(right.transcriptId),
    )
    .slice(0, PERSONAL_GUIDE_RECOMMENDATION_LIMIT);
  const maximumScore = ranked[0]?.score ?? 0;
  return ranked.map((recommendation) => ({
    ...recommendation,
    score: maximumScore > 0 ? roundScore(recommendation.score / maximumScore) : 0,
  }));
}

function matchingInterestTrends(
  nodeId: string,
  neighbors: Map<string, Set<string>>,
  interestByNodeId: Map<string, PersonalGuideTrend>,
): PersonalGuideTrend[] {
  const matched = new Map<string, PersonalGuideTrend>();
  const direct = interestByNodeId.get(nodeId);
  if (direct) matched.set(`${direct.dimension}:${direct.key}`, direct);
  for (const neighborId of neighbors.get(nodeId) ?? []) {
    const trend = interestByNodeId.get(neighborId);
    if (trend) matched.set(`${trend.dimension}:${trend.key}`, trend);
  }
  return [...matched.values()].sort(compareTrendStrength);
}

function compareTrendStrength(left: PersonalGuideTrend, right: PersonalGuideTrend): number {
  return (
    right.score - left.score ||
    left.label.localeCompare(right.label) ||
    left.key.localeCompare(right.key)
  );
}

function buildNeighbors(edges: GraphReadEdge[]): Map<string, Set<string>> {
  const neighbors = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    const from = neighbors.get(edge.from) ?? new Set<string>();
    const to = neighbors.get(edge.to) ?? new Set<string>();
    from.add(edge.to);
    to.add(edge.from);
    neighbors.set(edge.from, from);
    neighbors.set(edge.to, to);
  }
  return neighbors;
}

function dedupeReasons(reasons: PersonalGuideReason[]): PersonalGuideReason[] {
  const seen = new Set<PersonalGuideReasonKind>();
  return reasons.filter((reason) => {
    if (seen.has(reason.kind)) return false;
    seen.add(reason.kind);
    reason.evidenceTranscriptIds = [...new Set(reason.evidenceTranscriptIds)].sort().slice(0, 5);
    return true;
  });
}

function canonicalTranscriptId(node: GraphReadNode): string | null {
  return node.sourceType === 'TRANSCRIPT' && node.sourceId ? node.sourceId : null;
}

function horizonScoreKey(
  horizon: InterestProjectionSnapshot['horizon'],
): keyof TrendAggregate['scores'] {
  if (horizon === 'SHORT') return 'short';
  if (horizon === 'MEDIUM') return 'medium';
  return 'long';
}

function finiteScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return roundScore(Math.min(1, Math.max(-1, value)));
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
