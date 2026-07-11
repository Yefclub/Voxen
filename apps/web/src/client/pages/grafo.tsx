// ============================================================================
// /grafo — visualização do Voxen Brain
// ============================================================================
// Spec: .specs/020-brain-knowledge-harness.md
// Tech: Reagraph (WebGL/R3F) com fallback Sigma/SVG determinístico.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Graph from 'graphology';
import type SigmaRenderer from 'sigma';
import type {
  GraphCanvas as GraphCanvasType,
  GraphCanvasRef,
  GraphEdge as ReagraphEdge,
  GraphNode as ReagraphNode,
  Theme,
} from 'reagraph';
import { ArrowLeft, Box, BrainCircuit, Network, RotateCw, Search, Square } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Spinner } from '../components/ui/spinner';
import { AnimatedPage } from '../components/motion/animated-page';
import { useFetch } from '../lib/hooks';
import { useI18n, type TranslateFn } from '../lib/i18n';
import { cn } from '../lib/utils';

type GraphNodeType =
  | 'transcript'
  | 'note'
  | 'folder'
  | 'entity'
  | 'topic'
  | 'claim'
  | 'event'
  | 'cluster'
  | 'content';

interface GraphNode {
  id: string;
  key: string;
  label: string;
  description: string | null;
  type: GraphNodeType;
  source?: 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK' | 'X' | 'WEB' | 'UPLOAD';
  sourceType: 'TRANSCRIPT' | 'NOTE' | 'FOLDER' | 'JOB' | 'CHAT' | 'MANUAL' | null;
  sourceId: string | null;
  weight: number;
  updatedAt: string;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind:
    | 'belongs_to'
    | 'links_to'
    | 'mentions'
    | 'supports'
    | 'contradicts'
    | 'same_as'
    | 'part_of'
    | 'related_to'
    | 'next_to';
  method: string;
  confidence: string;
}

interface GraphResp {
  nodes: GraphNode[];
  edges: GraphEdge[];
  totalNodes: number;
  totalEdges: number;
}

interface GraphLayoutNode extends GraphNode {
  x: number;
  y: number;
  radius: number;
  labelLines: string[];
}

interface GraphLayoutEdge extends GraphEdge {
  fromNode: GraphLayoutNode;
  toNode: GraphLayoutNode;
}

interface GraphLayout {
  nodes: GraphLayoutNode[];
  edges: GraphLayoutEdge[];
}

interface SigmaNodeAttributes {
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  type: GraphNodeType;
  zIndex: number;
  original: GraphNode;
}

interface SigmaEdgeAttributes {
  size: number;
  color: string;
  kind: GraphEdge['kind'];
  from: string;
  to: string;
  original: GraphEdge;
}

interface SigmaGraphModel {
  graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>;
  layout: GraphLayout;
  neighborhoods: Map<string, Set<string>>;
  reagraphNodes: ReagraphNode[];
  reagraphEdges: ReagraphEdge[];
  nodeById: Map<string, GraphNode>;
}

const GRAPH_VIEWBOX = { width: 1000, height: 620 };
const SOURCE_NODE_TYPES = new Set<GraphNodeType>(['transcript', 'note', 'folder']);

export const NODE_COLORS: Record<GraphNodeType, string> = {
  transcript: '#a78bfa',
  note: '#34d399',
  folder: '#fbbf24',
  entity: '#38bdf8',
  topic: '#fb7185',
  claim: '#f472b6',
  event: '#2dd4bf',
  cluster: '#a3e635',
  content: '#94a3b8',
};

export const EDGE_COLORS: Record<GraphEdge['kind'], string> = {
  belongs_to: 'rgba(251, 191, 36, 0.72)',
  links_to: 'rgba(167, 139, 250, 0.78)',
  mentions: 'rgba(56, 189, 248, 0.72)',
  supports: 'rgba(52, 211, 153, 0.76)',
  contradicts: 'rgba(248, 113, 113, 0.78)',
  same_as: 'rgba(203, 213, 225, 0.7)',
  part_of: 'rgba(45, 212, 191, 0.72)',
  related_to: 'rgba(148, 163, 184, 0.68)',
  next_to: 'rgba(163, 230, 53, 0.7)',
};

