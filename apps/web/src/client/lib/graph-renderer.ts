export type GraphMode = '2d' | '3d';
export type GraphRenderTier = 'detailed' | 'balanced' | 'dense';
export type GraphLabelType = 'auto' | 'none';
export type GraphEdgeInterpolation = 'curved' | 'linear';

export interface GraphRenderProfile {
  tier: GraphRenderTier;
  labelType: GraphLabelType;
  edgeInterpolation: GraphEdgeInterpolation;
  animated: boolean;
  draggable: boolean;
  aggregateEdges: boolean;
}

/** 2D (Sigma) por padrão — 3D só sob demanda (spec 103). */
export const DEFAULT_GRAPH_MODE: GraphMode = '2d';
export function resolveGraphRenderProfile(
  nodeCount: number,
  edgeCount: number,
  coarsePointer: boolean,
): GraphRenderProfile {
  if (nodeCount > 300 || edgeCount > 900) {
    return {
      tier: 'dense',
      labelType: 'none',
      edgeInterpolation: 'linear',
      animated: false,
      draggable: false,
      aggregateEdges: true,
    };
  }

  if (nodeCount > 110 || edgeCount > 360 || coarsePointer) {
    return {
      tier: 'balanced',
      labelType: nodeCount > 220 ? 'none' : 'auto',
      edgeInterpolation: edgeCount > 520 ? 'linear' : 'curved',
      animated: false,
      draggable: !coarsePointer && nodeCount <= 180,
      aggregateEdges: edgeCount > 600,
    };
  }

  return {
    tier: 'detailed',
    labelType: 'auto',
    edgeInterpolation: 'curved',
    animated: true,
    draggable: true,
    aggregateEdges: false,
  };
}
