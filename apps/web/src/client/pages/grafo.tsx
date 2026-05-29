// ============================================================================
// /grafo — visualização do Voxen Brain
// ============================================================================
// Spec: .specs/020-brain-knowledge-harness.md
// Tech: cytoscape.js layout 'cose' sobre BrainNode/BrainEdge materializados.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import cytoscape, { type Core, type NodeSingular } from 'cytoscape';
import { BrainCircuit, ExternalLink, Network, RotateCw, Search } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
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

const NODE_COLORS: Record<GraphNodeType, string> = {
  transcript: 'oklch(72% 0.17 293)',
  note: 'oklch(73% 0.15 158)',
  folder: 'oklch(80% 0.15 76)',
  entity: 'oklch(72% 0.14 226)',
  topic: 'oklch(72% 0.15 35)',
  claim: 'oklch(73% 0.16 330)',
  event: 'oklch(76% 0.16 196)',
  cluster: 'oklch(82% 0.12 105)',
  content: 'oklch(68% 0.06 255)',
};

const EDGE_COLORS: Record<GraphEdge['kind'], string> = {
  belongs_to: 'oklch(80% 0.15 76 / 0.72)',
  links_to: 'oklch(72% 0.17 293 / 0.78)',
  mentions: 'oklch(72% 0.14 226 / 0.72)',
  supports: 'oklch(73% 0.15 158 / 0.76)',
  contradicts: 'oklch(68% 0.18 25 / 0.78)',
  same_as: 'oklch(84% 0.08 255 / 0.7)',
  part_of: 'oklch(76% 0.16 196 / 0.72)',
  related_to: 'oklch(68% 0.06 255 / 0.68)',
  next_to: 'oklch(82% 0.12 105 / 0.7)',
};

const NODE_COLOR_STYLES: cytoscape.StylesheetJsonBlock[] = Object.entries(NODE_COLORS).map(
  ([type, color]) => ({
    selector: `node.${type}`,
    style: {
      'background-color': color,
      shape: nodeShape(type as GraphNodeType),
    },
  }),
);

const EDGE_COLOR_STYLES: cytoscape.StylesheetJsonBlock[] = Object.entries(EDGE_COLORS).map(
  ([kind, color]) => ({
    selector: `edge.${kind}`,
    style: { 'line-color': color, 'target-arrow-color': color },
  }),
);

