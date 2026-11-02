import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  buildGraphLayout,
  edgePath,
  resolveGraphViewBox,
  resolveNodeRadiusBounds,
  type GraphLayoutNode,
  type GraphNode,
  type GraphPalette,
  type SigmaGraphModel,
} from '../../lib/graph-model';
import type { TranslateFn } from '../../lib/i18n';
import { useIsCoarsePointer } from '../../lib/use-media-query';
import { GraphViewportControls } from './graph-canvas-controls';

export function BrainGraphSvg({
  model,
  selectedId,
  palette,
  translate,
  onSelect,
  onOpen,
}: {
  model: SigmaGraphModel;
  selectedId: string | null;
  palette: GraphPalette;
  translate: TranslateFn;
  onSelect: (id: string | null) => void;
  onOpen: (node: GraphNode) => void;
}): React.ReactElement {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const drag = useRef<{ x: number; y: number; cameraX: number; cameraY: number } | null>(null);
  const dragged = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const coarsePointer = useIsCoarsePointer();
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setContainerSize({ width: rect.width, height: rect.height });
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const viewBox = useMemo(
    () => resolveGraphViewBox(containerSize?.width ?? 0, containerSize?.height ?? 0),
    [containerSize],
  );
  const radiusBounds = useMemo(() => resolveNodeRadiusBounds(coarsePointer), [coarsePointer]);
  const layout = useMemo(
    () =>
      buildGraphLayout(model.data, {
        viewBox,
        minNodeRadius: radiusBounds.min,
        maxNodeRadius: radiusBounds.max,
      }),
    [model, radiusBounds, viewBox],
  );
  const previousViewBox = useRef(viewBox);
  useLayoutEffect(() => {
    const previous = previousViewBox.current;
    if (previous.width !== viewBox.width || previous.height !== viewBox.height) {
      setCamera((current) => ({
        ...current,
        x: (current.x * viewBox.width) / previous.width,
        y: (current.y * viewBox.height) / previous.height,
      }));
      previousViewBox.current = viewBox;
    }
  }, [viewBox]);
  useEffect(() => {
    setCamera({ x: 0, y: 0, zoom: 1 });
  }, [model.topologyKey]);
  const activeId = hoveredId ?? selectedId;
  const activeIds = activeId ? (model.neighborhoods.get(activeId) ?? new Set([activeId])) : null;
  const captionNode = activeId ? model.nodeById.get(activeId) : null;
  const zoomView = (factor: number): void =>
    setCamera((current) => {
      const zoom = Math.min(5, Math.max(0.4, current.zoom * factor));
      return {
        zoom,
        x: current.x + viewBox.width / (2 * current.zoom) - viewBox.width / (2 * zoom),
        y: current.y + viewBox.height / (2 * current.zoom) - viewBox.height / (2 * zoom),
      };
    });
  const focusSelection = (): void => {
    const node = layout.nodes.find((item) => item.id === selectedId);
    if (node)
      setCamera((current) => ({
        ...current,
        x: node.x - viewBox.width / (2 * current.zoom),
        y: node.y - viewBox.height / (2 * current.zoom),
      }));
  };
  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden">
      <svg
        role="group"
        aria-label={translate('graph.title')}
        className="h-full w-full touch-none"
        viewBox={`${camera.x} ${camera.y} ${viewBox.width / camera.zoom} ${viewBox.height / camera.zoom}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={(event) => {
          if (event.button !== 0 || (event.target as Element).closest('[role="button"]')) return;
          dragged.current = false;
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            cameraX: camera.x,
            cameraY: camera.y,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current || !containerSize) return;
          const dx = event.clientX - drag.current.x,
            dy = event.clientY - drag.current.y;
          if (Math.abs(dx) + Math.abs(dy) > 4) dragged.current = true;
          setCamera({
            ...camera,
            x: drag.current.cameraX - (dx * viewBox.width) / containerSize.width / camera.zoom,
            y: drag.current.cameraY - (dy * viewBox.height) / containerSize.height / camera.zoom,
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onClick={() => {
          if (!dragged.current) onSelect(null);
        }}
      >
        <rect width={viewBox.width} height={viewBox.height} fill="transparent" />
        <g>
          {layout.edges.map((edge) => {
            const connected = !activeId || edge.from === activeId || edge.to === activeId;
            return (
              <path
                key={edge.id}
                d={edgePath(edge)}
                fill="none"
                stroke={
                  connected && (activeId || layout.nodes.length <= 140)
                    ? palette.edges[edge.kind]
                    : palette.dimEdge
                }
                strokeLinecap="round"
                strokeWidth={connected ? (edge.kind === 'links_to' ? 2.2 : 1.4) : 0.5}
                opacity={connected ? 0.72 : 0.12}
              />
            );
          })}
        </g>
        <g>
          {layout.nodes.map((node) => (
            <BrainGraphNode
              key={node.id}
              node={node}
              selected={node.id === selectedId}
              onHover={setHoveredId}
              dimmed={Boolean(activeIds && !activeIds.has(node.id))}
              palette={palette}
              onSelect={onSelect}
              onOpen={onOpen}
            />
          ))}
        </g>
      </svg>
      {captionNode && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 max-w-sm rounded-lg bg-[var(--color-app-bg-elevated)] px-3 py-2 text-xs leading-relaxed text-[var(--color-app-fg)] shadow-md">
          <span className="line-clamp-2 break-words">{captionNode.label}</span>
        </div>
      )}
      <GraphViewportControls
        zoom={Math.round(camera.zoom * 100)}
        translate={translate}
        onZoomIn={() => zoomView(1.25)}
        onZoomOut={() => zoomView(0.8)}
        onFit={() => setCamera({ x: 0, y: 0, zoom: 1 })}
        onFocus={selectedId ? focusSelection : undefined}
      />
    </div>
  );
}

function BrainGraphNode({
  node,
  selected,
  dimmed,
  palette,
  onSelect,
  onHover,
  onOpen,
}: {
  node: GraphLayoutNode;
  selected: boolean;
  dimmed: boolean;
  palette: GraphPalette;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onOpen: (node: GraphNode) => void;
}): React.ReactElement {
  return (
    <g
      className="group cursor-pointer outline-none"
      role="button"
      aria-label={node.label}
      aria-pressed={selected}
      onPointerEnter={() => onHover(node.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(node.id)}
      onBlur={() => onHover(null)}
      tabIndex={0}
      opacity={dimmed ? 0.2 : 1}
      transform={`translate(${node.x} ${node.y})`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(node.id);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onOpen(node);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onSelect(node.id);
        } else if (event.key === ' ') {
          event.preventDefault();
          onSelect(node.id);
        }
      }}
    >
      <title>{node.label}</title>
      {nodeShapeElement(
        node,
        palette.nodes[node.type],
        selected ? palette.selected : palette.canvas,
        selected ? 4 : 1.5,
      )}
    </g>
  );
}

function nodeShapeElement(
  node: GraphLayoutNode,
  fill: string,
  stroke: string,
  strokeWidth: number,
): React.ReactElement {
  if (node.type === 'folder') {
    const width = node.radius * 2.25;
    const height = node.radius * 1.55;
    return (
      <rect
        className="group-focus-visible:stroke-[var(--color-accent-primary)] group-focus-visible:[stroke-width:4]"
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        rx="8"
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    );
  }
  if (node.type === 'cluster')
    return (
      <polygon
        className="group-focus-visible:stroke-[var(--color-accent-primary)] group-focus-visible:[stroke-width:4]"
        points={hexagonPoints(node.radius)}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    );
  return (
    <circle
      className="group-focus-visible:stroke-[var(--color-accent-primary)] group-focus-visible:[stroke-width:4]"
      r={node.radius}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
    />
  );
}

function hexagonPoints(radius: number): string {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI / 6 + index * (Math.PI / 3);
    return `${(Math.cos(angle) * radius).toFixed(1)},${(Math.sin(angle) * radius).toFixed(1)}`;
  }).join(' ');
}
