import type { NodeHoverDrawingFunction, NodeLabelDrawingFunction } from 'sigma/rendering';
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

/** Bound rendered text by measured width, preserving full names in the inspector. */
export function fitGraphLabel(
  label: string,
  maxWidth: number,
  measure: (value: string) => number,
): string {
  const text = label.trim().replace(/\s+/g, ' ');
  if (measure(text) <= maxWidth) return text;
  const ellipsis = '…';
  if (measure(ellipsis) > maxWidth) return '';
  const characters = Array.from(text);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measure(characters.slice(0, middle).join('') + ellipsis) <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return characters.slice(0, low).join('').trimEnd() + ellipsis;
}

function canvasSize(context: CanvasRenderingContext2D): { width: number; height: number } {
  const ratio = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  return {
    width: context.canvas?.clientWidth || (context.canvas?.width ?? 800) / ratio,
    height: context.canvas?.clientHeight || (context.canvas?.height ?? 600) / ratio,
  };
}

export interface GraphLabelRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type LabelDrawing = NodeLabelDrawingFunction<SigmaNodeAttributes, SigmaEdgeAttributes>;
type LabelCandidate = Parameters<LabelDrawing>;
type LabelObstacle = { x: number; y: number; size: number };

function intersects(a: GraphLabelRect, b: GraphLabelRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Sigma's grid selects candidates; measured rectangles resolve collisions per frame. */
export function createSigmaNodeLabelRenderer(palette: GraphPalette): LabelDrawing & {
  reset: () => void;
  flush: (nodes?: LabelObstacle[], reserved?: GraphLabelRect[]) => void;
} {
  let candidates: LabelCandidate[] = [];
  const draw: LabelDrawing = (...candidate) => {
    if (candidate[1].label) candidates.push(candidate);
  };
  return Object.assign(draw, {
    reset: () => {
      candidates = [];
    },
    flush: (nodes: LabelObstacle[] = [], reserved: GraphLabelRect[] = []) => {
      const occupied = [
        ...reserved,
        ...nodes.map((node) => ({
          left: node.x - node.size - 3,
          right: node.x + node.size + 3,
          top: node.y - node.size - 3,
          bottom: node.y + node.size + 3,
        })),
      ];
      // Active nodes precede source content, then larger nodes. Geometry breaks ties
      // deterministically so a refresh cannot reshuffle otherwise equal candidates.
      candidates.sort(
        ([, a], [, b]) =>
          (b.zIndex ?? 0) - (a.zIndex ?? 0) ||
          b.size - a.size ||
          a.y - b.y ||
          a.x - b.x ||
          String(a.label).localeCompare(String(b.label)),
      );
      for (const [context, data, settings] of candidates) {
        context.save();
        context.font = `${settings.labelWeight} ${settings.labelSize}px ${settings.labelFont}`;
        context.textAlign = 'left';
        context.textBaseline = 'alphabetic';
        const viewport = canvasSize(context);
        if (data.x < 0 || data.x > viewport.width || data.y < 0 || data.y > viewport.height) {
          context.restore();
          continue;
        }
        for (const side of ['right', 'left', 'above', 'below'] as const) {
          const available =
            side === 'right'
              ? viewport.width - data.x - data.size - 14
              : side === 'left'
                ? data.x - data.size - 14
                : viewport.width - 16;
          if (available < 48) continue;
          const label = fitGraphLabel(
            String(data.label),
            Math.min(144, available),
            (value) => context.measureText(value).width,
          );
          const metrics = context.measureText(label);
          const ascent = metrics.actualBoundingBoxAscent ?? settings.labelSize;
          const descent = metrics.actualBoundingBoxDescent ?? settings.labelSize / 3;
          const x =
            side === 'right'
              ? data.x + data.size + 6
              : side === 'left'
                ? data.x - data.size - 6 - metrics.width
                : Math.max(
                    8,
                    Math.min(data.x - metrics.width / 2, viewport.width - metrics.width - 8),
                  );
          const y =
            side === 'above'
              ? data.y - data.size - 8 - descent
              : side === 'below'
                ? data.y + data.size + 8 + ascent
                : data.y + (ascent - descent) / 2;
          const box = {
            left: x - Math.max(0, metrics.actualBoundingBoxLeft ?? 0) - 3,
            right: x + Math.max(metrics.width, metrics.actualBoundingBoxRight ?? 0) + 3,
            top: y - ascent - 3,
            bottom: y + descent + 3,
          };
          if (
            box.left < 5 ||
            box.top < 5 ||
            box.right > viewport.width - 5 ||
            box.bottom > viewport.height - 5 ||
            occupied.some((other) => intersects(box, other))
          )
            continue;
          occupied.push(box);
          context.lineWidth = 3;
          context.strokeStyle = palette.labelStroke;
          context.strokeText(label, x, y);
          context.fillStyle = palette.label;
          context.fillText(label, x, y);
          break;
        }
        context.restore();
      }
      candidates = [];
    },
  });
}

/**
 * Hover legível e limitado ao viewport: superfície e texto sincronizados com o
 * tema, largura medida em vez de corte por contagem de caracteres.
 */
export function createSigmaNodeHoverRenderer(
  palette: GraphPalette,
): NodeHoverDrawingFunction<SigmaNodeAttributes, SigmaEdgeAttributes> {
  return (context, data, settings) => {
    if (!data.label) return;
    context.save();
    context.font = `${settings.labelWeight} ${settings.labelSize}px ${settings.labelFont}`;
    const viewport = canvasSize(context);
    const label = fitGraphLabel(
      String(data.label),
      Math.min(280, viewport.width - 40),
      (value) => context.measureText(value).width,
    );
    const width = Math.ceil(context.measureText(label).width + 16);
    const height = settings.labelSize + 14;
    const x = Math.max(8, Math.min(data.x + data.size + 6, viewport.width - width - 8));
    const y = Math.max(8, Math.min(data.y - height / 2, viewport.height - height - 8));
    context.beginPath();
    context.roundRect(x, y, width, height, 7);
    context.fillStyle = palette.canvas;
    context.fill();
    context.strokeStyle = palette.dimNode;
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = palette.label;
    context.textBaseline = 'middle';
    context.fillText(label, x + 8, y + height / 2);
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