// reagraph puxa three.js + react-three-fiber; carregar sob demanda (import
// dinâmico) mantém esse peso fora do bundle principal. Por isso o tema é
// construído a partir do darkTheme só quando o módulo chega.
type GraphCanvasComponent = typeof GraphCanvasType;

function buildVoxenTheme(darkTheme: Theme): Theme {
  return {
    ...darkTheme,
    canvas: {
      background: '#09090b',
      fog: null,
    },
    node: {
      ...darkTheme.node,
      fill: '#71717a',
      activeFill: '#fafafa',
      opacity: 1,
      selectedOpacity: 1,
      inactiveOpacity: 0.22,
      label: {
        color: '#e4e4e7',
        stroke: '#09090b',
        activeColor: '#fafafa',
        backgroundColor: 'rgba(9, 9, 11, 0.72)',
        backgroundOpacity: 0.85,
        padding: 4,
        radius: 4,
      },
    },
    ring: {
      fill: '#52525b',
      activeFill: '#a78bfa',
    },
    edge: {
      ...darkTheme.edge,
      fill: '#3f3f46',
      activeFill: '#a1a1aa',
      opacity: 0.55,
      selectedOpacity: 1,
      inactiveOpacity: 0.08,
      label: {
        color: '#a1a1aa',
        activeColor: '#e4e4e7',
        stroke: '#09090b',
      },
    },
    arrow: {
      fill: '#52525b',
      activeFill: '#d4d4d8',
    },
    lasso: darkTheme.lasso,
  };
}

