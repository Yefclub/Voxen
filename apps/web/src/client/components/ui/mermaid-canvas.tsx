import {
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Maximize2, RotateCcw, ZoomIn, ZoomOut } from '@/components/ui/icons';
import { useI18n } from '../../lib/i18n';
import {
  bindMermaidWheelZoom,
  initialMermaidCanvasState,
  MERMAID_MAX_SCALE,
  MERMAID_MIN_SCALE,
  MERMAID_SCALE_STEP,
  mermaidCanvasReducer,
  type MermaidCanvasAction,
  type MermaidViewport,
} from '../../lib/mermaid-canvas-state';
import { cn } from '../../lib/utils';
import { Dialog, DialogContent, DialogTitle } from './dialog';

interface MermaidCanvasProps {
  label: string;
  sanitizedSvg: string;
}

interface DragOrigin {
  pointerX: number;
  pointerY: number;
  viewportX: number;
  viewportY: number;
}

function CanvasButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)] disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function DiagramViewport({
  expanded,
  label,
  sanitizedSvg,
  viewport,
  dragging,
  dispatch,
  onExpand,
}: MermaidCanvasProps & {
  expanded: boolean;
  viewport: MermaidViewport;
  dragging: boolean;
  dispatch: Dispatch<MermaidCanvasAction>;
  onExpand?: () => void;
}): ReactElement {
  const { t } = useI18n();
  const dragOrigin = useRef<DragOrigin | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return bindMermaidWheelZoom(canvas, (delta) => dispatch({ type: 'zoom', delta }));
  }, [dispatch]);

  useEffect(() => {
    return () => dispatch({ type: 'set-dragging', dragging: false });
  }, [dispatch]);

  function reset(): void {
    dispatch({ type: 'reset-viewport' });
  }

  function zoom(delta: number): void {
    dispatch({ type: 'zoom', delta });
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOrigin.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      viewportX: viewport.x,
      viewportY: viewport.y,
    };
    dispatch({ type: 'set-dragging', dragging: true });
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    const origin = dragOrigin.current;
    if (!origin) return;
    dispatch({
      type: 'pan',
      x: origin.viewportX + event.clientX - origin.pointerX,
      y: origin.viewportY + event.clientY - origin.pointerY,
    });
  }

  function stopDragging(event: PointerEvent<HTMLDivElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragOrigin.current = null;
    dispatch({ type: 'set-dragging', dragging: false });
  }

  return (
    <div
      className={cn(
        'relative overflow-hidden border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]',
        expanded ? 'h-full rounded-xl' : 'my-3 h-[min(56dvh,32rem)] min-h-64 rounded-xl',
      )}
    >
      <div
        className={cn(
          'absolute top-3 z-10 flex items-center gap-0.5 rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/90 p-1 shadow-lg backdrop-blur-md',
          expanded ? 'right-12' : 'right-3',
        )}
        role="toolbar"
        aria-label={t('markdown.diagramControls')}
      >
        <CanvasButton
          label={t('markdown.diagramZoomOut')}
          disabled={viewport.scale <= MERMAID_MIN_SCALE}
          onClick={() => zoom(-MERMAID_SCALE_STEP)}
        >
          <ZoomOut className="h-4 w-4" />
        </CanvasButton>
        <span
          className="min-w-12 select-none text-center font-mono text-[10px] text-[var(--color-app-muted)]"
          aria-live="polite"
        >
          {Math.round(viewport.scale * 100)}%
        </span>
        <CanvasButton
          label={t('markdown.diagramZoomIn')}
          disabled={viewport.scale >= MERMAID_MAX_SCALE}
          onClick={() => zoom(MERMAID_SCALE_STEP)}
        >
          <ZoomIn className="h-4 w-4" />
        </CanvasButton>
        <CanvasButton label={t('markdown.diagramReset')} onClick={reset}>
          <RotateCcw className="h-4 w-4" />
        </CanvasButton>
        {onExpand ? (
          <CanvasButton label={t('markdown.diagramExpand')} onClick={onExpand}>
            <Maximize2 className="h-4 w-4" />
          </CanvasButton>
        ) : null}
      </div>
      <div
        ref={canvasRef}
        data-horizontal-scroll="true"
        data-drawer-gesture-ignore
        tabIndex={0}
        role="img"
        aria-label={label}
        onDoubleClick={reset}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onLostPointerCapture={stopDragging}
        onKeyDown={(event) => {
          if (!['+', '=', '-', '0'].includes(event.key)) return;
          event.preventDefault();
          if (event.key === '+' || event.key === '=') zoom(MERMAID_SCALE_STEP);
          else if (event.key === '-') zoom(-MERMAID_SCALE_STEP);
          else reset();
        }}
        className={cn(
          'flex h-full w-full touch-none select-none items-center justify-center overflow-hidden p-12 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
          '[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:min-w-[520px] [&_svg]:max-w-none',
        )}
      >
        <div
          className="will-change-transform"
          style={{
            transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})`,
            transformOrigin: 'center center',
          }}
          dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
        />
      </div>
    </div>
  );
}

export function MermaidCanvas({ label, sanitizedSvg }: MermaidCanvasProps): ReactElement {
  const { t } = useI18n();
  const [state, dispatch] = useReducer(mermaidCanvasReducer, initialMermaidCanvasState);

  useEffect(() => {
    dispatch({ type: 'content-changed' });
  }, [sanitizedSvg]);

  return (
    <>
      <DiagramViewport
        label={label}
        sanitizedSvg={sanitizedSvg}
        expanded={false}
        viewport={state.viewport}
        dragging={state.dragging}
        dispatch={dispatch}
        onExpand={() => dispatch({ type: 'set-expanded', expanded: true })}
      />
      <Dialog
        open={state.expanded}
        onOpenChange={(expanded) => dispatch({ type: 'set-expanded', expanded })}
      >
        <DialogContent className="h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">{t('markdown.diagramExpandedTitle')}</DialogTitle>
          <DiagramViewport
            label={label}
            sanitizedSvg={sanitizedSvg}
            expanded
            viewport={state.viewport}
            dragging={state.dragging}
            dispatch={dispatch}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
