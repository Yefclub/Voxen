import type { GraphCommunity, GraphCommunityDetection } from '../../shared/graph-community';

interface CommunityNode {
  id: string;
  label: string;
}

interface CommunityEdge {
  from: string;
  to: string;
}

interface CommunityGraphData<Node extends CommunityNode> {
  nodes: Node[];
  edges: CommunityEdge[];
  insights?: {
    communities: GraphCommunity[];
    communityDetection?: GraphCommunityDetection;
  };
}

export function buildGraphCommunitiesFromResponse<Node extends CommunityNode>(
  data: CommunityGraphData<Node>,
  compareNodes: (left: Node, right: Node) => number,
): GraphCommunity[] {
  const projected = projectDetectedCommunities(data);
  if (projected) return projected;

  const nodeIds = new Set(data.nodes.map((node) => node.id));
  const parent = new Map<string, string>(data.nodes.map((node) => [node.id, node.id]));
  const degree = graphDegrees(data.edges);
  const find = (id: string): string => {
    let root = parent.get(id) ?? id;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root) ?? root;
    let cursor = id;
    while ((parent.get(cursor) ?? cursor) !== root) {
      const next = parent.get(cursor) ?? root;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  for (const edge of data.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    const fromRoot = find(edge.from);
    const toRoot = find(edge.to);
    if (fromRoot !== toRoot) parent.set(toRoot, fromRoot);
  }

  const groups = new Map<string, Node[]>();
  for (const node of data.nodes) {
    const root = find(node.id);
    const group = groups.get(root) ?? [];
    group.push(node);
    groups.set(root, group);
  }

  return [...groups.values()]
    .filter((nodes) => nodes.length >= 2)
    .map((nodes) => {
      const ordered = [...nodes].sort(
        (left, right) =>
          (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0) || compareNodes(left, right),
      );
      const communityNodeIds = ordered.map((node) => node.id);
      const members = new Set(communityNodeIds);
      return {
        label: ordered[0]?.label ?? '',
        nodeIds: communityNodeIds,
        representativeNodeId: communityNodeIds[0] ?? '',
        internalWeight: data.edges.filter((edge) => members.has(edge.from) && members.has(edge.to))
          .length,
      };
    })
    .sort((left, right) =>
      right.nodeIds.length !== left.nodeIds.length
        ? right.nodeIds.length - left.nodeIds.length
        : left.label.localeCompare(right.label),
    )
    .map((community, id) => ({
      ...community,
      id,
      size: community.nodeIds.length,
      boundaryWeight: 0,
      cohesion: 1,
    }));
}

export function representativeFirst(community: GraphCommunity): string[] {
  return [
    community.representativeNodeId,
    ...community.nodeIds.filter((nodeId) => nodeId !== community.representativeNodeId),
  ].filter((nodeId, index, values) => Boolean(nodeId) && values.indexOf(nodeId) === index);
}

function projectDetectedCommunities<Node extends CommunityNode>(
  data: CommunityGraphData<Node>,
): GraphCommunity[] | null {
  if (!data.insights?.communityDetection) return null;
  const nodeById = new Map(data.nodes.map((node) => [node.id, node]));
  const degree = graphDegrees(data.edges);
  return data.insights.communities
    .map((community) => {
      const nodeIds = community.nodeIds.filter((nodeId) => nodeById.has(nodeId));
      const representativeNodeId = nodeIds.includes(community.representativeNodeId)
        ? community.representativeNodeId
        : ([...nodeIds].sort(
            (left, right) =>
              (degree.get(right) ?? 0) - (degree.get(left) ?? 0) || left.localeCompare(right),
          )[0] ?? '');
      return {
        ...community,
        size: nodeIds.length,
        label: nodeById.get(representativeNodeId)?.label ?? community.label,
        nodeIds,
        representativeNodeId,
      };
    })
    .filter((community) => community.size >= 2)
    .map((community, id) => ({ ...community, id }));
}

function graphDegrees(edges: CommunityEdge[]): Map<string, number> {
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  return degree;
}
