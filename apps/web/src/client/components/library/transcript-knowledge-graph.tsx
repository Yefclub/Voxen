import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, FileText, Loader2, Network } from '@/components/ui/icons';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { useFetch } from '../../lib/hooks';
import { useI18n } from '../../lib/i18n';
import { cn } from '../../lib/utils';
import {
  buildGraphLayout,
  EDGE_COLORS,
  edgePath,
  NODE_COLORS,
  type GraphEdge,
  type GraphNode,
  type GraphResp,
} from '../../lib/graph-model';

type TranscriptGraphScope = 'content' | 'connections';
type TranscriptGraphState = 'NOT_INDEXED' | 'INDEXING' | 'PARTIAL' | 'FAILED' | 'READY';

interface TranscriptGraphEvidence {
  id: string;
  nodeId: string | null;
  edgeId: string | null;
  sourceType: string;
  sourceId: string;
  excerpt: string | null;
  startLine: number | null;
  endLine: number | null;
  startSec: number | null;
  endSec: number | null;
  anchor: string | null;
}

interface TranscriptGraphResponse extends GraphResp {
  transcriptId: string;
  focusId: string | null;
  scope: TranscriptGraphScope;
  hops: number;
  state: TranscriptGraphState;
  evidence: TranscriptGraphEvidence[];
  compilation: {
    status: string;
    totalSegments: number;
    completedSegments: number;
    lastError: string | null;
    updatedAt: string;
  } | null;
}

const VIEWBOX = { width: 1_000, height: 440 };

