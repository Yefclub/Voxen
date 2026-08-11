import type { GraphCentralityMetadata, GraphCentralityResult } from './graph-centrality';
import {
  aggregateWeightedUndirectedEdges,
  roundGraphScore,
  type GraphWeightEdge,
  type WeightedGraphEdge,
} from './graph-edge-weighting';

export const GRAPH_RANKING_ALGORITHM_VERSION = 'weighted-pagerank-v1';
export const GRAPH_RANKING_DAMPING_FACTOR = 0.85;
export const GRAPH_RANKING_TOLERANCE = 1e-10;
export const GRAPH_RANKING_MAX_ITERATIONS = 100;
export const GRAPH_INTEREST_HORIZON_WEIGHTS = {
  SHORT: 0.5,
  MEDIUM: 0.3,
  LONG: 0.2,
} as const;

interface RankingNode {
  id: string;
  label: string;
}

export interface GraphPersonalSeed {
  nodeId: string;
  weight: number;
}

export interface GraphRankingPersonalization {
  projectionAvailable: boolean;
  projectionAlgorithmVersions: string[];
  projectionWatermark: string | null;
  requestedSeedNodes: number;
  ignoredNegativeItems: number;
}

interface PageRankRun {
  scores: number[];
  iterations: number;
  converged: boolean;
}

export function calculateGraphCentrality(input: {
  nodes: RankingNode[];
  edges: GraphWeightEdge[];
  personalSeeds?: GraphPersonalSeed[];
  personalization?: Partial<GraphRankingPersonalization>;
  snapshotTruncated?: boolean;
}): GraphCentralityResult {
  const orderedNodes = dedupeNodes(input.nodes);
  const nodeIndex = new Map(orderedNodes.map((node, index) => [node.id, index]));
  const weightedEdges = aggregateWeightedUndirectedEdges(new Set(nodeIndex.keys()), input.edges);
  const adjacency = buildAdjacency(orderedNodes.length, nodeIndex, weightedEdges);
  const weightedDegrees = adjacency.map((neighbors) =>
    neighbors.reduce((total, neighbor) => total + neighbor.weight, 0),
  );
  const maximumWeightedDegree = Math.max(0, ...weightedDegrees);
  const uniformTeleport = uniformDistribution(orderedNodes.length);
  const personal = buildPersonalTeleport(nodeIndex, input.personalSeeds ?? [], uniformTeleport);
  const structural = runPageRank(adjacency, uniformTeleport);
  const personalized = runPageRank(adjacency, personal.teleport);
  const labels = new Map(orderedNodes.map((node) => [node.id, node.label]));

  const nodes = orderedNodes
    .map((node, index) => {
      const pageRank = structural.scores[index] ?? 0;
      const personalizedPageRank = personalized.scores[index] ?? 0;
      return {
        id: node.id,
        degree: adjacency[index]?.length ?? 0,
        weightedDegree: roundGraphScore(weightedDegrees[index] ?? 0),
        weightedDegreeCentrality: roundCentrality(
          maximumWeightedDegree > 0 ? (weightedDegrees[index] ?? 0) / maximumWeightedDegree : 0,
        ),
        pageRank: roundCentrality(pageRank),
        personalizedPageRank: roundCentrality(personalizedPageRank),
        personalizationLift: roundGraphScore(
          pageRank + personalizedPageRank > 0
            ? (2 * (personalizedPageRank - pageRank)) / (personalizedPageRank + pageRank)
            : 0,
        ),
      };
    })
    .sort(
      (left, right) =>
        (personal.mode === 'durable-interest'
          ? right.personalizedPageRank - left.personalizedPageRank
          : right.pageRank - left.pageRank) ||
        right.weightedDegree - left.weightedDegree ||
        (labels.get(left.id) ?? left.id).localeCompare(labels.get(right.id) ?? right.id) ||
        left.id.localeCompare(right.id),
    );

  return {
    nodes,
    metadata: buildMetadata(input, structural, personalized, personal),
  };
}

function buildMetadata(
  input: Parameters<typeof calculateGraphCentrality>[0],
  structural: PageRankRun,
  personalized: PageRankRun,
  personal: { mode: 'durable-interest' | 'uniform'; matchedSeedNodes: number },
): GraphCentralityMetadata {
  return {
    algorithmVersion: GRAPH_RANKING_ALGORITHM_VERSION,
    dampingFactor: GRAPH_RANKING_DAMPING_FACTOR,
    tolerance: GRAPH_RANKING_TOLERANCE,
    maxIterations: GRAPH_RANKING_MAX_ITERATIONS,
    structuralIterations: structural.iterations,
    personalizedIterations: personalized.iterations,
    structuralConverged: structural.converged,
    personalizedConverged: personalized.converged,
    personalizationMode: personal.mode,
    requestedSeedNodes:
      input.personalization?.requestedSeedNodes ?? uniquePositiveSeeds(input.personalSeeds ?? []),
    matchedSeedNodes: personal.matchedSeedNodes,
    ignoredNegativeItems: Math.max(0, input.personalization?.ignoredNegativeItems ?? 0),
    projectionAvailable: input.personalization?.projectionAvailable ?? true,
    projectionAlgorithmVersions: [
      ...new Set(input.personalization?.projectionAlgorithmVersions ?? []),
    ].sort(),
    projectionWatermark: input.personalization?.projectionWatermark ?? null,
    horizonWeights: { ...GRAPH_INTEREST_HORIZON_WEIGHTS },
    snapshotTruncated: input.snapshotTruncated ?? false,
  };
}

