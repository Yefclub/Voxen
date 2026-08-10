export const MERMAID_MIN_SCALE = 0.5;
export const MERMAID_MAX_SCALE = 3;
export const MERMAID_SCALE_STEP = 0.25;

export interface MermaidViewport {
  scale: number;
  x: number;
  y: number;
}

export interface MermaidCanvasState {
  viewport: MermaidViewport;
  expanded: boolean;
  dragging: boolean;
}

export type MermaidCanvasAction =
  | { type: 'zoom'; delta: number }
  | { type: 'pan'; x: number; y: number }
  | { type: 'reset-viewport' }
  | { type: 'set-dragging'; dragging: boolean }
  | { type: 'set-expanded'; expanded: boolean }
  | { type: 'content-changed' };

export const initialMermaidCanvasState: MermaidCanvasState = {
  viewport: { scale: 1, x: 0, y: 0 },
  expanded: false,
  dragging: false,
};

function clampScale(scale: number): number {
  return Math.min(MERMAID_MAX_SCALE, Math.max(MERMAID_MIN_SCALE, scale));
}

export function mermaidCanvasReducer(
  state: MermaidCanvasState,
  action: MermaidCanvasAction,
): MermaidCanvasState {
  if (action.type === 'zoom') {
    return {
      ...state,
      viewport: { ...state.viewport, scale: clampScale(state.viewport.scale + action.delta) },
    };
  }
  if (action.type === 'pan') {
    return { ...state, viewport: { ...state.viewport, x: action.x, y: action.y } };
  }
  if (action.type === 'reset-viewport') {
    return { ...state, viewport: initialMermaidCanvasState.viewport };
  }
  if (action.type === 'set-dragging') return { ...state, dragging: action.dragging };
  if (action.type === 'set-expanded') {
    return { ...state, expanded: action.expanded, dragging: action.expanded && state.dragging };
  }
  return { ...state, viewport: initialMermaidCanvasState.viewport, dragging: false };
}

export function bindMermaidWheelZoom(
  target: HTMLElement,
  onZoom: (delta: number) => void,
): () => void {
  const handleWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    onZoom(event.deltaY < 0 ? MERMAID_SCALE_STEP : -MERMAID_SCALE_STEP);
  };
  target.addEventListener('wheel', handleWheel, { passive: false });
  return () => target.removeEventListener('wheel', handleWheel);
}
