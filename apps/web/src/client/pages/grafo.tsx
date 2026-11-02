import {
  Component,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  GraphCanvas as GraphCanvasType,
  GraphCanvasRef,
  NodePositionArgs,
  Theme,
} from 'reagraph';
import {
  ArrowLeft,
  Box,
  BrainCircuit,
  ChevronRight,
  ExternalLink,
  Focus,
  Layers3,
  Network,
  PanelLeft,
  RefreshCw,
  Square,
  X,
  ZoomIn,
  ZoomOut,
} from '@/components/ui/icons';
import { AnimatedPage } from '../components/motion/animated-page';
import { GraphServerSearch } from '../components/graph-server-search';
import { GraphIndexDeferredState, GraphIndexStatusBadge } from '../components/graph-index-feedback';
import { Button } from '../components/ui/button';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { FetchError } from '../components/ui/fetch-error';
import { Spinner } from '../components/ui/spinner';
import {
  ALL_GRAPH_NODE_TYPES,
  buildGraphInsights,
  buildSigmaGraphModel,
  graphDescriptionText,
  filterGraphData,
  resolveGraphPalette,
  resolveNodeRadiusBounds,
  toOpaqueGraphColor,
  type GraphEdge,
  type GraphNode,
  type GraphNodeType,
  type GraphPalette,
  type GraphResp,
  type SigmaGraphModel,
} from '../lib/graph-model';
import { graphFocusFromSearch, nodePath } from '../lib/graph-node-path';
import { communitySelectionId } from '../lib/graph-community-model';
import { graphIndexState, isGraphIndexDeferred } from '../lib/graph-loading';
import {
  DEFAULT_GRAPH_MODE,
  GRAPH_3D_INIT_TIMEOUT_MS,
  resolveGraphRenderProfile,
  scheduleGraph3DInitializationFallback,
  type GraphMode,
} from '../lib/graph-renderer';
import { KnowledgeGraphCanvas as BrainGraph2DCanvas } from '../components/graph/knowledge-graph-canvas';
import { useFetch } from '../lib/hooks';
import { useI18n, type TranslateFn } from '../lib/i18n';
import { useIsCoarsePointer } from '../lib/use-media-query';
import { useGraphIndexPolling } from '../lib/use-graph-index-polling';
import { useTheme } from '../lib/theme-provider';
import { cn } from '../lib/utils';
import type { GraphIndexStatus } from '../../shared/graph-index';

export {
  ALL_GRAPH_NODE_TYPES,
  EDGE_COLORS,
  NODE_COLORS,
  buildGraphCommunities,
  buildGraphInsights,
  buildGraphLayout,
  buildSigmaGraphModel,
  filterGraphData,
  nodePath,
  resolveGraphPalette,
  resolveGraphViewBox,
  resolveNodeRadiusBounds,
} from '../lib/graph-model';
export type { GraphResp } from '../lib/graph-model';
type GraphCanvasComponent = typeof GraphCanvasType;
interface ReagraphModule {
  GraphCanvas: GraphCanvasComponent;
  darkTheme: Theme;
}
const EMPTY_REAGRAPH_NODES: SigmaGraphModel['reagraphNodes'] = [];
const EMPTY_REAGRAPH_EDGES: SigmaGraphModel['reagraphEdges'] = [];
const GRAPH_GL_OPTIONS = {
  antialias: false,
  alpha: false,
  powerPreference: 'high-performance' as const,
};
let reagraphModulePromise: Promise<ReagraphModule> | null = null;
let cachedWebGLSupport: boolean | null = null;

function loadReagraph(): Promise<ReagraphModule> {
  reagraphModulePromise ??= import('reagraph');
  return reagraphModulePromise;
}