export function GrafoPage(): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [forceTick, setForceTick] = useState(0);
  const graphPath = forceTick > 0 ? `/api/graph?force=1&t=${forceTick}` : '/api/graph';
  const { data, loading, error } = useFetch<GraphResp>(graphPath);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const navigate = useNavigate();
  const { t } = useI18n();

  const nodeById = useMemo(() => {
    return new Map((data?.nodes ?? []).map((node) => [node.id, node]));
  }, [data]);
  const edgeByNodeId = useMemo(() => {
    const grouped = new Map<string, GraphEdge[]>();
    for (const edge of data?.edges ?? []) {
      grouped.set(edge.from, [...(grouped.get(edge.from) ?? []), edge]);
      grouped.set(edge.to, [...(grouped.get(edge.to) ?? []), edge]);
    }
    return grouped;
  }, [data]);

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

  const selectedNode = selectedId ? (nodeById.get(selectedId) ?? null) : null;
  const selectedEdges = selectedId ? (edgeByNodeId.get(selectedId) ?? []) : [];

  useEffect(() => {
    if (selectedId && filtered && !filtered.nodes.some((node) => node.id === selectedId)) {
      setSelectedId(null);
    }
  }, [filtered, selectedId]);

  useEffect(() => {
    if (!containerRef.current || !filtered) return;
    cyRef.current?.destroy();

    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...filtered.nodes.map((node) => ({
          data: {
            id: node.id,
            label: node.label,
            type: node.type,
            weight: node.weight,
          },
          classes: node.type,
        })),
        ...filtered.edges.map((edge) => ({
          data: {
            id: edge.id,
            source: edge.from,
            target: edge.to,
            kind: edge.kind,
            method: edge.method,
          },
          classes: edge.kind,
        })),
      ],
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            color: '#f4f4f5',
            'font-size': 9,
            'font-family': 'Inter, sans-serif',
            'text-valign': 'bottom',
            'text-margin-y': 8,
            'text-max-width': '132px',
            'text-wrap': 'wrap',
            width: 'mapData(weight, 1, 9, 14, 34)',
            height: 'mapData(weight, 1, 9, 14, 34)',
            'border-width': 1.4,
            'border-color': '#18181b',
            'overlay-opacity': 0,
          },
        },
        ...NODE_COLOR_STYLES,
        {
          selector: 'edge',
          style: {
            width: 1.15,
            'line-color': 'oklch(56% 0.05 255 / 0.5)',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': 'oklch(56% 0.05 255 / 0.5)',
            'curve-style': 'bezier',
            opacity: 0.72,
          },
        },
        ...EDGE_COLOR_STYLES,
        {
          selector: 'edge.belongs_to',
          style: { 'line-style': 'dashed', width: 1.25 },
        },
        {
          selector: 'edge.links_to',
          style: { width: 1.65 },
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 4,
            'border-color': '#fafafa',
            'underlay-color': 'oklch(72% 0.17 293 / 0.18)',
            'underlay-opacity': 1,
            'underlay-padding': 7,
          },
        },
      ],
      layout: {
        name: filtered.nodes.length < 4 ? 'circle' : 'cose',
        animate: true,
        animationDuration: 650,
        nodeRepulsion: () => 7200,
        idealEdgeLength: () => 88,
        edgeElasticity: () => 78,
        nestingFactor: 1.1,
        gravity: 0.28,
        randomize: false,
        fit: true,
        padding: 44,
      },
      wheelSensitivity: 0.18,
      minZoom: 0.18,
      maxZoom: 3.2,
    });

    cy.on('tap', 'node', (evt) => {
      const node = evt.target as NodeSingular;
      setSelectedId(node.id());
    });
    cy.on('tap', (evt) => {
      if (evt.target === cy) setSelectedId(null);
    });
    cy.ready(() => {
      cy.fit(undefined, 44);
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
    };
  }, [filtered]);

  const stats = filtered ?? data;

  return (
    <AnimatedPage>
      <div className="mx-auto max-w-7xl space-y-7 px-5 py-8 sm:px-8 sm:py-10">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs uppercase text-[var(--color-app-muted)] font-medium">
            <BrainCircuit className="h-3.5 w-3.5 text-violet-400" />
            {t('graph.eyebrow')}
          </div>
          <h1 className="font-display text-3xl font-semibold sm:text-4xl">{t('graph.title')}</h1>
          <p className="max-w-3xl text-[15px] leading-relaxed text-[var(--color-app-muted)]">
            {t('graph.descriptionBefore')} {t('graph.descriptionAfter')}
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1 max-w-lg">
            <span className="pointer-events-none absolute left-3.5 top-1/2 z-10 flex h-4 w-4 -translate-y-1/2 items-center justify-center text-zinc-400">
              <Search className="h-4 w-4" />
            </span>
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('graph.searchPlaceholder')}
              className="relative h-11 w-full rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/70 pl-10 pr-4 text-[14px] text-zinc-100 placeholder:text-[var(--color-app-muted)] transition-colors focus:border-violet-400/60 focus:outline-none focus:ring-2 focus:ring-violet-500/15"
            />
          </div>
          <Button
            variant="outline"
            size="default"
            onClick={() => setForceTick(Date.now())}
            disabled={loading}
          >
            <RotateCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            {t('graph.refresh')}
          </Button>
          {stats && stats.nodes.length > 0 && <GraphStats data={stats} translate={t} />}
        </div>

        <Card elevated className="overflow-hidden p-0">
          <div className="grid min-h-[620px] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="relative min-h-[520px] bg-[var(--color-app-bg-elevated)]">
              {loading && !data && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Spinner />
                </div>
              )}
              {error && (
                <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-rose-300">
                  {error}
                </div>
              )}
              {!loading && data && data.nodes.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <CardContent className="max-w-md space-y-3 py-12 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--color-app-border-strong)] bg-[var(--color-app-surface-hover)]">
                      <Network className="h-5 w-5 text-violet-400" />
                    </div>
                    <div className="space-y-1.5">
                      <p className="font-display text-lg font-semibold">{t('graph.emptyTitle')}</p>
                      <p className="text-sm leading-relaxed text-[var(--color-app-muted)]">
                        {t('graph.emptyDescriptionBefore')}{' '}
                        <code className="text-zinc-300">/notas</code>{' '}
                        {t('graph.emptyDescriptionMiddle')}{' '}
                        <code className="text-zinc-300">/jobs</code>{' '}
                        {t('graph.emptyDescriptionAfter')}
                      </p>
                    </div>
                  </CardContent>
                </div>
              )}
              <div ref={containerRef} className="absolute inset-0" />
            </div>
            <GraphInspector
              node={selectedNode}
              edges={selectedEdges}
              nodes={nodeById}
              translate={t}
              onOpen={(node) => {
                const path = nodePath(node);
                if (path) navigate(path);
              }}
            />
          </div>
        </Card>
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

