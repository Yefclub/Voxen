import { Focus, Maximize2, Network, ZoomIn, ZoomOut } from '@/components/ui/icons';
import type { TranslateFn } from '../../lib/i18n';

export function GraphCanvasButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-md text-[var(--color-app-subtle)] transition-colors hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-focus)]"
    >
      {children}
    </button>
  );
}

export function GraphViewportControls({
  zoom,
  translate,
  onZoomIn,
  onZoomOut,
  onFit,
  onFocus,
  onFocusCore,
}: {
  zoom?: number;
  translate: TranslateFn;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onFocus?: () => void;
  onFocusCore?: () => void;
}): React.ReactElement {
  return (
    <div
      data-graph-controls
      role="group"
      aria-label={translate('graph.viewportControls')}
      className="absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] p-0.5"
    >
      <GraphCanvasButton label={translate('graph.zoomIn')} onClick={onZoomIn}>
        <ZoomIn className="h-3.5 w-3.5" />
      </GraphCanvasButton>
      <GraphCanvasButton label={translate('graph.zoomOut')} onClick={onZoomOut}>
        <ZoomOut className="h-3.5 w-3.5" />
      </GraphCanvasButton>
      {zoom !== undefined && (
        <output
          aria-label={translate('graph.zoomLevel')}
          className="min-w-10 px-1 text-center text-[11px] tabular-nums text-[var(--color-app-muted)]"
        >
          {zoom}%
        </output>
      )}
      <GraphCanvasButton label={translate('graph.fitView')} onClick={onFit}>
        <Maximize2 className="h-3.5 w-3.5" />
      </GraphCanvasButton>
      {onFocus && (
        <GraphCanvasButton label={translate('graph.focusSelection')} onClick={onFocus}>
          <Focus className="h-3.5 w-3.5" />
        </GraphCanvasButton>
      )}
      {onFocusCore && (
        <GraphCanvasButton label={translate('graph.focusCore')} onClick={onFocusCore}>
          <Network className="h-3.5 w-3.5" />
        </GraphCanvasButton>
      )}
    </div>
  );
}