class GraphRendererBoundary extends Component<
  { children: React.ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(): void {
    this.props.onFailure();
  }

  override render(): React.ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function buildVoxenTheme(baseTheme: Theme, palette: GraphPalette): Theme {
  return {
    ...baseTheme,
    canvas: { background: palette.canvas, fog: palette.canvas },
    node: {
      ...baseTheme.node,
      fill: palette.nodes.content,
      activeFill: palette.activeNode,
      opacity: 1,
      selectedOpacity: 1,
      inactiveOpacity: 0.18,
      label: {
        color: palette.label,
        stroke: palette.labelStroke,
        activeColor: palette.activeLabel,
        // Halo semi-opaco no tom do canvas — título legível sobre nós coloridos.
        backgroundColor: palette.canvas,
        backgroundOpacity: 0.88,
        padding: 6,
        radius: 6,
      },
    },
    ring: {
      fill: toOpaqueGraphColor(palette.neutralEdge),
      activeFill: palette.nodes.transcript,
    },
    edge: {
      ...baseTheme.edge,
      fill: toOpaqueGraphColor(palette.neutralEdge),
      activeFill: toOpaqueGraphColor(palette.label),
      opacity: 0.42,
      selectedOpacity: 1,
      inactiveOpacity: 0.05,
      label: {
        color: palette.label,
        activeColor: palette.activeLabel,
        stroke: palette.labelStroke,
      },
    },
    arrow: {
      fill: toOpaqueGraphColor(palette.neutralEdge),
      activeFill: toOpaqueGraphColor(palette.label),
    },
    lasso: baseTheme.lasso,
  };
}

function latestGraphIndexStatus(
  snapshotStatus?: GraphIndexStatus,
  polledStatus?: GraphIndexStatus | null,
): GraphIndexStatus | null {
  if (!snapshotStatus) return polledStatus ?? null;
  if (!polledStatus) return snapshotStatus;
  return Date.parse(polledStatus.updatedAt) >= Date.parse(snapshotStatus.updatedAt)
    ? polledStatus
    : snapshotStatus;
}

export function GrafoPage(): React.ReactElement {
  const [graphRequest, setGraphRequest] = useState({ tick: 0, force: false });
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [search, setSearch] = useState('');
  const deferredSearch = useDebouncedValue(search, 140);
  const [focusedGraphId, setFocusedGraphId] = useState<string | null>(graphFocusFromSearch);
  const [activeTypes, setActiveTypes] = useState<Set<GraphNodeType>>(
    () => new Set(ALL_GRAPH_NODE_TYPES),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<GraphMode>(DEFAULT_GRAPH_MODE);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const coarsePointer = useIsCoarsePointer();
  const navigate = useNavigate();
  const { t } = useI18n();
  const { theme } = useTheme();
  const graphPath = useMemo(() => {
    const params = new URLSearchParams();
    params.set('view', 'full');
    if (focusedGraphId) {
      params.set('focus', focusedGraphId);
      params.set('hops', '2');
    }
    if (graphRequest.tick > 0) {
      params.set(graphRequest.force ? 'force' : 'refresh', '1');
      params.set('t', String(graphRequest.tick));
    }
    return `/api/graph?${params.toString()}`;
  }, [focusedGraphId, graphRequest.force, graphRequest.tick]);
  const { data, loading, error } = useFetch<GraphResp>(graphPath);
  const graphSearchPath = useMemo(() => {
    const query = deferredSearch.trim();
    return query.length >= 2 ? `/api/graph/search?q=${encodeURIComponent(query)}&limit=12` : null;
  }, [deferredSearch]);
  const { data: serverSearch, loading: searchLoading } = useFetch<{
    query: string;
    results: GraphNode[];
  }>(graphSearchPath);
  const serverSearchResults =
    serverSearch?.query === deferredSearch.trim() ? serverSearch.results : [];
  const {
    data: polledIndexStatus,
    error: statusError,
    refresh: refreshIndexStatus,
  } = useFetch<GraphIndexStatus>('/api/graph/status');
  const indexStatus = latestGraphIndexStatus(data?.indexStatus, polledIndexStatus);
  const indexing = indexStatus?.state === 'running' || (!indexStatus && data?.indexing === true);
  const indexDeferred = isGraphIndexDeferred(indexStatus);
  const indexFailed = indexStatus?.state === 'error' && !indexDeferred;
  const indexUnavailable = indexing || indexDeferred || indexFailed;
  const refreshGraphSnapshot = useCallback(
    () => setGraphRequest({ tick: Date.now(), force: false }),
    [],
  );

  useGraphIndexPolling({
    indexStatus,
    snapshotIndexing: data?.indexing === true,
    statusError,
    refreshIndexStatus,
    refreshSnapshot: refreshGraphSnapshot,
  });

  useEffect(() => {
    const events = new EventSource('/api/graph/events');
    events.addEventListener('invalidated', () => {
      refreshGraphSnapshot();
      refreshIndexStatus();
    });
    return () => events.close();
  }, [refreshGraphSnapshot, refreshIndexStatus]);

  const filtered = useMemo(
    () => (data ? filterGraphData(data, deferredSearch, activeTypes) : null),
    [activeTypes, data, deferredSearch],
  );
  const insights = useMemo(
    () => (filtered ? (filtered.insights ?? buildGraphInsights(filtered)) : null),
    [filtered],
  );
  const palette = useMemo(() => resolveGraphPalette(theme), [theme]);
  const radiusBounds = useMemo(() => resolveNodeRadiusBounds(coarsePointer), [coarsePointer]);
  const model = useMemo(
    () =>
      filtered
        ? buildSigmaGraphModel(
            filtered,
            t,
            { minNodeRadius: radiusBounds.min, maxNodeRadius: radiusBounds.max },
            palette,
          )
        : null,
    [filtered, palette, radiusBounds, t],
  );
  const selectedNode = useMemo(
    () => filtered?.nodes.find((node) => node.id === selectedId) ?? null,
    [filtered, selectedId],
  );
  const openNode = useCallback(
    (node: GraphNode) => {
      const path = nodePath(node);
      if (path) navigate(path);
    },
    [navigate],
  );
  const selectNode = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setExplorerOpen(false);
  }, []);
  const selectSearchResult = useCallback((node: GraphNode) => {
    setActiveTypes((current) => new Set(current).add(node.type));
    setFocusedGraphId(node.id);
    setSelectedId(node.id);
    setSearch('');
    setExplorerOpen(false);
  }, []);
  const toggleType = useCallback((type: GraphNodeType) => {
    setActiveTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);
  const resetFilters = useCallback(() => {
    setActiveTypes(new Set(ALL_GRAPH_NODE_TYPES));
    setSearch('');
    setFocusedGraphId(null);
    setSelectedId(null);
  }, []);
  const fallbackTo2d = useCallback(() => setMode('2d'), []);
  const hasGraph = Boolean(model && model.layout.nodes.length > 0);

  return (
    <AnimatedPage className="h-full">
      <div className="flex h-full min-h-0 flex-col bg-[var(--color-app-bg)] text-[var(--color-app-fg)]">
        <header className="relative z-50 shrink-0 px-3 pb-3 pt-[calc(env(safe-area-inset-top)+4.75rem)] md:px-4 md:pt-4 md:pr-36">
          <div className="rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/92 p-3 shadow-sm backdrop-blur-xl md:p-3.5">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => navigate('/')}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)] md:hidden"
                aria-label={t('shell.backToHome')}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--color-accent-violet)]/25 bg-[var(--color-accent-violet-soft)] text-[var(--color-accent-violet)]">
                  <BrainCircuit className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="truncate font-display text-base font-semibold">
                      {t('graph.title')}
                    </h1>
                    <GraphIndexStatusBadge
                      state={graphIndexState(indexing, indexDeferred, indexFailed, Boolean(data))}
                      translate={t}
                    />
                  </div>
                  <p className="hidden truncate text-xs text-[var(--color-app-muted)] sm:block">
                    {t('graph.subtitle')}
                  </p>
                </div>
              </div>

              {filtered && (
                <div className="ml-auto hidden items-center gap-2 lg:flex">
                  <MetricPill value={filtered.totalNodes} label={t('graph.nodes')} />
                  <MetricPill value={filtered.totalEdges} label={t('graph.relations')} />
                  <MetricPill
                    value={insights?.communities.length ?? 0}
                    label={t('graph.communities')}
                  />
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <GraphServerSearch
                query={search}
                results={serverSearchResults}
                loading={searchLoading}
                focusedId={focusedGraphId}
                translate={t}
                onQueryChange={setSearch}
                onSelect={selectSearchResult}
                onClearFocus={() => {
                  setFocusedGraphId(null);
                  setSelectedId(null);
                }}
              />
              <Button
                variant="outline"
                size="default"
                onClick={() => setExplorerOpen((current) => !current)}
                className="xl:hidden"
              >
                <PanelLeft className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t('graph.explore')}</span>
              </Button>
              <Button
                variant="outline"
                size="default"
                onPointerEnter={() => void loadReagraph()}
                onFocus={() => void loadReagraph()}
                onClick={() => setMode((current) => (current === '2d' ? '3d' : '2d'))}
                title={t(mode === '2d' ? 'graph.switchTo3d' : 'graph.switchTo2d')}
              >
                {mode === '2d' ? (
                  <Box className="h-3.5 w-3.5" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                <span>{mode === '2d' ? '3D' : '2D'}</span>
              </Button>
              <Button
                variant="outline"
                size="default"
                onClick={() => setReprocessOpen(true)}
                disabled={loading || indexing}
                title={t('graph.reprocessBrainTitle')}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', (loading || indexing) && 'animate-spin')} />
                <span className="hidden sm:inline">{t('graph.reprocessBrain')}</span>
              </Button>
            </div>
          </div>
        </header>

        <ConfirmDialog
          open={reprocessOpen}
          onOpenChange={setReprocessOpen}
          title={t('graph.reprocessBrainTitle')}
          description={
            <div className="space-y-2 text-sm text-[var(--color-app-muted)]">
              <p>{t('graph.reprocessBrainDescription')}</p>
              <ul className="list-disc space-y-1 pl-4">
                <li>{t('graph.reprocessBrainDoes')}</li>
                <li>{t('graph.reprocessBrainDoesNot')}</li>
              </ul>
            </div>
          }
          confirmLabel={t('graph.reprocessBrainConfirm')}
          onConfirm={() => {
            setGraphRequest({ tick: Date.now(), force: true });
            refreshIndexStatus();
          }}
        />

        <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3 md:px-4 md:pb-4">
          {data && filtered && insights && (
            <aside className="hidden w-72 shrink-0 overflow-hidden rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] xl:flex">
              <GraphExplorer
                sourceData={data}
                visibleData={filtered}
                insights={insights}
                activeTypes={activeTypes}
                palette={palette}
                translate={t}
                onToggleType={toggleType}
                onReset={resetFilters}
                onSelect={selectNode}
              />
            </aside>
          )}

          <section
            data-drawer-gesture-ignore
            className="graph-canvas-grid relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-bg)] shadow-inner"
          >
            <BrainGraphCanvas
              model={model}
              selectedId={selectedId}
              mode={mode}
              coarsePointer={coarsePointer}
              palette={palette}
              translate={t}
              onSelect={selectNode}
              onOpen={openNode}
              onFallbackTo2d={fallbackTo2d}
            />

            {filtered && hasGraph && (
              <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[min(100%,18rem)] flex-col gap-1">
                <div className="rounded-full border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/85 px-2.5 py-1 text-[10px] tabular-nums text-[var(--color-app-muted)] shadow-sm backdrop-blur-md">
                  {t('graph.visibleCount', {
                    nodes: filtered.totalNodes,
                    edges: filtered.totalEdges,
                  })}
                </div>
              </div>
            )}

            {loading && !data && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--color-app-bg)]/70 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-3 text-sm text-[var(--color-app-muted)]">
                  <Spinner />
                  {t('graph.loading')}
                </div>
              </div>
            )}
            {loading && data && (
              <div className="pointer-events-none absolute right-3 top-3 z-20 flex items-center gap-2 rounded-full border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/90 px-2.5 py-1 text-[10px] text-[var(--color-app-muted)] backdrop-blur-md">
                <Spinner size={12} />
                {t('graph.refreshing')}
              </div>
            )}
            {error && !loading && !data && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--color-app-bg)]/80 px-4 backdrop-blur-sm">
                <FetchError
                  message={error}
                  onRetry={() => setGraphRequest({ tick: Date.now(), force: false })}
                />
              </div>
            )}
            {error && !loading && data && (
              <div
                role="alert"
                className="absolute right-3 top-12 z-20 flex max-w-xs items-center gap-3 rounded-xl border border-rose-400/25 bg-[var(--color-app-bg-elevated)]/95 p-3 text-xs shadow-lg backdrop-blur-md"
              >
                <span className="min-w-0 flex-1 text-[var(--color-app-muted)]">{error}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setGraphRequest({ tick: Date.now(), force: false })}
                >
                  {t('graph.refresh')}
                </Button>
              </div>
            )}
            {!loading && data && data.nodes.length === 0 && !indexUnavailable && (
              <GraphEmptyState translate={t} onNavigate={navigate} />
            )}
            {indexing && data && data.nodes.length === 0 && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6">
                <div className="max-w-sm rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/90 p-6 text-center shadow-xl backdrop-blur-xl">
                  <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-accent-violet-soft)] text-[var(--color-accent-violet)]">
                    <Layers3 className="h-5 w-5 animate-pulse" />
                  </div>
                  <p className="font-display text-sm font-semibold">{t('graph.buildingTitle')}</p>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-app-muted)]">
                    {t('graph.buildingDescription')}
                  </p>
                </div>
              </div>
            )}
            {indexDeferred && data && data.nodes.length === 0 && (
              <GraphIndexDeferredState translate={t} onRetry={() => setReprocessOpen(true)} />
            )}
            {indexFailed && data && data.nodes.length === 0 && (
              <div className="absolute inset-0 z-10 flex items-center justify-center px-6">
                <div className="max-w-sm rounded-2xl border border-rose-400/20 bg-[var(--color-app-bg-elevated)]/95 p-6 text-center shadow-xl backdrop-blur-xl">
                  <p className="font-display text-sm font-semibold">{t('graph.indexErrorTitle')}</p>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-app-muted)]">
                    {t('graph.indexErrorDescription')}
                  </p>
                  <Button className="mt-4" onClick={() => setReprocessOpen(true)}>
                    {t('graph.retryIndex')}
                  </Button>
                </div>
              </div>
            )}

            {explorerOpen && data && filtered && insights && (
              <>
                <button
                  type="button"
                  className="absolute inset-0 z-20 bg-black/15 backdrop-blur-[1px] xl:hidden"
                  aria-label={t('graph.closeExplorer')}
                  onClick={() => setExplorerOpen(false)}
                />
                <aside className="absolute bottom-3 left-3 top-3 z-30 flex w-[min(20rem,calc(100%-1.5rem))] overflow-hidden rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] shadow-2xl xl:hidden">
                  <GraphExplorer
                    sourceData={data}
                    visibleData={filtered}
                    insights={insights}
                    activeTypes={activeTypes}
                    palette={palette}
                    translate={t}
                    onToggleType={toggleType}
                    onReset={resetFilters}
                    onSelect={selectNode}
                    onClose={() => setExplorerOpen(false)}
                  />
                </aside>
              </>
            )}

            {selectedNode && filtered && (
              <>
                <aside className="absolute bottom-3 right-3 top-3 z-30 hidden w-80 overflow-hidden rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/95 shadow-2xl backdrop-blur-xl md:flex">
                  <GraphNodeInspector
                    node={selectedNode}
                    data={filtered}
                    palette={palette}
                    translate={t}
                    onClose={() => setSelectedId(null)}
                    onOpen={openNode}
                    onSelect={selectNode}
                  />
                </aside>
                <aside className="absolute inset-x-3 bottom-3 z-30 flex max-h-[62%] overflow-hidden rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/98 shadow-2xl backdrop-blur-xl md:hidden">
                  <GraphNodeInspector
                    node={selectedNode}
                    data={filtered}
                    palette={palette}
                    translate={t}
                    onClose={() => setSelectedId(null)}
                    onOpen={openNode}
                    onSelect={selectNode}
                  />
                </aside>
              </>
            )}
          </section>
        </div>
      </div>
    </AnimatedPage>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