function GraphInspector({
  node,
  edges,
  nodes,
  translate,
  onOpen,
}: {
  node: GraphNode | null;
  edges: GraphEdge[];
  nodes: Map<string, GraphNode>;
  translate: TranslateFn;
  onOpen: (node: GraphNode) => void;
}): React.ReactElement {
  if (!node) {
    return (
      <aside className="border-t border-[var(--color-app-border)] bg-[var(--color-app-surface)]/35 p-5 lg:border-l lg:border-t-0">
        <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]">
            <BrainCircuit className="h-5 w-5 text-violet-300" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-zinc-100">
              {translate('graph.noSelectionTitle')}
            </p>
            <p className="max-w-[240px] text-xs leading-relaxed text-[var(--color-app-muted)]">
              {translate('graph.noSelectionDescription')}
            </p>
          </div>
        </div>
      </aside>
    );
  }

  const path = nodePath(node);
  const visibleEdges = edges.slice(0, 8);
  return (
    <aside className="border-t border-[var(--color-app-border)] bg-[var(--color-app-surface)]/35 p-5 lg:border-l lg:border-t-0">
      <div className="flex h-full flex-col gap-5">
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <span
              className="mt-1 h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: NODE_COLORS[node.type] }}
            />
            <div className="min-w-0">
              <p className="break-words font-display text-lg font-semibold leading-tight text-zinc-100">
                {node.label}
              </p>
              <p className="mt-1 truncate font-mono text-[11px] text-[var(--color-app-muted)]">
                {node.key}
              </p>
            </div>
          </div>
          {node.description && (
            <p className="line-clamp-5 text-sm leading-relaxed text-[var(--color-app-muted)]">
              {node.description}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <NodePill>{nodeTypeLabel(node.type, translate)}</NodePill>
            {node.source && <NodePill>{node.source}</NodePill>}
            <NodePill>{translate('graph.degree', { count: edges.length })}</NodePill>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase text-[var(--color-app-muted)]">
            {translate('graph.connectionsLabel')}
          </p>
          {visibleEdges.length === 0 ? (
            <p className="text-xs text-[var(--color-app-muted)]">
              {translate('graph.noConnections')}
            </p>
          ) : (
            <div className="space-y-2">
              {visibleEdges.map((edge) => {
                const other = nodes.get(edge.from === node.id ? edge.to : edge.from);
                return (
                  <div
                    key={edge.id}
                    className="rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: EDGE_COLORS[edge.kind] }}
                      />
                      <span className="truncate text-xs font-medium text-zinc-200">
                        {other?.label ?? edge.to}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-[var(--color-app-muted)]">
                      {edgeKindLabel(edge.kind, translate)} · {edge.method}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-auto">
          <Button
            type="button"
            variant="primary"
            className="w-full"
            disabled={!path}
            onClick={() => onOpen(node)}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {translate('graph.openNode')}
          </Button>
        </div>
      </div>
    </aside>
  );
}

function NodePill({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="rounded-md border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] px-2 py-1 text-[11px] text-zinc-300">
      {children}
    </span>
  );
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

function nodeShape(type: GraphNodeType): cytoscape.Css.NodeShape {
  if (type === 'folder') return 'round-rectangle';
  if (type === 'cluster') return 'hexagon';
  return 'ellipse';
}

function nodePath(node: GraphNode): string | null {
  if (!node.sourceId) return null;
  if (node.sourceType === 'TRANSCRIPT') return `/transcricoes/${node.sourceId}`;
  if (node.sourceType === 'NOTE') return `/notas/${node.sourceId}`;
  return null;
}

function nodeTypeLabel(type: GraphNodeType, translate: TranslateFn): string {
  return translate(`graph.node.${type}`);
}

function edgeKindLabel(kind: GraphEdge['kind'], translate: TranslateFn): string {
  return translate(`graph.edge.${kind}`);
}
