// ============================================================================
// /grafo — visualização do Voxen Brain
// ============================================================================
// Spec: .specs/020-brain-knowledge-harness.md
// Tech: Reagraph (WebGL/R3F) com fallback Sigma/SVG determinístico.
// ============================================================================

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import {
  ArrowLeft,
  Box,
  BrainCircuit,
  Info,
  Network,
  RotateCw,
  Search,
  Square,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { FetchError } from '../components/ui/fetch-error';
import { Spinner } from '../components/ui/spinner';
import { AnimatedPage } from '../components/motion/animated-page';
import { useFetch } from '../lib/hooks';
import { useI18n, type TranslateFn } from '../lib/i18n';
import { useIsCoarsePointer, useIsDesktop } from '../lib/use-media-query';
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
  viewBox: { width: number; height: number };
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
  data: GraphResp;
  graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>;
  layout: GraphLayout;
  neighborhoods: Map<string, Set<string>>;
  reagraphNodes: ReagraphNode[];
  reagraphEdges: ReagraphEdge[];
  nodeById: Map<string, GraphNode>;
}

export interface GraphLayoutOptions {
  viewBox?: { width: number; height: number };
  minNodeRadius?: number;
  maxNodeRadius?: number;
}

const GRAPH_VIEWBOX = { width: 1000, height: 620 };
const SOURCE_NODE_TYPES = new Set<GraphNodeType>(['transcript', 'note', 'folder']);

// Clamps de proporção (largura/altura) pro viewBox responsivo do fallback SVG
// (ver `resolveGraphViewBox`) — cobrem folgadamente qualquer celular/tablet/
// desktop real (retrato mais estreito comum ~0.43, ultrawide comum ~2.1) e só
// entram em ação em containers com proporção patológica (ex.: sliver de
// devtools), evitando layouts esticados demais.
const MIN_VIEWBOX_ASPECT_RATIO = 0.4;
const MAX_VIEWBOX_ASPECT_RATIO = 2.5;

