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
export const GRAPH_3D_INIT_TIMEOUT_MS = 8_000;

/**
 * Arma o orçamento de inicialização do renderer 3D. O cancelamento é
 * idempotente e impede callback tardio depois de sucesso ou unmount.
 */
export function scheduleGraph3DInitializationFallback(
  onTimeout: () => void,
  timeoutMs: number = GRAPH_3D_INIT_TIMEOUT_MS,
): () => void {
  let active = true;
  const timeoutId = globalThis.setTimeout(
    () => {
      if (!active) return;
      active = false;
      onTimeout();
    },
    Math.max(0, timeoutMs),
  );
  return () => {
    if (!active) return;
    active = false;
    globalThis.clearTimeout(timeoutId);
  };
}

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