export function TranscriptKnowledgeGraph({
  transcriptId,
}: {
  transcriptId: string;
}): React.ReactElement {
  const { t } = useI18n();
  const [scope, setScope] = useState<TranscriptGraphScope>('content');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, loading, error, refresh } = useFetch<TranscriptGraphResponse>(
    `/api/transcripts/${transcriptId}/graph?scope=${scope}&hops=${scope === 'connections' ? 2 : 1}`,
  );
  const graphData = useMemo<GraphResp | null>(
    () =>
      data
        ? {
            nodes: data.nodes,
            edges: data.edges,
            totalNodes: data.nodes.length,
            totalEdges: data.edges.length,
          }
        : null,
    [data],
  );
  const layout = useMemo(
    () => (graphData ? buildGraphLayout(graphData, { viewBox: VIEWBOX }) : null),
    [graphData],
  );
  const selectedNode = data?.nodes.find((node) => node.id === selectedId) ?? null;
  const selectedEdges = useMemo(
    () => data?.edges.filter((edge) => edge.from === selectedId || edge.to === selectedId) ?? [],
    [data?.edges, selectedId],
  );
  const selectedEvidence = useMemo(() => {
    if (!data || !selectedId) return [];
    const edgeIds = new Set(selectedEdges.map((edge) => edge.id));
    return data.evidence.filter(
      (evidence) =>
        evidence.nodeId === selectedId || Boolean(evidence.edgeId && edgeIds.has(evidence.edgeId)),
    );
  }, [data, selectedEdges, selectedId]);

  useEffect(() => {
    if (!data) return;
    setSelectedId((current) =>
      current && data.nodes.some((node) => node.id === current)
        ? current
        : (data.focusId ?? data.nodes[0]?.id ?? null),
    );
  }, [data]);

  function openEvidence(anchor: string): void {
    if (window.location.hash === anchor) {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } else {
      window.location.hash = anchor;
    }
  }

  return (
    <section className="space-y-3" data-testid="transcript-knowledge-graph">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold tracking-tight text-[var(--color-app-subtle)] sm:text-lg">
            <Network className="h-4 w-4 text-[var(--color-accent-primary)]" />
            {t('library.localGraph.title')}
          </h2>
          <p className="max-w-2xl text-xs leading-relaxed text-[var(--color-app-muted)]">
            {t('library.localGraph.description')}
          </p>
        </div>
        {data?.focusId && (
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link to={`/grafo?focus=${encodeURIComponent(data.focusId)}`}>
              {t('library.localGraph.openGlobal')}
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
        )}
      </div>

      <Card elevated className="overflow-hidden border-[var(--color-app-border)]/80">
        <div className="flex flex-wrap gap-1 border-b border-[var(--color-app-border)] px-3 py-3 sm:px-4">
          {(['content', 'connections'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
              className={cn(
                'min-h-9 rounded-md px-3 text-xs font-medium transition-colors',
                scope === value
                  ? 'bg-violet-500/15 text-violet-200 ring-1 ring-violet-400/25'
                  : 'text-[var(--color-app-muted)] hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)]',
              )}
            >
              {t(
                value === 'content'
                  ? 'library.localGraph.contentScope'
                  : 'library.localGraph.connectionsScope',
              )}
            </button>
          ))}
        </div>

        <GraphStatus data={data} loading={loading} error={error} onRetry={refresh} />

        {data && data.nodes.length > 0 && layout && (
          <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="min-w-0 space-y-3">
              <div className="overflow-hidden rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg)]">
                <svg
                  viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
                  role="img"
                  aria-label={t('library.localGraph.canvasLabel')}
                  className="block aspect-[16/7] min-h-[260px] w-full"
                >
                  {layout.edges.map((edge) => (
                    <path
                      key={edge.id}
                      d={edgePath(edge)}
                      fill="none"
                      stroke={EDGE_COLORS[edge.kind]}
                      strokeWidth={
                        edge.id && selectedEdges.some((item) => item.id === edge.id) ? 3 : 1.5
                      }
                      opacity={
                        selectedId && !selectedEdges.some((item) => item.id === edge.id)
                          ? 0.22
                          : 0.72
                      }
                    />
                  ))}
                  {layout.nodes.map((node) => {
                    const selected = node.id === selectedId;
                    return (
                      <g
                        key={node.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`${node.label} — ${node.type}`}
                        onClick={() => setSelectedId(node.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') setSelectedId(node.id);
                        }}
                        className="cursor-pointer outline-none"
                      >
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={selected ? node.radius + 5 : node.radius}
                          fill={NODE_COLORS[node.type]}
                          stroke={selected ? '#ffffff' : 'rgba(255,255,255,0.3)'}
                          strokeWidth={selected ? 3 : 1.5}
                        />
                        <text
                          x={node.x}
                          y={node.y + node.radius + 18}
                          textAnchor="middle"
                          fill="currentColor"
                          className="fill-[var(--color-app-subtle)] text-[12px] font-medium"
                        >
                          {node.labelLines[0]}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>

              <details className="rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-3 py-2">
                <summary className="cursor-pointer text-xs font-medium text-[var(--color-app-subtle)]">
                  {t('library.localGraph.nodes')} ({data.nodes.length})
                </summary>
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  {data.nodes.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => setSelectedId(node.id)}
                      className={cn(
                        'rounded-md px-2 py-2 text-left text-xs transition-colors',
                        node.id === selectedId
                          ? 'bg-violet-500/15 text-violet-100'
                          : 'text-[var(--color-app-muted)] hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)]',
                      )}
                    >
                      <span className="block truncate font-medium">{node.label}</span>
                      <span className="uppercase tracking-wider opacity-70">{node.type}</span>
                    </button>
                  ))}
                </div>
              </details>
            </div>

            <GraphInspector
              node={selectedNode}
              edges={selectedEdges}
              allNodes={data.nodes}
              evidence={selectedEvidence}
              onSelect={setSelectedId}
              onOpenEvidence={openEvidence}
            />
          </CardContent>
        )}
      </Card>
    </section>
  );
}