function MetricPill({ value, label }: { value: number; label: string }): React.ReactElement {
  return (
    <span className="rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg)] px-2.5 py-1 text-[11px] text-[var(--color-app-muted)]">
      <strong className="mr-1 font-semibold tabular-nums text-[var(--color-app-fg)]">
        {value}
      </strong>
      {label}
    </span>
  );
}

function GraphExplorer({
  sourceData,
  visibleData,
  insights,
  activeTypes,
  palette,
  translate,
  onToggleType,
  onReset,
  onSelect,
  onClose,
}: {
  sourceData: GraphResp;
  visibleData: GraphResp;
  insights: NonNullable<GraphResp['insights']>;
  activeTypes: ReadonlySet<GraphNodeType>;
  palette: GraphPalette;
  translate: TranslateFn;
  onToggleType: (type: GraphNodeType) => void;
  onReset: () => void;
  onSelect: (id: string) => void;
  onClose?: () => void;
}): React.ReactElement {
  const allActive = activeTypes.size === ALL_GRAPH_NODE_TYPES.length;
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--color-app-border)] px-4 py-3.5">
        <div>
          <p className="font-display text-sm font-semibold">{translate('graph.explore')}</p>
          <p className="text-[11px] text-[var(--color-app-muted)]">
            {translate('graph.resultSummary', {
              nodes: visibleData.totalNodes,
              total: sourceData.totalNodes,
            })}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-app-muted)] hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)]"
            aria-label={translate('graph.closeExplorer')}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <section>
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-app-muted)]">
              {translate('graph.filters')}
            </h2>
            {!allActive && (
              <button
                type="button"
                onClick={onReset}
                className="text-[11px] font-medium text-[var(--color-accent-violet)] hover:underline"
              >
                {translate('graph.resetFilters')}
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {ALL_GRAPH_NODE_TYPES.map((type) => {
              const active = activeTypes.has(type);
              const count = sourceData.nodes.filter((node) => node.type === type).length;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => onToggleType(type)}
                  aria-pressed={active}
                  className={cn(
                    'flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-[11px] transition',
                    active
                      ? 'border-[var(--color-app-border-strong)] bg-[var(--color-app-surface)] text-[var(--color-app-fg)]'
                      : 'border-transparent bg-transparent text-[var(--color-app-muted)] opacity-60 hover:bg-[var(--color-app-surface-hover)]',
                  )}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: palette.nodes[type] }}
                  />
                  <span className="min-w-0 flex-1 truncate">{translate(`graph.node.${type}`)}</span>
                  <span className="tabular-nums text-[var(--color-app-muted)]">{count}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-app-muted)]">
            {translate('graph.hubs')}
          </h2>
          <div className="space-y-1">
            {insights.hubs.slice(0, 7).map((hub, index) => (
              <button
                key={hub.id}
                type="button"
                onClick={() => onSelect(hub.id)}
                className="group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-[var(--color-app-surface-hover)]"
              >
                <span className="w-4 text-center text-[10px] tabular-nums text-[var(--color-app-muted)]">
                  {index + 1}
                </span>
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: palette.nodes[hub.type] }}
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{hub.label}</span>
                <span className="rounded-md bg-[var(--color-app-bg)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--color-app-muted)]">
                  {Math.round((hub.weightedDegreeCentrality ?? 0) * 100)}%
                </span>
              </button>
            ))}
            {insights.hubs.length === 0 && (
              <p className="rounded-xl border border-dashed border-[var(--color-app-border)] px-3 py-4 text-center text-xs text-[var(--color-app-muted)]">
                {translate('graph.noHubs')}
              </p>
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-app-muted)]">
            {translate('graph.communities')}
          </h2>
          <div className="space-y-1.5">
            {insights.communities.slice(0, 6).map((community) => (
              <button
                key={community.id}
                type="button"
                onClick={() => onSelect(communitySelectionId(community))}
                className="flex w-full items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 text-left transition hover:border-[var(--color-app-border)] hover:bg-[var(--color-app-surface-hover)]"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-violet-soft)] text-[var(--color-accent-violet)]">
                  <Network className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{community.label}</span>
                  <span className="text-[10px] text-[var(--color-app-muted)]">
                    {translate('graph.communitySize', { count: community.size })}
                  </span>
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-[var(--color-app-muted)]" />
              </button>
            ))}
          </div>
        </section>

        {visibleData.totalEdges > 0 && (
          <section>
            <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-app-muted)]">
              {translate('graph.evidence')}
            </h2>
            <EvidenceBar insights={insights} translate={translate} />
          </section>
        )}
      </div>
    </div>
  );
}

