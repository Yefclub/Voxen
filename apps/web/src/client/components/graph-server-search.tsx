import { useState } from 'react';
import { Combobox } from '@base-ui/react/combobox';
import { Search, X } from '@/components/ui/icons';
import { Button } from './ui/button';
import { IconButton } from './ui/icon-button';
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
  onQueryChange: (value: string) => void;
  onSelect: (node: GraphNode) => void;
  onClearFocus: () => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-w-0 flex-1 basis-full items-center gap-2 sm:basis-52">
      <Combobox.Root<GraphNode>
        items={results}
        filter={null}
        value={null}
        inputValue={query}
        itemToStringLabel={(node) => node.label}
        onInputValueChange={(value, details) => {
          if (details.reason !== 'item-press') onQueryChange(value);
        }}
        onValueChange={(node) => {
          if (node) {
            onSelect(node);
            setOpen(false);
          }
        }}
        open={open && query.trim().length >= 2}
        onOpenChange={setOpen}
        autoHighlight
      >
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-app-muted)]" />
          <Combobox.Input
            aria-label={translate('graph.serverSearchPlaceholder')}
            placeholder={translate('graph.serverSearchPlaceholder')}
            className="h-9 w-full rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg)] pl-9 pr-9 text-sm text-[var(--color-app-fg)] outline-none placeholder:text-[var(--color-app-muted)] focus-visible:ring-2 focus-visible:ring-violet-500/40"
          />
          {query && (
            <IconButton
              onClick={() => onQueryChange('')}
              label={translate('graph.clearSearch')}
              className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
            >
              <X className="h-3.5 w-3.5" />
            </IconButton>
          )}
        </div>
        <Combobox.Portal>
          <Combobox.Positioner
            sideOffset={6}
            collisionPadding={12}
            className="z-50 w-[var(--anchor-width)]"
          >
            <Combobox.Popup className="base-popup origin-[var(--transform-origin)] overflow-hidden rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] p-1 text-[var(--color-app-fg)] shadow-lg">
              {loading && results.length === 0 && (
                <Combobox.Status className="flex h-12 items-center justify-center gap-2 text-xs text-[var(--color-app-muted)]">
                  <Spinner size={14} />
                  {translate('graph.loading')}
                </Combobox.Status>
              )}
              <Combobox.List
                data-testid="graph-server-search-results"
                className="max-h-72 overflow-y-auto outline-none"
              >
                {(node: GraphNode) => (
                  <Combobox.Item
                    key={node.id}
                    value={node}
                    className="flex cursor-pointer items-start justify-between gap-3 rounded-lg px-3 py-2 text-left outline-none data-[highlighted]:bg-[var(--color-app-surface-hover)]"
                  >
                    <span className="min-w-0 break-words text-xs leading-relaxed">
                      {node.label}
                    </span>
                    <span className="shrink-0 text-[11px] text-[var(--color-app-muted)]">
                      {translate(`graph.node.${node.type}`)}
                    </span>
                  </Combobox.Item>
                )}
              </Combobox.List>
              {!loading && (
                <Combobox.Empty className="px-3 py-4 text-xs text-[var(--color-app-muted)]">
                  {translate('graph.noMatches')}
                </Combobox.Empty>
              )}
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
      {focusedId && (
        <Button
          variant="ghost"
          size="icon"
          data-testid="graph-clear-server-focus"
          onClick={onClearFocus}
          aria-label={translate('graph.clearFocus')}
          title={translate('graph.clearFocus')}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