export function GrafoPage(): React.ReactElement {
  const [forceTick, setForceTick] = useState(0);
  // Grafo 3D por padrão (orbita/gira); toggle para o 2D plano (pan).
  const [is3d, setIs3d] = useState(true);
  const graphPath = forceTick > 0 ? `/api/graph?force=1&t=${forceTick}` : '/api/graph';
  const { data, loading, error } = useFetch<GraphResp>(graphPath);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const navigate = useNavigate();
  const { t } = useI18n();

  const filtered = useMemo(() => {
    if (!data) return null;
    if (!search.trim()) return data;
    const needle = search.trim().toLowerCase();
    const matchedIds = new Set(
      data.nodes.filter((node) => searchableNodeText(node).includes(needle)).map((node) => node.id),
    );
    for (const edge of data.edges) {
      if (matchedIds.has(edge.from)) matchedIds.add(edge.to);
      if (matchedIds.has(edge.to)) matchedIds.add(edge.from);
    }
    return {
      ...data,
      nodes: data.nodes.filter((node) => matchedIds.has(node.id)),
      edges: data.edges.filter((edge) => matchedIds.has(edge.from) && matchedIds.has(edge.to)),
    };
  }, [data, search]);

  const graphModel = useMemo(
    () => (filtered ? buildSigmaGraphModel(filtered, t) : null),
    [filtered, t],
  );

  useEffect(() => {
    if (selectedId && filtered && !filtered.nodes.some((node) => node.id === selectedId)) {
      setSelectedId(null);
    }
  }, [filtered, selectedId]);

  const openNode = useCallback(
    (node: GraphNode) => {
      const path = nodePath(node);
      if (path) navigate(path);
    },
    [navigate],
  );

  const stats = filtered ?? data;
  const hasGraph = Boolean(graphModel && graphModel.layout.nodes.length > 0);

  return (
    <AnimatedPage className="h-full">
      <div className="relative h-full w-full overflow-hidden bg-[var(--color-app-bg-elevated)]">
        <BrainGraphCanvas
          model={graphModel}
          selectedId={selectedId}
          is3d={is3d}
          translate={t}
          onSelect={setSelectedId}
          onOpen={openNode}
        />

        {loading && !data && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Spinner />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-rose-300">
            {error}
          </div>
        )}
        {!loading && data && data.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center px-6">
            <div className="max-w-md space-y-3 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--color-app-border-strong)] bg-[var(--color-app-surface-hover)]">
                <Network className="h-5 w-5 text-violet-400" />
              </div>
              <div className="space-y-1.5">
                <p className="font-display text-lg font-semibold">{t('graph.emptyTitle')}</p>
                <p className="text-sm leading-relaxed text-[var(--color-app-muted)]">
                  {t('graph.emptyDescriptionBefore')} <code className="text-zinc-300">/notas</code>{' '}
                  {t('graph.emptyDescriptionMiddle')} <code className="text-zinc-300">/</code>{' '}
                  {t('graph.emptyDescriptionAfter')}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Barra de controles flutuante sobre o canvas */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-3 sm:p-4">
          <div className="pointer-events-auto mx-auto flex max-w-5xl flex-wrap items-center gap-2.5 rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/80 px-3 py-2.5 shadow-lg backdrop-blur-xl sm:gap-3">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface-hover)] hover:text-zinc-100"
              aria-label={t('shell.backToHome')}
              title={t('shell.backToHome')}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="hidden items-center gap-2 sm:flex">
              <BrainCircuit className="h-4 w-4 text-violet-400" />
              <span className="font-display text-sm font-semibold">{t('graph.title')}</span>
            </div>
            <div className="relative min-w-[150px] flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 z-10 flex h-4 w-4 -translate-y-1/2 items-center justify-center text-zinc-400">
                <Search className="h-4 w-4" />
              </span>
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('graph.searchPlaceholder')}
                className="h-9 w-full rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg)]/60 pl-9 pr-3 text-[13px] text-zinc-100 placeholder:text-[var(--color-app-muted)] transition-colors focus:border-violet-400/60 focus:outline-none focus:ring-2 focus:ring-violet-500/15"
              />
            </div>
            <Button
              variant="outline"
              size="default"
              onClick={() => setIs3d((prev) => !prev)}
              title={t(is3d ? 'graph.switchTo2d' : 'graph.switchTo3d')}
              aria-label={t(is3d ? 'graph.switchTo2d' : 'graph.switchTo3d')}
            >
              {is3d ? <Box className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{is3d ? '3D' : '2D'}</span>
            </Button>
            <Button
              variant="outline"
              size="default"
              onClick={() => setForceTick(Date.now())}
              disabled={loading}
            >
              <RotateCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              <span className="hidden sm:inline">{t('graph.refresh')}</span>
            </Button>
            {stats && stats.nodes.length > 0 && <GraphStats data={stats} translate={t} />}
          </div>
        </div>

        {/* Dica de navegação do canvas */}
        {hasGraph && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 px-4">
            <p className="rounded-full border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/70 px-3 py-1.5 text-center text-[11px] text-[var(--color-app-muted)] backdrop-blur-md">
              {t(is3d ? 'graph.controlsHint3d' : 'graph.controlsHint')}
            </p>
          </div>
        )}
      </div>
    </AnimatedPage>
  );
}

function GraphStats({
  data,
  translate,
}: {
  data: GraphResp;
  translate: TranslateFn;
}): React.ReactElement {
  const concepts = data.nodes.filter(
    (node) => node.type !== 'transcript' && node.type !== 'note' && node.type !== 'folder',
  ).length;
  return (
    <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px] tabular-nums text-[var(--color-app-muted)]">
      <StatDot
        color="bg-violet-400"
        label={`${countType(data, 'transcript')} ${translate('graph.transcripts')}`}
      />
      <StatDot
        color="bg-emerald-400"
        label={`${countType(data, 'note')} ${translate('graph.notes')}`}
      />
      <StatDot
        color="bg-amber-400"
        label={`${countType(data, 'folder')} ${translate('graph.folders')}`}
        square
      />
      <StatDot color="bg-sky-400" label={`${concepts} ${translate('graph.concepts')}`} />
      <span className="text-[var(--color-app-muted)]/70">
        {translate('graph.connections', { count: data.edges.length })}
      </span>
    </div>
  );
}