const DEFAULT_MIN_NODE_RADIUS = 13;
const DEFAULT_MAX_NODE_RADIUS = 32;
// Alvo de toque maior em telas coarse (touch): o raio mínimo de 13 (espaço
// SVG) já rende pequeno em CSS px numa tela de celular; 17 dá ~30% a mais
// sem mexer no resto do layout (só o piso sobe — nós já grandes por grau de
// conexão não são afetados). Mudança pequena e localizada, como pedido.
const TOUCH_MIN_NODE_RADIUS = 17;

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
  const isDesktop = useIsDesktop();
  const coarsePointer = useIsCoarsePointer();
  // Grafo 3D por padrão no desktop (orbita/gira); no mobile abre em 2D (pan)
  // — arrastar pra girar é um gesto ruim em touchscreen. O toggle continua
  // disponível nos dois casos, isto só decide o valor inicial.
  const [is3d, setIs3d] = useState(() => resolveDefaultIs3d(isDesktop));
  const graphPath = forceTick > 0 ? `/api/graph?force=1&t=${forceTick}` : '/api/graph';
  const { data, loading, error } = useFetch<GraphResp>(graphPath);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const statsPanelId = useId();
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

  const nodeRadiusBounds = useMemo(() => resolveNodeRadiusBounds(coarsePointer), [coarsePointer]);
  const graphModel = useMemo(
    () =>
      filtered
        ? buildSigmaGraphModel(filtered, t, {
            minNodeRadius: nodeRadiusBounds.min,
            maxNodeRadius: nodeRadiusBounds.max,
          })
        : null,
    [filtered, t, nodeRadiusBounds],
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
  const statsData = stats && stats.nodes.length > 0 ? stats : null;
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
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <FetchError message={error} onRetry={() => setForceTick(Date.now())} />
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
                  {t('graph.emptyDescriptionBefore')}{' '}
                  <code className="text-[var(--color-app-subtle)]">/notas</code>{' '}
                  {t('graph.emptyDescriptionMiddle')}{' '}
                  <code className="text-[var(--color-app-subtle)]">/</code>{' '}
                  {t('graph.emptyDescriptionAfter')}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Barra de controles flutuante sobre o canvas. O Topbar global (fixed,
            top-4 right-4, z-30) ocupa a mesma faixa de altura agora — no
            mobile empurramos esta barra pra baixo dele (empilha vertical,
            já que não cabe lado a lado); no desktop reservamos um
            padding-right (md:pr-[9rem]) maior que a largura real do Topbar
            em /grafo (~106px de conteúdo + 16px de right-4, com folga) pra
            a pill (mx-auto max-w-5xl) nunca se estender até lá. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-3 pb-3 pt-[calc(env(safe-area-inset-top)+5rem)] sm:px-4 sm:pb-4 md:pt-4 md:pr-[9rem]">
          <div className="pointer-events-auto mx-auto flex max-w-5xl flex-col gap-2">
            {/* Fileira primária: sempre as mesmas 4 ações (voltar, busca, 2D/3D,
                atualizar) + o toggle de estatísticas no mobile. GraphStats
                completo (4-6 itens) só entra direto na fileira a partir de
                `md` — no mobile ele lotava uma barra já estreita e quebrava
                em várias linhas (fica atrás do botão de info, 2ª fileira). */}
            <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/80 px-3 py-2.5 shadow-lg backdrop-blur-xl sm:gap-3">
              <button
                type="button"
                onClick={() => navigate('/')}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)]"
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
                <span className="pointer-events-none absolute left-3 top-1/2 z-10 flex h-4 w-4 -translate-y-1/2 items-center justify-center text-[var(--color-app-muted)]">
                  <Search className="h-4 w-4" />
                </span>
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('graph.searchPlaceholder')}
                  className="h-9 w-full rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg)]/60 pl-9 pr-3 text-[13px] text-[var(--color-app-fg)] placeholder:text-[var(--color-app-muted)] transition-colors focus:border-violet-400/60 focus:outline-none focus:ring-2 focus:ring-violet-500/15"
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
              {statsData && (
                <GraphStats data={statsData} translate={t} className="ml-auto hidden md:flex" />
              )}
              {statsData && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setStatsOpen((prev) => !prev)}
                  aria-expanded={statsOpen}
                  aria-controls={statsPanelId}
                  aria-label={t(statsOpen ? 'graph.hideStats' : 'graph.showStats')}
                  title={t(statsOpen ? 'graph.hideStats' : 'graph.showStats')}
                  className="ml-auto md:hidden"
                >
                  <Info className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {/* Fileira secundária: estatísticas do grafo, só no mobile e só
                quando o usuário pede (botão de info acima) — no desktop as
                estatísticas já aparecem direto na fileira primária. */}
            {statsData && statsOpen && (
              <div
                id={statsPanelId}
                className="rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/80 px-3 py-2.5 shadow-lg backdrop-blur-xl md:hidden"
              >
                <GraphStats data={statsData} translate={t} className="flex" />
              </div>
            )}
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
  className,
}: {
  data: GraphResp;
  translate: TranslateFn;
  /** Utilitários de display/posição — o caller decide (fileira inline no
   * desktop via `ml-auto hidden md:flex`, ou painel dedicado no mobile via
   * `flex`). Sem valor baked-in aqui pra não conflitar com o `display` que o
   * caller escolhe. */
  className: string;
}): React.ReactElement {
  const concepts = data.nodes.filter(
    (node) => node.type !== 'transcript' && node.type !== 'note' && node.type !== 'folder',
  ).length;
  return (
    <div
      className={cn(
        'flex-wrap items-center gap-3 text-[11px] tabular-nums text-[var(--color-app-muted)]',
        className,
      )}
    >
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
        model={model}
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
  model,
  selectedId,
  translate,
  onSelect,
  onOpen,
}: {
  model: SigmaGraphModel;
  selectedId: string | null;
  translate: TranslateFn;
  onSelect: (id: string | null) => void;
  onOpen: (node: GraphNode) => void;
}): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const coarsePointer = useIsCoarsePointer();
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(
    null,
  );

  // Mede o container real (layout effect: antes do paint, evita flash com o
  // viewBox padrão) e recalcula em resizes seguintes via ResizeObserver — sem
  // isso o viewBox fica fixo em paisagem e sobra espaço vazio em cima/embaixo
  // em telas retrato (a maioria dos celulares). Ver `resolveGraphViewBox`.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setContainerSize({ width: rect.width, height: rect.height });
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setContainerSize({ width, height });
    });
    observer.observe(el);
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
    [model, viewBox, radiusBounds],
  );

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden">
      <svg
        role="img"
        aria-label={translate('graph.title')}
        className="h-full w-full"
        viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
        preserveAspectRatio="xMidYMid meet"
        onClick={() => onSelect(null)}
      >
        <rect width={viewBox.width} height={viewBox.height} fill="transparent" />
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
        className="select-none fill-[var(--color-app-fg)] font-sans text-[11px] font-medium"
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

