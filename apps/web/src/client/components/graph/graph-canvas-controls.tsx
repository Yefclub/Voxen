import { Focus, Maximize2, ZoomIn, ZoomOut } from '@/components/ui/icons';
import { IconButton } from '../ui/icon-button';
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
    <IconButton label={label} onClick={onClick} className="h-8 w-8 rounded-lg">
      {children}
    </IconButton>
  );
}

export function GraphViewportControls({
  zoom,
  translate,
  onZoomIn,
  onZoomOut,
  onFit,
  onFocus,
}: {
  zoom: number;
  translate: TranslateFn;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onFocus?: () => void;
}): React.ReactElement {
  return (
    <div
      data-graph-controls
      className="absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-lg bg-[var(--color-app-bg-elevated)] p-1 shadow-md"
    >
      <GraphCanvasButton label={translate('graph.zoomIn')} onClick={onZoomIn}>
        <ZoomIn className="h-3.5 w-3.5" />
      </GraphCanvasButton>
      <GraphCanvasButton label={translate('graph.zoomOut')} onClick={onZoomOut}>
        <ZoomOut className="h-3.5 w-3.5" />
      </GraphCanvasButton>
      <output
        aria-label={translate('graph.zoomLevel')}
        className="min-w-10 px-1 text-center text-[11px] tabular-nums text-[var(--color-app-muted)]"
      >
        {zoom}%
      </output>
      <GraphCanvasButton label={translate('graph.fitView')} onClick={onFit}>
        <Maximize2 className="h-3.5 w-3.5" />
      </GraphCanvasButton>
      {onFocus && (
        <GraphCanvasButton label={translate('graph.focusSelection')} onClick={onFocus}>
          <Focus className="h-3.5 w-3.5" />
        </GraphCanvasButton>
      )}
    </div>
  );
}
