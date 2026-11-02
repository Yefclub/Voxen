import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, FileText, Loader2, Network, Search } from '@/components/ui/icons';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { KnowledgeGraphCanvas } from '../graph/knowledge-graph-canvas';
import { useFetch } from '../../lib/hooks';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-provider';
import {
  buildSigmaGraphModel,
  resolveGraphPalette,
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

export function TranscriptKnowledgeGraph({
  transcriptId,
}: {
  transcriptId: string;
}): React.ReactElement {
  const { t } = useI18n();
  const { theme } = useTheme();
  const [scope, setScope] = useState<TranscriptGraphScope>('content');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, loading, error, refresh } = useFetch<TranscriptGraphResponse>(
    `/api/transcripts/${transcriptId}/graph?scope=${scope}&hops=${scope === 'connections' ? 2 : 1}`,
  );
  const palette = useMemo(() => resolveGraphPalette(theme), [theme]);
  const model = useMemo(
    () => (data ? buildSigmaGraphModel(data, t, {}, palette) : null),
    [data, palette, t],
  );
  const selectedNode = data?.nodes.find((node) => node.id === selectedId) ?? null;
  const selectNode = useCallback((id: string | null) => setSelectedId(id), []);
  const openNode = useCallback((node: GraphNode) => setSelectedId(node.id), []);
  const selectedEdges = useMemo(
    () => data?.edges.filter((edge) => edge.from === selectedId || edge.to === selectedId) ?? [],
    [data, selectedId],
  );
  const selectedEvidence = useMemo(() => {
    const ids = new Set(selectedEdges.map((edge) => edge.id));
    return (
      data?.evidence.filter(
        (item) => item.nodeId === selectedId || Boolean(item.edgeId && ids.has(item.edgeId)),
      ) ?? []
    );
  }, [data, selectedEdges, selectedId]);
  function openEvidence(anchor: string): void {
    if (window.location.hash === anchor) window.dispatchEvent(new HashChangeEvent('hashchange'));
    else window.location.hash = anchor;
  }
  return (
    <section
      data-testid="transcript-knowledge-graph"
      aria-labelledby="content-graph-heading"
      className="local-graph-shell min-w-0 space-y-3"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2
          id="content-graph-heading"
          className="flex min-w-0 items-center gap-2 text-sm font-semibold"
        >
          <Network className="h-4 w-4 shrink-0 text-[var(--color-app-muted)]" />
          <span>{t('library.localGraph.title')}</span>
          {data && (
            <span className="text-xs font-normal tabular-nums text-[var(--color-app-muted)]">
              {data.nodes.length} {t('graph.nodes')}
            </span>
          )}
        </h2>
        <div className="flex min-w-0 items-center gap-1">
          <Select value={scope} onValueChange={(value) => setScope(value as TranscriptGraphScope)}>
            <SelectTrigger
              aria-label={t('library.localGraph.scope')}
              className="h-8 w-auto gap-2 border-transparent bg-transparent px-2 text-xs shadow-none"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="content">{t('library.localGraph.contentScope')}</SelectItem>
              <SelectItem value="connections">
                {t('library.localGraph.connectionsScope')}
              </SelectItem>
            </SelectContent>
          </Select>
          {data?.focusId && (
            <Button asChild variant="ghost" size="sm" className="text-xs">
              <Link to={`/grafo?focus=${encodeURIComponent(data.focusId)}`}>
                <span className="hidden sm:inline">{t('library.localGraph.openGlobal')}</span>
                <span className="sr-only sm:hidden">{t('library.localGraph.openGlobal')}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </Button>
          )}
        </div>
      </header>
      <GraphStatus data={data} loading={loading} error={error} onRetry={refresh} />
      {model && data && data.nodes.length > 0 && (
        <div
          data-local-graph-workspace
          className="local-graph-workspace grid min-w-0 grid-cols-1 overflow-hidden rounded-xl border border-[var(--color-app-border)]"
        >
          <div
            data-local-graph-map
            className="local-graph-map relative h-[300px] min-h-0 min-w-0 bg-[var(--color-app-bg)]"
          >
            <KnowledgeGraphCanvas
              model={model}
              selectedId={selectedNode?.id ?? null}
              palette={palette}
              translate={t}
              onSelect={selectNode}
              onOpen={openNode}
            />
          </div>
          <div
            data-local-graph-inspector
            className="local-graph-inspector h-[260px] min-h-0 overflow-hidden border-t border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]"
          >
            <GraphInspector
              transcriptId={transcriptId}
              node={selectedNode}
              edges={selectedEdges}
              allNodes={data.nodes}
              evidence={selectedEvidence}
              onSelect={selectNode}
              onOpenEvidence={openEvidence}
            />
          </div>
        </div>
      )}
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
      <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-[var(--color-app-danger)]">
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
        <div className="space-y-1 rounded-lg bg-[var(--color-app-surface)] px-3 py-2 text-xs text-[var(--color-app-muted)]">
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
  transcriptId,
  node,
  edges,
  allNodes,
  evidence,
  onSelect,
  onOpenEvidence,
}: {
  transcriptId: string;
  node: GraphNode | null;
  edges: GraphEdge[];
  allNodes: GraphNode[];
  evidence: TranscriptGraphEvidence[];
  onSelect: (id: string | null) => void;
  onOpenEvidence: (anchor: string) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<'details' | 'nodes' | null>(null);
  const returnNode = useRef<string | null>(null);
  useEffect(() => {
    const destination = pendingFocus.current;
    pendingFocus.current = null;
    if (destination === 'details') headingRef.current?.focus({ preventScroll: true });
    if (destination === 'nodes') {
      const target = Array.from(
        listRef.current?.querySelectorAll<HTMLButtonElement>('[data-node-id]') ?? [],
      ).find((button) => button.dataset.nodeId === returnNode.current);
      (target ?? listRef.current?.querySelector('input'))?.focus({ preventScroll: true });
    }
  }, [node]);
  function chooseNode(id: string): void {
    pendingFocus.current = 'details';
    onSelect(id);
  }
  const byId = new Map(allNodes.map((item) => [item.id, item]));
  const filteredNodes = allNodes.filter((item) =>
    item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <section
      aria-label={t('library.localGraph.inspector')}
      className="flex h-full min-h-0 flex-col"
    >
      <header className="flex h-12 shrink-0 items-center border-b border-[var(--color-app-border)] px-3">
        {node ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              returnNode.current = node.id;
              pendingFocus.current = 'nodes';
              onSelect(null);
            }}
            className="-ml-1 gap-1.5 text-xs"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('library.localGraph.backToNodes')}
          </Button>
        ) : (
          <h3 className="flex w-full items-center justify-between text-xs font-medium">
            {t('library.localGraph.nodes')}
            <span className="font-normal tabular-nums text-[var(--color-app-muted)]">
              {allNodes.length}
            </span>
          </h3>
        )}
      </header>
      <div
        ref={listRef}
        key={node?.id ?? 'nodes'}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"
      >
        {!node ? (
          <>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--color-app-muted)]" />
              <input
                aria-label={t('library.localGraph.searchNodes')}
                placeholder={t('library.localGraph.searchNodes')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-9 w-full rounded-lg border border-[var(--color-app-border)] bg-transparent pl-8 pr-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
              />
            </div>
            <div className="space-y-0.5">
              {filteredNodes.map((item) => (
                <Button
                  key={item.id}
                  variant="ghost"
                  data-node-id={item.id}
                  onClick={() => chooseNode(item.id)}
                  className="h-auto w-full justify-start whitespace-normal px-2 py-2 text-left text-xs font-normal active:scale-100"
                >
                  <span className="min-w-0 break-words">
                    <span className="line-clamp-2">{item.label}</span>
                    <span className="mt-0.5 block text-[11px] text-[var(--color-app-muted)]">
                      {t(`graph.node.${item.type}`)}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
            {filteredNodes.length === 0 && (
              <p className="py-4 text-xs text-[var(--color-app-muted)]">{t('graph.noMatches')}</p>
            )}
          </>
        ) : (
          <div className="space-y-5">
            <div>
              <h3
                ref={headingRef}
                tabIndex={-1}
                className="break-words text-sm font-semibold leading-relaxed outline-none"
              >
                {node.label}
              </h3>
              <p className="mt-1 text-xs text-[var(--color-app-muted)]">
                {t(`graph.node.${node.type}`)}
              </p>
              {node.description && (
                <p className="mt-3 break-words text-xs leading-relaxed text-[var(--color-app-subtle)]">
                  {node.description}
                </p>
              )}
            </div>
            <section
              className="border-t border-[var(--color-app-border)] pt-4"
              aria-label={t('library.localGraph.relations')}
            >
              <h4 className="mb-2 flex items-center justify-between text-xs font-medium">
                {t('library.localGraph.relations')}
                <span className="font-normal tabular-nums text-[var(--color-app-muted)]">
                  {edges.length}
                </span>
              </h4>
              {edges.map((edge) => {
                const neighbor = byId.get(edge.from === node.id ? edge.to : edge.from);
                return neighbor ? (
                  <Button
                    key={edge.id}
                    variant="ghost"
                    onClick={() => chooseNode(neighbor.id)}
                    className="h-auto w-full justify-start whitespace-normal px-0 py-2 text-left text-xs font-normal active:scale-100"
                  >
                    <span className="min-w-0 break-words">
                      <span className="block">{neighbor.label}</span>
                      <span className="mt-0.5 block text-[11px] text-[var(--color-app-muted)]">
                        {t(`graph.edge.${edge.kind}`)} · {Math.round(Number(edge.confidence) * 100)}
                        %
                      </span>
                    </span>
                  </Button>
                ) : null;
              })}
            </section>
            <section
              className="border-t border-[var(--color-app-border)] pt-4"
              aria-label={t('library.localGraph.evidence')}
            >
              <h4 className="mb-3 flex items-center justify-between text-xs font-medium">
                {t('library.localGraph.evidence')}
                <span className="font-normal tabular-nums text-[var(--color-app-muted)]">
                  {evidence.length}
                </span>
              </h4>
              {evidence.length === 0 && (
                <p className="text-xs leading-relaxed text-[var(--color-app-muted)]">
                  {t('library.localGraph.noEvidence')}
                </p>
              )}
              <div className="divide-y divide-[var(--color-app-border)]">
                {evidence.map((item) => (
                  <div key={item.id} className="py-3 first:pt-0">
                    {item.excerpt && (
                      <blockquote className="break-words text-xs leading-relaxed text-[var(--color-app-subtle)]">
                        {item.excerpt}
                      </blockquote>
                    )}
                    {item.anchor &&
                      item.sourceType === 'TRANSCRIPT' &&
                      item.sourceId === transcriptId && (
                        <Button
                          size="sm"
                          variant="link"
                          onClick={() => onOpenEvidence(item.anchor!)}
                          className="mt-2 text-xs"
                        >
                          <FileText className="h-3 w-3" />
                          {t('library.localGraph.openEvidence')}
                        </Button>
                      )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </section>
  );
}
