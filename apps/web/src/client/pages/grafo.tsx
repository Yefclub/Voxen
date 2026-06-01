// ============================================================================
// /grafo — visualização do Voxen Brain
// ============================================================================
// Spec: .specs/020-brain-knowledge-harness.md
// Tech: SVG responsivo sobre BrainNode/BrainEdge materializados.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

export function GrafoPage(): React.ReactElement {
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
  const graphLayout = useMemo(() => (filtered ? buildGraphLayout(filtered) : null), [filtered]);

  useEffect(() => {
    if (selectedId && filtered && !filtered.nodes.some((node) => node.id === selectedId)) {
      setSelectedId(null);
    }
  }, [filtered, selectedId]);

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
              <BrainGraphCanvas
                layout={graphLayout}
                selectedId={selectedId}
                translate={t}
                onSelect={setSelectedId}
              />
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

function BrainGraphCanvas({
  layout,
  selectedId,
  translate,
  onSelect,
}: {
  layout: GraphLayout | null;
  selectedId: string | null;
  translate: TranslateFn;
  onSelect: (id: string | null) => void;
}): React.ReactElement {
  if (!layout || layout.nodes.length === 0) {
    return <div className="absolute inset-0" />;
  }

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
}: {
  node: GraphLayoutNode;
  selected: boolean;
  onSelect: (id: string) => void;
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
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
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