function StatDot({
  color,
  label,
  square = false,
}: {
  color: string;
  label: string;
  square?: boolean;
}): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('h-2 w-2', square ? 'rounded-sm' : 'rounded-full', color)} />
      {label}
    </span>
  );
}

function BrainGraphCanvas({
  model,
  selectedId,
  is3d,
  translate,
  onSelect,
  onOpen,
}: {
  model: SigmaGraphModel | null;
  selectedId: string | null;
  is3d: boolean;
  translate: TranslateFn;
  onSelect: (id: string | null) => void;
  onOpen: (node: GraphNode) => void;
}): React.ReactElement {
  const graphRef = useRef<GraphCanvasRef | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const [reagraph, setReagraph] = useState<{
    GraphCanvas: GraphCanvasComponent;
    theme: Theme;
  } | null>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    setWebglFailed(false);
    setReagraph(null);
    fittedRef.current = false;
    if (!model || model.layout.nodes.length === 0) return;
    if (!supportsWebGL()) {
      setWebglFailed(true);
      return;
    }
    let cancelled = false;
    void import('reagraph')
      .then((mod) => {
        if (!cancelled) {
          setReagraph({ GraphCanvas: mod.GraphCanvas, theme: buildVoxenTheme(mod.darkTheme) });
        }
      })
      .catch(() => {
        if (!cancelled) setWebglFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [model]);

  const activeId = hoveredId ?? selectedId;
  const actives = useMemo(() => {
    if (!activeId || !model) return undefined;
    const neighbors = model.neighborhoods.get(activeId);
    if (!neighbors) return [activeId];
    return [activeId, ...neighbors];
  }, [activeId, model]);

  useEffect(() => {
    if (!model || !selectedId || !graphRef.current) return;
    try {
      graphRef.current.centerGraph([selectedId]);
    } catch {
      /* camera ainda não pronta */
    }
  }, [model, selectedId]);

  // Trocar 2D/3D re-layouta o grafo — re-enquadra a câmera no novo layout.
  useEffect(() => {
    fittedRef.current = false;
  }, [is3d]);

  useEffect(() => {
    if (!model || !reagraph || fittedRef.current) return;
    const timer = window.setTimeout(() => {
      try {
        graphRef.current?.fitNodesInView(undefined, { animated: true });
        fittedRef.current = true;
      } catch {
        /* ignore */
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [model, reagraph, is3d]);

  if (!model || model.layout.nodes.length === 0) {
    return <div className="absolute inset-0" />;
  }

  if (webglFailed) {
    return (
      <BrainGraph2DCanvas
        model={model}
        selectedId={selectedId}
        translate={translate}
        onSelect={onSelect}
        onOpen={onOpen}
      />
    );
  }

  const GraphCanvas = reagraph?.GraphCanvas;

  return (
    <div className="absolute inset-0 overflow-hidden bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:48px_48px]">
      {!GraphCanvas && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <Spinner />
        </div>
      )}
      {GraphCanvas && reagraph && (
        <GraphCanvas
          ref={graphRef}
          nodes={model.reagraphNodes}
          edges={model.reagraphEdges}
          theme={reagraph.theme}
          layoutType={is3d ? 'forceDirected3d' : 'forceDirected2d'}
          labelType="auto"
          edgeInterpolation="curved"
          cameraMode={is3d ? 'rotate' : 'pan'}
          animated
          draggable
          selections={selectedId ? [selectedId] : []}
          actives={actives}
          onNodeClick={(node) => {
            onSelect(node.id);
          }}
          onNodeDoubleClick={(node) => {
            const original = model.nodeById.get(node.id);
            if (original) onOpen(original);
          }}
          onNodePointerOver={(node) => setHoveredId(node.id)}
          onNodePointerOut={() => setHoveredId(null)}
          onCanvasClick={() => onSelect(null)}
        />
      )}
    </div>
  );
}

function BrainGraph2DCanvas({
  model,
  selectedId,
  translate,
  onSelect,
  onOpen,
}: {
  model: SigmaGraphModel | null;
  selectedId: string | null;
  translate: TranslateFn;
  onSelect: (id: string | null) => void;
  onOpen: (node: GraphNode) => void;
}): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<SigmaRenderer<SigmaNodeAttributes, SigmaEdgeAttributes> | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const [rendererVersion, setRendererVersion] = useState(0);

  useEffect(() => {
    setWebglFailed(false);
  }, [model]);

  useEffect(() => {
    if (!model || model.layout.nodes.length === 0 || !containerRef.current) return;
    setWebglFailed(false);
    let cancelled = false;
    let renderer: SigmaRenderer<SigmaNodeAttributes, SigmaEdgeAttributes> | null = null;
    let resizeObserver: ResizeObserver | null = null;

    void import('sigma')
      .then(({ default: Sigma }) => {
        if (cancelled || !containerRef.current) return;
        try {
          renderer = new Sigma(model.graph, containerRef.current, {
            allowInvalidContainer: true,
            defaultNodeColor: '#94a3b8',
            defaultEdgeColor: 'rgba(148, 163, 184, 0.42)',
            enableEdgeEvents: true,
            hideEdgesOnMove: true,
            hideLabelsOnMove: false,
            itemSizesReference: 'screen',
            labelColor: { color: '#f4f4f5' },
            labelDensity: 0.16,
            labelFont: 'Inter, system-ui, sans-serif',
            labelRenderedSizeThreshold: 8,
            labelSize: 12,
            maxCameraRatio: 2.8,
            minCameraRatio: 0.12,
            renderEdgeLabels: false,
            zIndex: true,
          });
          rendererRef.current = renderer;
          renderer.on('clickNode', ({ node }) => onSelect(node));
          renderer.on('doubleClickNode', ({ node, event }) => {
            event.preventSigmaDefault();
            if (model.graph.hasNode(node)) onOpen(model.graph.getNodeAttributes(node).original);
          });
          renderer.on('clickStage', () => onSelect(null));
          renderer.on('enterNode', ({ node }) => setHoveredId(node));
          renderer.on('leaveNode', () => setHoveredId(null));
          if ('ResizeObserver' in window) {
            resizeObserver = new ResizeObserver(() => renderer?.resize());
            resizeObserver.observe(containerRef.current);
          }
          renderer.refresh();
          setRendererVersion((version) => version + 1);
        } catch {
          setWebglFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setWebglFailed(true);
      });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      renderer?.kill();
      rendererRef.current = null;
    };
  }, [model, onSelect, onOpen]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !model) return;
    const activeId = hoveredId ?? selectedId;
    const activeNeighbors = activeId ? (model.neighborhoods.get(activeId) ?? new Set()) : null;
    renderer.setSetting('nodeReducer', (node, data) => {
      if (!activeId || !activeNeighbors) return data;
      const isActive = node === activeId;
      const isNeighbor = activeNeighbors.has(node);
      if (!isActive && !isNeighbor) {
        return {
          ...data,
          color: 'rgba(82, 82, 91, 0.42)',
          label: '',
          size: Math.max(3, data.size * 0.72),
          zIndex: 0,
        };
      }
      return {
        ...data,
        color: isActive ? '#fafafa' : data.color,
        size: data.size * (isActive ? 1.45 : 1.12),
        zIndex: isActive ? 4 : 3,
      };
    });
    renderer.setSetting('edgeReducer', (_edge, data) => {
      if (!activeId) return data;
      const connected = data.from === activeId || data.to === activeId;
      return {
        ...data,
        color: connected ? data.color : 'rgba(82, 82, 91, 0.16)',
        size: connected ? data.size * 1.35 : Math.max(0.35, data.size * 0.5),
      };
    });
    renderer.refresh();
  }, [hoveredId, model, rendererVersion, selectedId]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !model || !selectedId || !model.graph.hasNode(selectedId)) return;
    const attrs = model.graph.getNodeAttributes(selectedId);
    void renderer.getCamera().animate({ x: attrs.x, y: attrs.y, ratio: 0.62 }, { duration: 260 });
  }, [model, rendererVersion, selectedId]);

  if (!model || model.layout.nodes.length === 0) {
    return <div className="absolute inset-0" />;
  }

  if (webglFailed) {
    return (
      <BrainGraphSvg
        layout={model.layout}
        selectedId={selectedId}
        translate={translate}
        onSelect={onSelect}
        onOpen={onOpen}
      />
    );
  }

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div ref={containerRef} aria-label={translate('graph.title')} className="h-full w-full" />
    </div>
  );
}