function GraphStatus({
  data,
  loading,
  error,
  onRetry,
}: {
  data: TranscriptGraphResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}): React.ReactElement | null {
  const { t } = useI18n();
  if (loading && !data) {
    return (
      <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-[var(--color-app-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('library.localGraph.loading')}
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-red-300">
        <p>{t('library.localGraph.error')}</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t('common.fetchErrorRetry')}
        </Button>
      </div>
    );
  }
  if (!data) return null;
  const statusKey =
    data.state === 'NOT_INDEXED'
      ? 'library.localGraph.notIndexed'
      : data.state === 'INDEXING'
        ? 'library.localGraph.indexing'
        : data.state === 'PARTIAL'
          ? 'library.localGraph.partial'
          : data.state === 'FAILED'
            ? 'library.localGraph.failed'
            : null;
  return (
    <>
      {(statusKey || data.truncated) && (
        <div className="space-y-1 border-b border-[var(--color-app-border)] bg-violet-500/[0.04] px-4 py-3 text-xs text-[var(--color-app-muted)]">
          {statusKey && <p>{t(statusKey)}</p>}
          {data.compilation && data.compilation.totalSegments > 0 && data.state !== 'READY' && (
            <p className="font-mono text-[11px]">
              {t('library.localGraph.progress', {
                completed: data.compilation.completedSegments,
                total: data.compilation.totalSegments,
              })}
            </p>
          )}
          {data.truncated && <p>{t('library.localGraph.truncated')}</p>}
        </div>
      )}
      {data.nodes.length === 0 && (
        <div className="flex min-h-40 items-center justify-center px-4 text-center text-sm text-[var(--color-app-muted)]">
          {t(
            data.state === 'NOT_INDEXED'
              ? 'library.localGraph.notIndexed'
              : 'library.localGraph.empty',
          )}
        </div>
      )}
    </>
  );
}

function GraphInspector({
  node,
  edges,
  allNodes,
  evidence,
  onSelect,
  onOpenEvidence,
}: {
  node: GraphNode | null;
  edges: GraphEdge[];
  allNodes: GraphNode[];
  evidence: TranscriptGraphEvidence[];
  onSelect: (id: string) => void;
  onOpenEvidence: (anchor: string) => void;
}): React.ReactElement {
  const { t } = useI18n();
  if (!node) {
    return (
      <aside className="rounded-xl border border-[var(--color-app-border)] p-4 text-xs text-[var(--color-app-muted)]">
        {t('library.localGraph.selectNode')}
      </aside>
    );
  }
  const byId = new Map(allNodes.map((item) => [item.id, item]));
  return (
    <aside className="min-w-0 space-y-4 rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)] p-4">
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-app-muted)]">
          {t('library.localGraph.inspector')}
        </p>
        <h3 className="break-words text-sm font-semibold text-[var(--color-app-fg)]">
          {node.label}
        </h3>
        <p className="text-[10px] uppercase tracking-wider text-[var(--color-app-muted)]">
          {node.type}
        </p>
        {node.description && (
          <p className="line-clamp-5 text-xs leading-relaxed text-[var(--color-app-muted)]">
            {node.description}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-app-muted)]">
          {t('library.localGraph.relations')} ({edges.length})
        </p>
        {edges.slice(0, 8).map((edge) => {
          const neighborId = edge.from === node.id ? edge.to : edge.from;
          const neighbor = byId.get(neighborId);
          if (!neighbor) return null;
          return (
            <button
              key={edge.id}
              type="button"
              onClick={() => onSelect(neighbor.id)}
              className="block w-full rounded-md border border-[var(--color-app-border)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--color-app-surface-hover)]"
            >
              <span className="block truncate text-xs text-[var(--color-app-subtle)]">
                {neighbor.label}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-[var(--color-app-muted)]">
                {edge.kind.replaceAll('_', ' ')} · {Math.round(Number(edge.confidence) * 100)}%
              </span>
            </button>
          );
        })}
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-app-muted)]">
          {t('library.localGraph.evidence')} ({evidence.length})
        </p>
        {evidence.length === 0 && (
          <p className="text-xs leading-relaxed text-[var(--color-app-muted)]">
            {t('library.localGraph.noEvidence')}
          </p>
        )}
        {evidence.slice(0, 6).map((item) => (
          <div key={item.id} className="rounded-md border border-[var(--color-app-border)] p-2.5">
            {item.excerpt && (
              <p className="line-clamp-4 text-xs leading-relaxed text-[var(--color-app-subtle)]">
                “{item.excerpt}”
              </p>
            )}
            {item.anchor && item.sourceType === 'TRANSCRIPT' && (
              <button
                type="button"
                onClick={() => onOpenEvidence(item.anchor!)}
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-violet-300 hover:text-violet-200"
              >
                <FileText className="h-3 w-3" />
                {t('library.localGraph.openEvidence')}
              </button>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
