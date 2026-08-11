import JavaRandom from 'java-random';
import { Clustering, LeidenAlgorithm, Network } from 'networkanalysis-ts';
import type { GraphCommunity, GraphCommunityResult } from '../shared/graph-community';

export const GRAPH_COMMUNITY_ALGORITHM_VERSION = 'leiden-modularity-v1';
export const GRAPH_COMMUNITY_RESOLUTION = 1;
export const GRAPH_COMMUNITY_SEED = 17;

interface CommunityNode {
  id: string;
  label: string;
}

interface CommunityEdge {
  from: string;
  to: string;
  kind: string;
  confidence: string | number;
  evidence?: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
}

interface WeightedEdge {
  from: string;
  to: string;
  weight: number;
}

interface DetectorResult {
  membership: number[];
  quality: number;
}

type MembershipDetector = (
  nodeCount: number,
  edges: WeightedEdge[],
  nodeIndex: Map<string, number>,
) => DetectorResult;

const EVIDENCE_FACTORS: Record<NonNullable<CommunityEdge['evidence']>, number> = {
  EXTRACTED: 1,
  INFERRED: 0.65,
  AMBIGUOUS: 0.4,
};

const KIND_FACTORS: Readonly<Record<string, number>> = {
  same_as: 1.15,
  belongs_to: 1.1,
  part_of: 1.1,
  supports: 1,
  mentions: 0.9,
  links_to: 0.85,
  related_to: 0.7,
  next_to: 0.45,
  contradicts: 0.35,
};

export function effectiveCommunityEdgeWeight(edge: CommunityEdge): number {
  const parsedConfidence = Number(edge.confidence);
  const confidence = Number.isFinite(parsedConfidence) ? clamp(parsedConfidence, 0, 1) : 0.5;
  const evidenceFactor = EVIDENCE_FACTORS[edge.evidence ?? 'AMBIGUOUS'];
  const kindFactor = KIND_FACTORS[edge.kind.toLowerCase()] ?? 0.5;
  return round(clamp(confidence * evidenceFactor * kindFactor, 0, 1));
}

export function detectGraphCommunities(
  nodes: CommunityNode[],
  edges: CommunityEdge[],
  dependencies: { detectMembership?: MembershipDetector } = {},
): GraphCommunityResult {
  const orderedNodes = dedupeNodes(nodes);
  const nodeById = new Map(orderedNodes.map((node) => [node.id, node]));
  const weightedEdges = aggregateWeightedEdges(nodeById, edges);
  const eligibleIds = new Set<string>();
  for (const edge of weightedEdges) {
    eligibleIds.add(edge.from);
    eligibleIds.add(edge.to);
  }
  const eligibleNodes = orderedNodes.filter((node) => eligibleIds.has(node.id));
  if (eligibleNodes.length < 2 || weightedEdges.length === 0) {
    return {
      communities: [],
      detection: detectionMetadata({
        method: 'leiden',
        quality: 0,
        eligibleNodes: eligibleNodes.length,
        eligibleEdges: weightedEdges.length,
        singletonNodes: orderedNodes.length,
        fallbackReason: null,
      }),
    };
  }

  const nodeIndex = new Map(eligibleNodes.map((node, index) => [node.id, index]));
  let membership: number[];
  let quality: number | null;
  let fallbackReason: 'detector-error' | null = null;
  let method: 'leiden' | 'connected-components' = 'leiden';
  try {
    const detected = (dependencies.detectMembership ?? runLeiden)(
      eligibleNodes.length,
      weightedEdges,
      nodeIndex,
    );
    if (
      detected.membership.length !== eligibleNodes.length ||
      detected.membership.some((cluster) => !Number.isInteger(cluster) || cluster < 0) ||
      !Number.isFinite(detected.quality)
    ) {
      throw new Error('invalid Leiden result');
    }
    membership = detected.membership;
    quality = round(detected.quality);
  } catch {
    membership = connectedComponentMembership(eligibleNodes, weightedEdges, nodeIndex);
    quality = null;
    method = 'connected-components';
    fallbackReason = 'detector-error';
  }

  const connectedGroups = splitDisconnectedGroups(eligibleNodes, weightedEdges, membership);
  const communities = buildCommunities(connectedGroups, nodeById, weightedEdges);
  const groupedNodeCount = communities.reduce((total, community) => total + community.size, 0);
  return {
    communities,
    detection: detectionMetadata({
      method,
      quality,
      eligibleNodes: eligibleNodes.length,
      eligibleEdges: weightedEdges.length,
      singletonNodes: orderedNodes.length - groupedNodeCount,
      fallbackReason,
    }),
  };
}