export function buildSigmaGraphModel(
  data: GraphResp,
  translate?: TranslateFn,
  layoutOptions: GraphLayoutOptions = {},
): SigmaGraphModel {
  const layout = buildGraphLayout(data, layoutOptions);
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
      x: (node.x - layout.viewBox.width / 2) / 150,
      y: (node.y - layout.viewBox.height / 2) / 150,
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

  return { data, graph, layout, neighborhoods, reagraphNodes, reagraphEdges, nodeById };
}

export function nodePath(node: GraphNode): string | null {
  if (!node.sourceId) return null;
  if (node.sourceType === 'TRANSCRIPT') return `/transcricoes/${node.sourceId}`;
  if (node.sourceType === 'NOTE') return `/notas/${node.sourceId}`;
  return null;
}

/**
 * Decide se o grafo abre em 3D (orbita, arrastar gira a câmera) ou 2D
 * (plano, arrastar move a câmera) por padrão. Rotação orbital via drag é um
 * gesto ruim em touchscreen (fácil de disparar sem querer, difícil de
 * controlar com precisão) comparado a mouse — por isso mobile/telas estreitas
 * (`isDesktop === false`) abrem em 2D. O toggle na barra de controles
 * continua disponível pra o usuário ligar o 3D se quiser; isto só decide o
 * valor inicial (não força o estado a mudar se o usuário redimensionar a
 * janela depois).
 */
export function resolveDefaultIs3d(isDesktop: boolean): boolean {
  return isDesktop;
}

/**
 * Recalcula o viewBox do fallback SVG a partir do tamanho real do container,
 * preservando a área do viewBox padrão (mesma densidade visual de nós) mas
 * ajustando a proporção pra bater com a tela. Sem isso, o viewBox fixo em
 * paisagem (1000x620, ~1.6:1) força `preserveAspectRatio="xMidYMid meet"` a
 * escalar pela largura em telas retrato (a maioria dos celulares), deixando
 * faixas vazias grandes em cima/embaixo e o grafo pequeno/apertado no meio.
 * A proporção real do container é clampada entre `MIN_VIEWBOX_ASPECT_RATIO` e
 * `MAX_VIEWBOX_ASPECT_RATIO` — cobre qualquer celular/tablet/desktop real, só
 * age em proporções patológicas (evita layouts esticados demais). Sem medida
 * real (largura ou altura <= 0, ex.: antes do primeiro layout medido), cai
 * pro viewBox padrão.
 */
export function resolveGraphViewBox(
  containerWidth: number,
  containerHeight: number,
): { width: number; height: number } {
  if (!(containerWidth > 0) || !(containerHeight > 0)) return GRAPH_VIEWBOX;
  const area = GRAPH_VIEWBOX.width * GRAPH_VIEWBOX.height;
  const aspect = clamp(
    containerWidth / containerHeight,
    MIN_VIEWBOX_ASPECT_RATIO,
    MAX_VIEWBOX_ASPECT_RATIO,
  );
  const height = Math.sqrt(area / aspect);
  const width = aspect * height;
  return { width: Math.round(width), height: Math.round(height) };
}

/**
 * Limites de raio dos nós do grafo (espaço do layout/SVG, antes de qualquer
 * escala de tela). Em ponteiro coarse (touch), o mínimo sobe de 13 para 17
 * (~30%) — alvo de toque maior sem distorcer o resto do layout, já que só o
 * piso muda (nós já grandes por grau de conexão não são afetados).
 */
export function resolveNodeRadiusBounds(coarsePointer: boolean): { min: number; max: number } {
  return {
    min: coarsePointer ? TOUCH_MIN_NODE_RADIUS : DEFAULT_MIN_NODE_RADIUS,
    max: DEFAULT_MAX_NODE_RADIUS,
  };
}

export function buildGraphLayout(data: GraphResp, options: GraphLayoutOptions = {}): GraphLayout {
  const viewBox = options.viewBox ?? GRAPH_VIEWBOX;
  const minNodeRadius = options.minNodeRadius ?? DEFAULT_MIN_NODE_RADIUS;
  const maxNodeRadius = Math.max(minNodeRadius, options.maxNodeRadius ?? DEFAULT_MAX_NODE_RADIUS);
  const width = viewBox.width;
  const height = viewBox.height;
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
    const radius = clamp(
      11 + Math.min(degree.get(node.id) ?? 0, 8) * 2.3,
      minNodeRadius,
      maxNodeRadius,
    );
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

  return { nodes: layoutNodes, edges: layoutEdges, viewBox: { width, height } };
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
