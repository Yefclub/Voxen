import type { NodeHoverDrawingFunction } from 'sigma/rendering';
import type { GraphPalette, SigmaEdgeAttributes, SigmaNodeAttributes } from './graph-model';

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
 * O hover padrão do Sigma usa uma cápsula branca fixa. Com o texto claro do
 * tema escuro isso produz um retângulo ilegível. Este renderer mantém
 * superfície e texto sincronizados com o tema e limita títulos muito longos.
 */
export function createSigmaNodeHoverRenderer(
  palette: GraphPalette,
): NodeHoverDrawingFunction<SigmaNodeAttributes, SigmaEdgeAttributes> {
  return (context, data, settings) => {
    const rawLabel = typeof data.label === 'string' ? data.label.trim() : '';
    if (!rawLabel) return;

    const label = rawLabel.length > 92 ? `${rawLabel.slice(0, 89).trimEnd()}\u2026` : rawLabel;
    const fontSize = settings.labelSize;
    const paddingX = 8;
    const paddingY = 5;
    const gap = Math.max(data.size, fontSize / 2) + 5;

    context.save();
    context.font = `${settings.labelWeight} ${fontSize}px ${settings.labelFont}`;
    const width = Math.ceil(context.measureText(label).width + paddingX * 2);
    const height = Math.ceil(fontSize + paddingY * 2);
    const x = data.x + gap;
    const y = data.y - height / 2;

    context.beginPath();
    context.roundRect(x, y, width, height, Math.min(7, height / 2));
    context.fillStyle = palette.canvas;
    context.shadowColor = 'rgba(0, 0, 0, 0.45)';
    context.shadowBlur = 12;
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = palette.dimNode;
    context.lineWidth = 1;
    context.stroke();

    context.fillStyle = palette.label;
    context.textBaseline = 'middle';
    context.fillText(label, x + paddingX, data.y);
    context.restore();
  };
}

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
