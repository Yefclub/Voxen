import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, Tags } from '@/components/ui/icons';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { useFetch } from '../../lib/hooks';
import type { TranslateFn } from '../../lib/i18n';

const TAG_DISCOVERY_PAGE_SIZE = 24;

interface LibraryTag {
  id: string;
  name: string;
  slug: string;
  count: number;
}

interface TagsResponse {
  tags: LibraryTag[];
  total: number;
  limit: number;
  offset: number;
  query: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'TRASH' | 'ALL';
  hasMore: boolean;
  selectedTag: Pick<LibraryTag, 'id' | 'name' | 'slug'> | null;
}

type StatusFilter = 'active' | 'archived' | 'trash';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function mergeById<T extends { id: string }>(previous: T[], next: T[]): T[] {
  const seen = new Set(previous.map((item) => item.id));
  return [...previous, ...next.filter((item) => !seen.has(item.id))];
}

export function TagFilterMenu({
  active,
  activeTagId,
  selectedTag,
  status,
  onSelect,
  translate,
}: {
  active: boolean;
  activeTagId: string | null;
  selectedTag: Pick<LibraryTag, 'id' | 'name' | 'slug'> | null;
  status: StatusFilter;
  onSelect: (id: string) => void;
  translate: TranslateFn;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [tags, setTags] = useState<LibraryTag[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const debouncedQuery = useDebounced(query, 200);
  const normalizedQuery = debouncedQuery.trim().slice(0, 120);
  const listUrl = useMemo(() => {
    if (!open) return null;
    const params = new URLSearchParams({
      limit: String(TAG_DISCOVERY_PAGE_SIZE),
      offset: String(offset),
      status,
    });
    if (activeTagId) params.set('selectedId', activeTagId);
    if (normalizedQuery) params.set('q', normalizedQuery);
    return `/api/library/tags?${params.toString()}`;
  }, [activeTagId, normalizedQuery, offset, open, status]);
  const { data, loading, error } = useFetch<TagsResponse>(listUrl);

  useEffect(() => {
    if (
      !data ||
      data.offset !== offset ||
      data.query !== normalizedQuery ||
      data.status !== status.toUpperCase()
    )
      return;
    setTags((previous) => (offset === 0 ? data.tags : mergeById(previous, data.tags)));
    setHasMore(data.hasMore);
  }, [data, normalizedQuery, offset, status]);

  function handleOpenChange(next: boolean): void {
    setOpen(next);
    setOffset(0);
    setTags([]);
    setHasMore(false);
    if (!next) setQuery('');
  }

  function setSearchQuery(next: string): void {
    setQuery(next);
    setOffset(0);
    setTags([]);
    setHasMore(false);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={translate('library.filterTags')}
          aria-label={translate('library.filterTags')}
          aria-pressed={active}
          className={[
            'inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40',
            active
              ? 'border-[var(--color-app-border-strong)] bg-[var(--color-app-surface-hover)] text-[var(--color-app-fg)]'
              : 'border-transparent bg-[var(--color-app-surface)] text-[var(--color-app-muted)] hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-subtle)]',
          ].join(' ')}
        >
          <Search className="h-3 w-3 shrink-0" />
          <span className="max-w-[160px] truncate">
            {active && selectedTag ? selectedTag.name : translate('library.filterTags')}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0">
        <div className="border-b border-[var(--color-app-border)] p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--color-app-muted)]" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={translate('library.tagSearchPlaceholder')}
              aria-label={translate('library.tagSearchLabel')}
              autoComplete="off"
              spellCheck={false}
              className="h-8 w-full rounded-md border border-[var(--color-app-border)] bg-[var(--color-app-bg)] pl-7 pr-2 text-xs text-[var(--color-app-fg)] placeholder:text-[var(--color-app-muted)] focus:outline-none focus:border-zinc-500/60"
            />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {loading && tags.length === 0 && (
            <div className="flex justify-center px-2 py-4">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--color-app-muted)]" />
            </div>
          )}
          {!loading && error && (
            <p className="px-2 py-3 text-center text-[11px] text-[var(--color-app-muted)]">
              {translate('library.tagLoadError')}
            </p>
          )}
          {!loading && !error && tags.length === 0 && (
            <p className="px-2 py-3 text-center text-[11px] text-[var(--color-app-muted)]">
              {translate('library.tagSearchEmpty')}
            </p>
          )}
          {tags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              aria-pressed={activeTagId === tag.id}
              onClick={() => {
                onSelect(tag.id);
                setOpen(false);
              }}
              className={[
                'flex min-h-11 w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40',
                activeTagId === tag.id
                  ? 'bg-[var(--color-app-surface-hover)] text-[var(--color-app-fg)]'
                  : 'text-[var(--color-app-subtle)] hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)]',
              ].join(' ')}
            >
              <Tags className="h-3 w-3 shrink-0 text-violet-400" />
              <span className="min-w-0 flex-1 truncate">{tag.name}</span>
              <span className="shrink-0 tabular-nums text-[10px] text-[var(--color-app-muted)]">
                {tag.count}
              </span>
            </button>
          ))}
          {hasMore && (
            <button
              type="button"
              disabled={loading}
              onClick={() => setOffset(tags.length)}
              className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[11px] text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)] disabled:opacity-60"
            >
              {loading && <Loader2 className="h-3 w-3 animate-spin" />}
              {translate('library.loadMore')}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
