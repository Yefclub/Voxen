import type {
  GraphCentralityMetadata,
  GraphCentralityNodeScore,
} from '../../shared/graph-centrality';
import {
  aggregateWeightedUndirectedEdges,
  type GraphWeightEdge,
} from '../../shared/graph-edge-weighting';

interface CentralityNode {
  id: string;
  label: string;
  type: string;
}

interface CentralityData<Node extends CentralityNode> {
  nodes: Node[];
  edges: GraphWeightEdge[];
  insights?: {
    nodeCentrality?: GraphCentralityNodeScore[];
    centrality?: GraphCentralityMetadata;
  };
}

export interface ClientGraphHub<Node extends CentralityNode> {
  id: string;
  label: string;
  type: Node['type'];
  degree: number;
  weightedDegree: number;
  weightedDegreeCentrality: number;
  pageRank: number;
  personalizedPageRank: number;
  personalizationLift: number;
}

export function buildClientGraphCentrality<Node extends CentralityNode>(
  data: CentralityData<Node>,
): {
  hubs: ClientGraphHub<Node>[];
  nodeCentrality?: GraphCentralityNodeScore[];
  centrality?: GraphCentralityMetadata;
} {
  const degree = graphDegrees(data.edges);
  const weightedEdges = aggregateWeightedUndirectedEdges(
    new Set(data.nodes.map((node) => node.id)),
    data.edges,
  );
  const weightedDegree = new Map<string, number>();
  for (const edge of weightedEdges) {
    weightedDegree.set(edge.from, (weightedDegree.get(edge.from) ?? 0) + edge.weight);
    weightedDegree.set(edge.to, (weightedDegree.get(edge.to) ?? 0) + edge.weight);
  }
  const maximumWeightedDegree = Math.max(0, ...weightedDegree.values());
  const serverCentrality = new Map(
    (data.insights?.nodeCentrality ?? []).map((score) => [score.id, score]),
  );
  const visibleIds = new Set(data.nodes.map((node) => node.id));
  const hubs = data.nodes
    .map<ClientGraphHub<Node>>((node) => {
      const stored = serverCentrality.get(node.id);
      const localWeightedDegree = weightedDegree.get(node.id) ?? 0;
      return {
        id: node.id,
        label: node.label,
        type: node.type,
        degree: degree.get(node.id) ?? 0,
        weightedDegree: localWeightedDegree,
        weightedDegreeCentrality:
          maximumWeightedDegree > 0 ? localWeightedDegree / maximumWeightedDegree : 0,
        pageRank: stored?.pageRank ?? 0,
        personalizedPageRank: stored?.personalizedPageRank ?? 0,
        personalizationLift: stored?.personalizationLift ?? 0,
      };
    })
    .filter((hub) => hub.degree > 0)
    .sort(
      (left, right) =>
        right.weightedDegreeCentrality - left.weightedDegreeCentrality ||
        right.personalizedPageRank - left.personalizedPageRank ||
        right.pageRank - left.pageRank ||
        left.label.localeCompare(right.label) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 12);
  return {
    hubs,
    ...(data.insights?.nodeCentrality
      ? { nodeCentrality: data.insights.nodeCentrality.filter((score) => visibleIds.has(score.id)) }
      : {}),
    ...(data.insights?.centrality ? { centrality: data.insights.centrality } : {}),
  };
}

function graphDegrees(edges: GraphWeightEdge[]): Map<string, number> {
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  return degree;
}