function BrainGraphSvg({
  layout,
  selectedId,
  translate,
  onSelect,
  onOpen,
}: {
  layout: GraphLayout;
  selectedId: string | null;
  translate: TranslateFn;
  onSelect: (id: string | null) => void;
  onOpen: (node: GraphNode) => void;
}): React.ReactElement {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <svg
        role="img"
        aria-label={translate('graph.title')}
        className="h-full w-full"
        viewBox={`0 0 ${GRAPH_VIEWBOX.width} ${GRAPH_VIEWBOX.height}`}
        preserveAspectRatio="xMidYMid meet"
        onClick={() => onSelect(null)}
      >
        <rect width={GRAPH_VIEWBOX.width} height={GRAPH_VIEWBOX.height} fill="transparent" />
        <g opacity="0.75">
          {layout.edges.map((edge) => (
            <path
              key={edge.id}
              d={edgePath(edge)}
              fill="none"
              stroke={EDGE_COLORS[edge.kind]}
              strokeLinecap="round"
              strokeWidth={edge.kind === 'links_to' ? 2.4 : 1.6}
              strokeDasharray={edge.kind === 'belongs_to' ? '6 8' : undefined}
            />
          ))}
        </g>
        <g>
          {layout.nodes.map((node) => (
            <BrainGraphNode
              key={node.id}
              node={node}
              selected={node.id === selectedId}
              onSelect={onSelect}
              onOpen={onOpen}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

function BrainGraphNode({
  node,
  selected,
  onSelect,
  onOpen,
}: {
  node: GraphLayoutNode;
  selected: boolean;
  onSelect: (id: string) => void;
  onOpen: (node: GraphNode) => void;
}): React.ReactElement {
  const color = NODE_COLORS[node.type];
  const stroke = selected ? '#fafafa' : '#18181b';
  const strokeWidth = selected ? 4 : 1.5;
  const labelY = node.radius + 15;

  return (
    <g
      className="cursor-pointer outline-none"
      role="button"
      tabIndex={0}
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
          onOpen(node);
          return;
        }
        if (event.key !== ' ') return;
        event.preventDefault();
        onSelect(node.id);
      }}
    >
      <title>{node.label}</title>
      {nodeShapeElement(node, color, stroke, strokeWidth)}
      <text
        y={labelY}
        textAnchor="middle"
        className="select-none fill-zinc-100 font-sans text-[11px] font-medium"
        paintOrder="stroke"
        stroke="#18181b"
        strokeWidth="3"
        strokeLinejoin="round"
      >
        {node.labelLines.map((line, index) => (
          <tspan key={`${line}-${index}`} x="0" dy={index === 0 ? 0 : 13}>
            {line}
          </tspan>
        ))}
      </text>
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
  if (node.type === 'cluster') {
    return (
      <polygon
        points={hexagonPoints(node.radius)}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    );
  }
  return <circle r={node.radius} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
}

function searchableNodeText(node: GraphNode): string {
  return [node.label, node.description, node.key, node.type, node.source, node.sourceType]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function countType(data: GraphResp, type: GraphNodeType): number {
  return data.nodes.filter((node) => node.type === type).length;
}

export function buildSigmaGraphModel(data: GraphResp, translate?: TranslateFn): SigmaGraphModel {
  const layout = buildGraphLayout(data);
  const graph = new Graph<SigmaNodeAttributes, SigmaEdgeAttributes>({
    multi: true,
    type: 'undirected',
  });
  const neighborhoods = new Map<string, Set<string>>();
  const nodeById = new Map(layout.nodes.map((node) => [node.id, node as GraphNode]));
  const reagraphNodes: ReagraphNode[] = layout.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    subLabel: translate ? translate(`graph.node.${node.type}`) : node.type,
    fill: NODE_COLORS[node.type],
    size: Math.max(4, Math.min(14, 5 + node.weight * (SOURCE_NODE_TYPES.has(node.type) ? 1.4 : 1))),
    data: node,
  }));
  const reagraphEdges: ReagraphEdge[] = layout.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    label: translate ? translate(`graph.edge.${edge.kind}`) : edge.kind,
    size: edge.kind === 'links_to' ? 2.2 : edge.kind === 'related_to' ? 1.6 : 1.1,
    fill: EDGE_COLORS[edge.kind],
    data: edge,
  }));

  for (const node of layout.nodes) {
    neighborhoods.set(node.id, new Set([node.id]));
    graph.addNode(node.id, {
      x: (node.x - GRAPH_VIEWBOX.width / 2) / 150,
      y: (node.y - GRAPH_VIEWBOX.height / 2) / 150,
      size: Math.max(4, node.radius / 2.4),
      color: NODE_COLORS[node.type],
      label: node.label,
      type: node.type,
      zIndex: SOURCE_NODE_TYPES.has(node.type) ? 2 : 1,
      original: node,
    });
  }

  for (const edge of layout.edges) {
    if (!graph.hasNode(edge.from) || !graph.hasNode(edge.to)) continue;
    neighborhoods.get(edge.from)?.add(edge.to);
    neighborhoods.get(edge.to)?.add(edge.from);
    graph.addUndirectedEdgeWithKey(edge.id, edge.from, edge.to, {
      size: edge.kind === 'links_to' ? 1.9 : 1.15,
      color: EDGE_COLORS[edge.kind],
      kind: edge.kind,
      from: edge.from,
      to: edge.to,
      original: edge,
    });
  }

  return { graph, layout, neighborhoods, reagraphNodes, reagraphEdges, nodeById };
}