function dedupeNodes(nodes: RankingNode[]): RankingNode[] {
  const byId = new Map<string, RankingNode>();
  for (const node of nodes) {
    const id = node.id.trim();
    if (!id || byId.has(id)) continue;
    byId.set(id, { id, label: node.label.trim() || id });
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function buildAdjacency(
  nodeCount: number,
  nodeIndex: Map<string, number>,
  edges: WeightedGraphEdge[],
): Array<Array<{ index: number; weight: number }>> {
  const adjacency = Array.from(
    { length: nodeCount },
    () =>
      [] as Array<{
        index: number;
        weight: number;
      }>,
  );
  for (const edge of edges) {
    const from = nodeIndex.get(edge.from);
    const to = nodeIndex.get(edge.to);
    if (from === undefined || to === undefined) continue;
    adjacency[from]!.push({ index: to, weight: edge.weight });
    adjacency[to]!.push({ index: from, weight: edge.weight });
  }
  for (const neighbors of adjacency) neighbors.sort((left, right) => left.index - right.index);
  return adjacency;
}

function buildPersonalTeleport(
  nodeIndex: Map<string, number>,
  seeds: GraphPersonalSeed[],
  uniform: number[],
): { teleport: number[]; mode: 'durable-interest' | 'uniform'; matchedSeedNodes: number } {
  const weights = new Map<number, number>();
  for (const seed of seeds) {
    const index = nodeIndex.get(seed.nodeId);
    const weight = Number(seed.weight);
    if (index === undefined || !Number.isFinite(weight) || weight <= 0) continue;
    weights.set(index, (weights.get(index) ?? 0) + weight);
  }
  const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0)) {
    return { teleport: uniform, mode: 'uniform', matchedSeedNodes: 0 };
  }
  const teleport = Array.from({ length: nodeIndex.size }, (_, index) =>
    roundCentrality((weights.get(index) ?? 0) / total),
  );
  normalizeDistribution(teleport, uniform);
  return { teleport, mode: 'durable-interest', matchedSeedNodes: weights.size };
}

function runPageRank(
  adjacency: Array<Array<{ index: number; weight: number }>>,
  teleport: number[],
): PageRankRun {
  if (adjacency.length === 0) return { scores: [], iterations: 0, converged: true };
  let scores = [...teleport];
  for (let iteration = 1; iteration <= GRAPH_RANKING_MAX_ITERATIONS; iteration += 1) {
    let danglingMass = 0;
    const next = teleport.map((value) => (1 - GRAPH_RANKING_DAMPING_FACTOR) * value);
    for (let index = 0; index < adjacency.length; index += 1) {
      const neighbors = adjacency[index]!;
      const totalWeight = neighbors.reduce((sum, neighbor) => sum + neighbor.weight, 0);
      if (!(totalWeight > 0)) {
        danglingMass += scores[index] ?? 0;
        continue;
      }
      for (const neighbor of neighbors) {
        next[neighbor.index] =
          (next[neighbor.index] ?? 0) +
          GRAPH_RANKING_DAMPING_FACTOR * (scores[index] ?? 0) * (neighbor.weight / totalWeight);
      }
    }
    if (danglingMass > 0) {
      for (let index = 0; index < next.length; index += 1) {
        next[index] =
          (next[index] ?? 0) + GRAPH_RANKING_DAMPING_FACTOR * danglingMass * (teleport[index] ?? 0);
      }
    }
    normalizeDistribution(next, teleport);
    const delta = next.reduce(
      (total, value, index) => total + Math.abs(value - (scores[index] ?? 0)),
      0,
    );
    scores = next;
    if (delta <= GRAPH_RANKING_TOLERANCE) {
      return { scores, iterations: iteration, converged: true };
    }
  }
  return { scores, iterations: GRAPH_RANKING_MAX_ITERATIONS, converged: false };
}

function uniformDistribution(size: number): number[] {
  if (size === 0) return [];
  return Array.from({ length: size }, () => 1 / size);
}

function normalizeDistribution(values: number[], fallback: number[]): void {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? 0;
    values[index] = Number.isFinite(value) && value >= 0 ? value : 0;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) {
    values.splice(0, values.length, ...fallback);
    return;
  }
  for (let index = 0; index < values.length; index += 1) values[index]! /= total;
}

function uniquePositiveSeeds(seeds: GraphPersonalSeed[]): number {
  return new Set(
    seeds
      .filter((seed) => Number.isFinite(Number(seed.weight)) && Number(seed.weight) > 0)
      .map((seed) => seed.nodeId),
  ).size;
}

function roundCentrality(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}