function EvidenceBar({
  insights,
  translate,
}: {
  insights: NonNullable<GraphResp['insights']>;
  translate: TranslateFn;
}): React.ReactElement {
  const values = insights.edgeEvidence;
  const total = values.extracted + values.inferred + values.ambiguous || 1;
  return (
    <div className="rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg)] p-3">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-[var(--color-app-surface)]">
        <span
          className="bg-emerald-400"
          style={{ width: `${(values.extracted / total) * 100}%` }}
        />
        <span className="bg-sky-400" style={{ width: `${(values.inferred / total) * 100}%` }} />
        <span className="bg-zinc-500" style={{ width: `${(values.ambiguous / total) * 100}%` }} />
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-2 text-[9px] text-[var(--color-app-muted)]">
        <span>
          {translate('graph.evidenceExtracted')} · {values.extracted}
        </span>
        <span>
          {translate('graph.evidenceInferred')} · {values.inferred}
        </span>
        <span>
          {translate('graph.evidenceAmbiguous')} · {values.ambiguous}
        </span>
      </div>
    </div>
  );
}

function GraphNodeInspector({
  node,
  data,
  palette,
  translate,
  onClose,
  onOpen,
  onSelect,
}: {
  node: GraphNode;
  data: GraphResp;
  palette: GraphPalette;
  translate: TranslateFn;
  onClose: () => void;
  onOpen: (node: GraphNode) => void;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const byId = useMemo(() => new Map(data.nodes.map((item) => [item.id, item])), [data.nodes]);
  const connections = useMemo(
    () =>
      data.edges
        .filter((edge) => edge.from === node.id || edge.to === node.id)
        .map((edge) => ({ edge, neighbor: byId.get(edge.from === node.id ? edge.to : edge.from) }))
        .filter((item): item is { edge: GraphEdge; neighbor: GraphNode } => Boolean(item.neighbor)),
    [byId, data.edges, node.id],
  );
  const path = nodePath(node);

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex items-start gap-3 border-b border-[var(--color-app-border)] p-4">
        <span
          className="mt-0.5 h-3 w-3 shrink-0 rounded-full"
          style={{ background: palette.nodes[node.type] }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--color-app-muted)]">
            {translate(`graph.node.${node.type}`)}
          </p>
          <h2 className="mt-1 break-words font-display text-base font-semibold leading-snug">
            {node.label}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--color-app-muted)] hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)]"
          aria-label={translate('graph.closeInspector')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {node.description && (
          <p className="mb-4 text-xs leading-relaxed text-[var(--color-app-subtle)]">
            {graphDescriptionText(node.description)}
          </p>
        )}
        <div className="mb-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg)] p-3">
            <p className="text-lg font-semibold tabular-nums">{connections.length}</p>
            <p className="text-[10px] text-[var(--color-app-muted)]">
              {translate('graph.connectionsLabel')}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg)] p-3">
            <p className="truncate text-xs font-semibold">
              {node.source ?? node.sourceType ?? 'Brain'}
            </p>
            <p className="mt-1 text-[10px] text-[var(--color-app-muted)]">
              {translate('graph.source')}
            </p>
          </div>
        </div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--color-app-muted)]">
          {translate('graph.connectionsLabel')}
        </h3>
        <div className="space-y-1">
          {connections.slice(0, 14).map(({ edge, neighbor }) => (
            <button
              key={edge.id}
              type="button"
              onClick={() => onSelect(neighbor.id)}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-[var(--color-app-surface-hover)]"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: palette.nodes[neighbor.type] }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{neighbor.label}</span>
                <span className="block truncate text-[10px] text-[var(--color-app-muted)]">
                  {translate('graph.relationReason', {
                    reason: translate(`graph.edge.${edge.kind}`),
                  })}
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-[var(--color-app-muted)]">
                  {translate('graph.relationMethod', { method: edge.method })} ·{' '}
                  {translate('graph.relationConfidence', {
                    confidence: String(Math.round(Number(edge.confidence) * 100)),
                  })}
                </span>
                <span className="block truncate text-[10px] text-[var(--color-app-muted)]">
                  {translate('graph.relationEvidence', {
                    evidence: translate(
                      edge.evidence === 'EXTRACTED'
                        ? 'graph.evidenceExtracted'
                        : edge.evidence === 'INFERRED'
                          ? 'graph.evidenceInferred'
                          : 'graph.evidenceAmbiguous',
                    ),
                  })}
                </span>
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-[var(--color-app-muted)]" />
            </button>
          ))}
          {connections.length === 0 && (
            <p className="rounded-xl border border-dashed border-[var(--color-app-border)] px-3 py-4 text-center text-xs text-[var(--color-app-muted)]">
              {translate('graph.noConnections')}
            </p>
          )}
        </div>
      </div>

      {path && (
        <div className="border-t border-[var(--color-app-border)] p-3">
          <Button className="w-full" onClick={() => onOpen(node)}>
            <ExternalLink className="h-3.5 w-3.5" />
            {translate('graph.openSource')}
          </Button>
        </div>
      )}
    </div>
  );
}