export function nodePath(node: GraphNode): string | null {
  if (!node.sourceId) return null;
  if (node.sourceType === 'TRANSCRIPT') return `/transcricoes/${node.sourceId}`;
  if (node.sourceType === 'NOTE') return `/notas/${node.sourceId}`;
  return null;
}

export function buildGraphLayout(data: GraphResp): GraphLayout {
  const width = GRAPH_VIEWBOX.width;
  const height = GRAPH_VIEWBOX.height;
  const center = { x: width / 2, y: height / 2 };
  const degree = new Map<string, number>();
  for (const edge of data.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }

  const orderedNodes = [...data.nodes].sort(compareGraphNodes);
  const sourceNodes = orderedNodes.filter((node) => SOURCE_NODE_TYPES.has(node.type));
  const sourceAngles = new Map<string, number>();
  const positions = new Map<string, { x: number; y: number }>();

  if (sourceNodes.length > 0) {
    const sourceRadius = sourceNodes.length === 1 ? 0 : 132 + Math.min(sourceNodes.length, 8) * 6;
    sourceNodes.forEach((node, index) => {
      const angle = angleForIndex(index, sourceNodes.length, -Math.PI / 2);
      sourceAngles.set(node.id, angle);
      positions.set(node.id, polarPoint(center, sourceRadius, angle));
    });
  }

  const fallbackNodes = sourceNodes.length > 0 ? [] : orderedNodes;
  fallbackNodes.forEach((node, index) => {
    const radius = orderedNodes.length < 3 ? 95 : 205;
    positions.set(node.id, polarPoint(center, radius, angleForIndex(index, orderedNodes.length)));
  });

  const conceptNodes = orderedNodes.filter((node) => !positions.has(node.id));
  conceptNodes.forEach((node, index) => {
    const neighborAngles = data.edges
      .filter((edge) => edge.from === node.id || edge.to === node.id)
      .map((edge) => (edge.from === node.id ? edge.to : edge.from))
      .map((id) => sourceAngles.get(id))
      .filter((angle): angle is number => typeof angle === 'number');
    const angle =
      averageAngle(neighborAngles) ??
      angleForIndex(index, Math.max(conceptNodes.length, 1), Math.PI / 10);
    const ring = 218 + (index % 4) * 34;
    positions.set(node.id, polarPoint(center, ring, angle + ((index % 3) - 1) * 0.11));
  });

  const layoutNodes = orderedNodes.map<GraphLayoutNode>((node) => {
    const point = positions.get(node.id) ?? center;
    const radius = clamp(11 + Math.min(degree.get(node.id) ?? 0, 8) * 2.3, 13, 32);
    const sourceBoost = SOURCE_NODE_TYPES.has(node.type) ? 3 : 0;
    return {
      ...node,
      ...clampPoint(point, 58, width - 58, 56, height - 74),
      radius: radius + sourceBoost,
      labelLines: splitGraphLabel(node.label),
    };
  });
  const byId = new Map(layoutNodes.map((node) => [node.id, node]));
  const layoutEdges = data.edges
    .map<GraphLayoutEdge | null>((edge) => {
      const fromNode = byId.get(edge.from);
      const toNode = byId.get(edge.to);
      if (!fromNode || !toNode) return null;
      return { ...edge, fromNode, toNode };
    })
    .filter((edge): edge is GraphLayoutEdge => edge !== null);

  return { nodes: layoutNodes, edges: layoutEdges };
}