function runLeiden(
  nodeCount: number,
  edges: WeightedEdge[],
  nodeIndex: Map<string, number>,
): DetectorResult {
  const network = new Network({
    nNodes: nodeCount,
    setNodeWeightsToTotalEdgeWeights: true,
    edges: [
      edges.map((edge) => nodeIndex.get(edge.from)!),
      edges.map((edge) => nodeIndex.get(edge.to)!),
    ],
    edgeWeights: edges.map((edge) => edge.weight),
    sortedEdges: false,
    checkIntegrity: true,
  });
  const modularityResolution = GRAPH_COMMUNITY_RESOLUTION / (2 * network.getTotalEdgeWeight());
  let best: DetectorResult | null = null;
  for (let start = 0; start < 3; start += 1) {
    const algorithm = new LeidenAlgorithm();
    algorithm.initializeBasedOnResolutionAndNIterationsAndRandomnessAndRandom(
      modularityResolution,
      10,
      0.01,
      new JavaRandom(GRAPH_COMMUNITY_SEED + start),
    );
    const clustering = new Clustering({ nNodes: nodeCount });
    algorithm.improveClustering(network, clustering);
    clustering.orderClustersByNNodes();
    const result = {
      membership: [...clustering.getClusters()],
      quality: algorithm.calcQuality(network, clustering),
    };
    if (!best || result.quality > best.quality) best = result;
  }
  if (!best) throw new Error('Leiden produced no partition');
  return best;
}

function dedupeNodes(nodes: CommunityNode[]): CommunityNode[] {
  const byId = new Map<string, CommunityNode>();
  for (const node of nodes) {
    const id = node.id.trim();
    if (!id || byId.has(id)) continue;
    byId.set(id, { id, label: node.label.trim() || id });
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function aggregateWeightedEdges(
  nodeById: Map<string, CommunityNode>,
  edges: CommunityEdge[],
): WeightedEdge[] {
  const pairs = new Map<string, WeightedEdge>();
  for (const edge of edges) {
    if (edge.from === edge.to || !nodeById.has(edge.from) || !nodeById.has(edge.to)) continue;
    const weight = effectiveCommunityEdgeWeight(edge);
    if (weight <= 0) continue;
    const [from, to] = edge.from < edge.to ? [edge.from, edge.to] : [edge.to, edge.from];
    const key = `${from}\u0000${to}`;
    const current = pairs.get(key);
    pairs.set(key, {
      from,
      to,
      weight: round(1 - (1 - (current?.weight ?? 0)) * (1 - weight)),
    });
  }
  return [...pairs.values()].sort(
    (left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to),
  );
}

function connectedComponentMembership(
  nodes: CommunityNode[],
  edges: WeightedEdge[],
  nodeIndex: Map<string, number>,
): number[] {
  const parent = nodes.map((_, index) => index);
  const find = (value: number): number => {
    let root = value;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[value] !== value) {
      const next = parent[value]!;
      parent[value] = root;
      value = next;
    }
    return root;
  };
  for (const edge of edges) {
    const from = find(nodeIndex.get(edge.from)!);
    const to = find(nodeIndex.get(edge.to)!);
    if (from !== to) parent[to] = from;
  }
  const clusterByRoot = new Map<number, number>();
  return nodes.map((_, index) => {
    const root = find(index);
    if (!clusterByRoot.has(root)) clusterByRoot.set(root, clusterByRoot.size);
    return clusterByRoot.get(root)!;
  });
}

function splitDisconnectedGroups(
  nodes: CommunityNode[],
  edges: WeightedEdge[],
  membership: number[],
): string[][] {
  const clusterByNode = new Map(nodes.map((node, index) => [node.id, membership[index]!]));
  const adjacency = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of edges) {
    if (clusterByNode.get(edge.from) !== clusterByNode.get(edge.to)) continue;
    adjacency.get(edge.from)!.add(edge.to);
    adjacency.get(edge.to)!.add(edge.from);
  }
  const visited = new Set<string>();
  const groups: string[][] = [];
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    const expectedCluster = clusterByNode.get(node.id);
    const stack = [node.id];
    const group: string[] = [];
    visited.add(node.id);
    while (stack.length > 0) {
      const current = stack.pop()!;
      group.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor) || clusterByNode.get(neighbor) !== expectedCluster) continue;
        visited.add(neighbor);
        stack.push(neighbor);
      }
    }
    groups.push(group.sort());
  }
  return groups;
}