function GraphEmptyState({
  translate,
  onNavigate,
}: {
  translate: TranslateFn;
  onNavigate: (path: string) => void;
}): React.ReactElement {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] text-[var(--color-accent-violet)] shadow-sm">
          <Network className="h-5 w-5" />
        </div>
        <h2 className="mt-4 font-display text-lg font-semibold">{translate('graph.emptyTitle')}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-app-muted)]">
          {translate('graph.emptyDescription')}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="outline" onClick={() => onNavigate('/notas')}>
            {translate('graph.createNote')}
          </Button>
          <Button onClick={() => onNavigate('/transcricoes')}>
            {translate('graph.addContent')}
          </Button>
        </div>
      </div>
    </div>
  );
}

const BrainGraphCanvas = memo(function BrainGraphCanvas({
  model,
  selectedId,
  mode,
  coarsePointer,
  palette,
  translate,
  onSelect,
  onOpen,
  onFallbackTo2d,
}: {
  model: SigmaGraphModel | null;
  selectedId: string | null;
  mode: GraphMode;
  coarsePointer: boolean;
  palette: GraphPalette;
  translate: TranslateFn;
  onSelect: (id: string | null) => void;
  onOpen: (node: GraphNode) => void;
  onFallbackTo2d: () => void;
}): React.ReactElement {
  if (mode === '3d') {
    return (
      <BrainGraph3DCanvas
        model={model}
        selectedId={selectedId}
        coarsePointer={coarsePointer}
        palette={palette}
        translate={translate}
        onSelect={onSelect}
        onOpen={onOpen}
        onFallback={onFallbackTo2d}
      />
    );
  }
  return (
    <BrainGraph2DCanvas
      model={model}
      selectedId={selectedId}
      palette={palette}
      translate={translate}
      onSelect={onSelect}
      onOpen={onOpen}
    />
  );
});