function compareGraphNodes(a: GraphNode, b: GraphNode): number {
  const priority: Record<GraphNodeType, number> = {
    transcript: 0,
    folder: 1,
    note: 2,
    topic: 3,
    entity: 4,
    claim: 5,
    event: 6,
    cluster: 7,
    content: 8,
  };
  return (
    priority[a.type] - priority[b.type] || b.weight - a.weight || a.label.localeCompare(b.label)
  );
}

function angleForIndex(index: number, total: number, offset = 0): number {
  if (total <= 1) return offset;
  return offset + (index / total) * Math.PI * 2;
}

function polarPoint(
  center: { x: number; y: number },
  radius: number,
  angle: number,
): { x: number; y: number } {
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  };
}

function averageAngle(angles: number[]): number | null {
  if (angles.length === 0) return null;
  const vector = angles.reduce(
    (acc, angle) => ({
      x: acc.x + Math.cos(angle),
      y: acc.y + Math.sin(angle),
    }),
    { x: 0, y: 0 },
  );
  return Math.atan2(vector.y / angles.length, vector.x / angles.length);
}

function clampPoint(
  point: { x: number; y: number },
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): { x: number; y: number } {
  return {
    x: clamp(point.x, minX, maxX),
    y: clamp(point.y, minY, maxY),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function splitGraphLabel(label: string): string[] {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || current.length + word.length + 1 > 20) {
      lines.push(word.slice(0, 22));
    } else {
      lines[lines.length - 1] = `${current} ${word}`;
    }
    if (lines.length === 2) break;
  }
  if (lines.length === 0) return ['Sem titulo'];
  if (words.join(' ').length > lines.join(' ').length) {
    lines[lines.length - 1] = `${lines.at(-1)?.replace(/\.*$/, '')}...`;
  }
  return lines;
}

function edgePath(edge: GraphLayoutEdge): string {
  const { fromNode, toNode } = edge;
  const midX = (fromNode.x + toNode.x) / 2;
  const midY = (fromNode.y + toNode.y) / 2;
  const dx = toNode.x - fromNode.x;
  const dy = toNode.y - fromNode.y;
  const length = Math.hypot(dx, dy) || 1;
  const curve = ((hashString(edge.id) % 7) - 3) * 5;
  const cx = midX + (-dy / length) * curve;
  const cy = midY + (dx / length) * curve;
  return `M ${fromNode.x.toFixed(1)} ${fromNode.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${toNode.x.toFixed(1)} ${toNode.y.toFixed(1)}`;
}

function supportsWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function hexagonPoints(radius: number): string {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI / 6 + index * (Math.PI / 3);
    return `${(Math.cos(angle) * radius).toFixed(1)},${(Math.sin(angle) * radius).toFixed(1)}`;
  }).join(' ');
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
