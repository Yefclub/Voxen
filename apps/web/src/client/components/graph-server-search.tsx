import { Search, X } from '@/components/ui/icons';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';
import type { GraphNode } from '../lib/graph-model';
import type { TranslateFn } from '../lib/i18n';

export function GraphServerSearch({
  query,
  results,
  loading,
  focusedId,
  translate,
  onQueryChange,
  onSelect,
  onClearFocus,
}: {
  query: string;
  results: GraphNode[];
  loading: boolean;
  focusedId: string | null;
  translate: TranslateFn;
  onQueryChange: (query: string) => void;
  onSelect: (node: GraphNode) => void;
  onClearFocus: () => void;
}): React.ReactElement {
  const showResults = query.trim().length >= 2 && (loading || results.length > 0);
  return (
    <>
      <div className="relative min-w-[190px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-app-muted)]" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          aria-label={translate('graph.serverSearchPlaceholder')}
          placeholder={translate('graph.serverSearchPlaceholder')}
          className="h-10 w-full rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg)] pl-9 pr-9 text-sm text-[var(--color-app-fg)] outline-none transition focus:border-[var(--color-accent-violet)]/55 focus:ring-2 focus:ring-[var(--color-accent-violet-soft)]"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--color-app-muted)] hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)]"
            aria-label={translate('graph.clearSearch')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {showResults && (
          <div
            role="listbox"
            data-testid="graph-server-search-results"
            className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-40 max-h-72 overflow-y-auto rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] p-1.5 shadow-xl"
          >
            {loading && results.length === 0 && (
              <div className="flex h-12 items-center justify-center">
                <Spinner size={14} />
              </div>
            )}
            {results.map((node) => (
              <button
                key={node.id}
                type="button"
                role="option"
                aria-selected={node.id === focusedId}
                onClick={() => onSelect(node)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-[var(--color-app-surface-hover)]"
              >
                <Search className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent-violet)]" />
                <span className="min-w-0 flex-1 truncate text-sm">{node.label}</span>
                <span className="text-[10px] uppercase tracking-wide text-[var(--color-app-muted)]">
                  {node.type}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {focusedId && (
        <Button
          variant="outline"
          size="default"
          data-testid="graph-clear-server-focus"
          onClick={onClearFocus}
          title={translate('graph.clearSearch')}
        >
          <X className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{translate('graph.focusCore')}</span>
        </Button>
      )}
    </>
  );
}