function buildCommunities(
  groups: string[][],
  nodeById: Map<string, CommunityNode>,
  edges: WeightedEdge[],
): GraphCommunity[] {
  const communities = groups
    .filter((group) => group.length >= 2)
    .map((nodeIds) => {
      const members = new Set(nodeIds);
      const internalDegree = new Map<string, number>();
      let internalWeight = 0;
      let boundaryWeight = 0;
      for (const edge of edges) {
        const fromInside = members.has(edge.from);
        const toInside = members.has(edge.to);
        if (fromInside && toInside) {
          internalWeight += edge.weight;
          internalDegree.set(edge.from, (internalDegree.get(edge.from) ?? 0) + edge.weight);
          internalDegree.set(edge.to, (internalDegree.get(edge.to) ?? 0) + edge.weight);
        } else if (fromInside || toInside) {
          boundaryWeight += edge.weight;
        }
      }
      const representativeNodeId = [...nodeIds].sort(
        (left, right) =>
          (internalDegree.get(right) ?? 0) - (internalDegree.get(left) ?? 0) ||
          (nodeById.get(left)?.label ?? left).localeCompare(nodeById.get(right)?.label ?? right) ||
          left.localeCompare(right),
      )[0]!;
      return {
        id: 0,
        size: nodeIds.length,
        label: nodeById.get(representativeNodeId)?.label ?? representativeNodeId,
        nodeIds,
        representativeNodeId,
        internalWeight: round(internalWeight),
        boundaryWeight: round(boundaryWeight),
        cohesion: round(
          internalWeight + boundaryWeight > 0
            ? internalWeight / (internalWeight + boundaryWeight)
            : 0,
        ),
      };
    })
    .sort(
      (left, right) =>
        right.size - left.size ||
        right.cohesion - left.cohesion ||
        right.internalWeight - left.internalWeight ||
        left.label.localeCompare(right.label) ||
        left.nodeIds.join('\u0000').localeCompare(right.nodeIds.join('\u0000')),
    );
  return communities.map((community, id) => ({ ...community, id }));
}

function detectionMetadata(input: {
  method: 'leiden' | 'connected-components';
  quality: number | null;
  eligibleNodes: number;
  eligibleEdges: number;
  singletonNodes: number;
  fallbackReason: 'detector-error' | null;
}): GraphCommunityResult['detection'] {
  return {
    method: input.method,
    algorithmVersion: GRAPH_COMMUNITY_ALGORITHM_VERSION,
    objective: 'modularity',
    resolution: GRAPH_COMMUNITY_RESOLUTION,
    seed: GRAPH_COMMUNITY_SEED,
    quality: input.quality,
    eligibleNodes: input.eligibleNodes,
    eligibleEdges: input.eligibleEdges,
    singletonNodes: input.singletonNodes,
    fallbackReason: input.fallbackReason,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