export function BrainGraph3DCanvas({
  model,
  selectedId,
  coarsePointer,
  palette,
  translate,
  onSelect,
  onOpen,
  onFallback,
  initializationTimeoutMs = GRAPH_3D_INIT_TIMEOUT_MS,
}: {
  model: SigmaGraphModel | null;
  selectedId: string | null;
  coarsePointer: boolean;
  palette: GraphPalette;
  translate: TranslateFn;
  onSelect: (id: string | null) => void;
  onOpen: (node: GraphNode) => void;
  onFallback: () => void;
  initializationTimeoutMs?: number;
}): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<GraphCanvasRef | null>(null);
  const cancelInitializationBudgetRef = useRef<(() => void) | null>(null);
  const primaryNodeIdsRef = useRef<string[]>([]);
  const renderedNodeIdsRef = useRef<Set<string>>(new Set());
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [reagraph, setReagraph] = useState<ReagraphModule | null>(null);
  const profile = useMemo(
    () => resolveGraphRenderProfile(model?.graph.order ?? 0, model?.graph.size ?? 0, coarsePointer),
    [coarsePointer, model?.graph.order, model?.graph.size],
  );
  const graphTheme = useMemo(
    () => (reagraph ? buildVoxenTheme(reagraph.darkTheme, palette) : null),
    [palette, reagraph],
  );
  const layoutOverrides = useMemo(
    () =>
      ({
        getNodePosition: (id: string, { drags }: NodePositionArgs) =>
          drags?.[id]?.position ?? model?.positions3d.get(id) ?? { x: 0, y: 0, z: 0 },
      }) as unknown as React.ComponentProps<GraphCanvasComponent>['layoutOverrides'],
    [model?.positions3d],
  );
  primaryNodeIdsRef.current = model?.primaryNodeIds ?? [];
  renderedNodeIdsRef.current = new Set(model?.reagraphNodes.map((node) => node.id) ?? []);
  const handleGraphRef = useCallback((instance: GraphCanvasRef | null) => {
    graphRef.current = instance;
    if (!instance) return;
    cancelInitializationBudgetRef.current?.();
    cancelInitializationBudgetRef.current = null;
  }, []);

  useEffect(() => {
    if (!supportsWebGL()) {
      onFallback();
      return;
    }
    let cancelled = false;
    const cancelInitializationBudget = scheduleGraph3DInitializationFallback(() => {
      if (!cancelled) onFallback();
    }, initializationTimeoutMs);
    cancelInitializationBudgetRef.current = cancelInitializationBudget;
    void loadReagraph()
      .then((module) => {
        if (!cancelled) setReagraph(module);
      })
      .catch(() => {
        cancelInitializationBudget();
        cancelInitializationBudgetRef.current = null;
        if (!cancelled) onFallback();
      });
    return () => {
      cancelled = true;
      cancelInitializationBudget();
      cancelInitializationBudgetRef.current = null;
    };
  }, [initializationTimeoutMs, onFallback]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleContextLost = (event: Event): void => {
      event.preventDefault();
      onFallback();
    };
    const handleContextCreationError = (): void => onFallback();
    container.addEventListener('webglcontextlost', handleContextLost, true);
    container.addEventListener('webglcontextcreationerror', handleContextCreationError, true);
    return () => {
      container.removeEventListener('webglcontextlost', handleContextLost, true);
      container.removeEventListener('webglcontextcreationerror', handleContextCreationError, true);
    };
  }, [onFallback]);

  const activeId = hoveredId ?? selectedId;
  const actives = useMemo(() => {
    if (!activeId || !model) return undefined;
    return [...(model.neighborhoods.get(activeId) ?? new Set([activeId]))].filter((id) =>
      renderedNodeIdsRef.current.has(id),
    );
  }, [activeId, model]);

  const fitGraphView = useCallback((scope: 'primary' | 'all', animated: boolean) => {
    try {
      const ids =
        scope === 'primary'
          ? primaryNodeIdsRef.current.filter((id) => renderedNodeIdsRef.current.has(id))
          : undefined;
      graphRef.current?.fitNodesInView(ids?.length ? ids : undefined, { animated });
    } catch {
      // A câmera ainda pode estar preparando a cena.
    }
  }, []);

  const zoomGraph = useCallback((direction: 'in' | 'out') => {
    try {
      if (direction === 'in') graphRef.current?.zoomIn();
      else graphRef.current?.zoomOut();
    } catch {
      // Os controles podem chegar antes de a câmera 3D estar pronta.
    }
  }, []);

  useEffect(() => {
    if (!model || model.graph.order === 0 || !reagraph) return;
    // 1º frame: fit global (cena ainda montando; ids primários podem faltar).
    // Depois: enquadra o núcleo (maior comunidade) — concentração de dados no centro.
    const frame =
      typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame(() => fitGraphView('all', false))
        : null;
    const timer = window.setTimeout(() => {
      const hasPrimary = primaryNodeIdsRef.current.some((id) => renderedNodeIdsRef.current.has(id));
      fitGraphView(hasPrimary ? 'primary' : 'all', profile.animated);
    }, 220);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [fitGraphView, model?.topologyKey, profile.animated, reagraph]);

  useEffect(() => {
    if (!reagraph || !selectedId || !renderedNodeIdsRef.current.has(selectedId)) return;
    try {
      graphRef.current?.centerGraph([selectedId]);
    } catch {
      // A seleção pode chegar antes de a câmera 3D estar pronta.
    }
  }, [model?.topologyKey, reagraph, selectedId]);

  const GraphCanvas = reagraph?.GraphCanvas;
  return (
    <div ref={containerRef} className="absolute inset-0">
      {!GraphCanvas && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="flex items-center gap-2 rounded-full border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/90 px-3 py-1.5 text-xs text-[var(--color-app-muted)] backdrop-blur-md">
            <Spinner size={14} />
            {translate('graph.loading3d')}
          </div>
        </div>
      )}
      {GraphCanvas && graphTheme && (
        <GraphRendererBoundary onFailure={onFallback}>
          <GraphCanvas
            ref={handleGraphRef}
            nodes={model?.reagraphNodes ?? EMPTY_REAGRAPH_NODES}
            edges={model?.reagraphEdges ?? EMPTY_REAGRAPH_EDGES}
            theme={graphTheme}
            layoutType="custom"
            layoutOverrides={layoutOverrides}
            labelType={profile.labelType}
            edgeInterpolation={profile.edgeInterpolation}
            edgeArrowPosition="none"
            cameraMode="rotate"
            minDistance={180}
            maxDistance={8_000}
            animated={profile.animated}
            draggable={profile.draggable}
            aggregateEdges={profile.aggregateEdges}
            glOptions={GRAPH_GL_OPTIONS}
            selections={
              selectedId && renderedNodeIdsRef.current.has(selectedId) ? [selectedId] : []
            }
            actives={actives}
            onNodeClick={(node) => onSelect(node.id)}
            onNodeDoubleClick={(node) => {
              const original = model?.nodeById.get(node.id);
              if (original) onOpen(original);
            }}
            onNodePointerOver={(node) => setHoveredId(node.id)}
            onNodePointerOut={() => setHoveredId(null)}
            onCanvasClick={() => onSelect(null)}
          >
            <ambientLight intensity={0.72} />
            <directionalLight position={[450, 700, 900]} intensity={1.15} />
            <pointLight position={[-700, -300, 550]} intensity={0.72} />
          </GraphCanvas>
        </GraphRendererBoundary>
      )}
      {GraphCanvas && model && model.graph.order > 0 && (
        <>
          <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-full border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/82 px-2.5 py-1 text-[10px] font-medium text-[var(--color-app-muted)] shadow-sm backdrop-blur-md">
            3D · {translate(`graph.renderProfile.${profile.tier}`)}
          </div>
          <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1 rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/88 p-1 shadow-lg backdrop-blur-md">
            <CanvasButton label={translate('graph.zoomIn')} onClick={() => zoomGraph('in')}>
              <ZoomIn className="h-3.5 w-3.5" />
            </CanvasButton>
            <CanvasButton label={translate('graph.zoomOut')} onClick={() => zoomGraph('out')}>
              <ZoomOut className="h-3.5 w-3.5" />
            </CanvasButton>
            <CanvasButton
              label={translate('graph.focusCore')}
              onClick={() => fitGraphView('primary', true)}
            >
              <Focus className="h-3.5 w-3.5" />
            </CanvasButton>
            <CanvasButton
              label={translate('graph.fitAll')}
              onClick={() => fitGraphView('all', true)}
            >
              <Network className="h-3.5 w-3.5" />
            </CanvasButton>
          </div>
        </>
      )}
    </div>
  );
}

function CanvasButton({
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
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-app-muted)] transition hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)]"
    >
      {children}
    </button>
  );
}

function supportsWebGL(): boolean {
  if (cachedWebGLSupport !== null) return cachedWebGLSupport;
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2', GRAPH_GL_OPTIONS) as WebGL2RenderingContext | null;
    cachedWebGLSupport = Boolean(context);
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.width = 0;
    canvas.height = 0;
    return cachedWebGLSupport;
  } catch {
    cachedWebGLSupport = false;
    return false;
  }
}
