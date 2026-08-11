import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  Inbox,
  Library,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Network,
  Search,
  SlidersHorizontal,
  Sparkles,
  Tags,
  Trash2,
  Type,
  X,
} from '@/components/ui/icons';
import { toast } from '@/lib/toast';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Button } from '../components/ui/button';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { FetchError } from '../components/ui/fetch-error';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { apiPost } from '../lib/api';
import { useFetch } from '../lib/hooks';
import { formatDuration, formatRelative, formatUsd } from '../lib/format';
import {
  filterFoldersByQuery,
  LIBRARY_FOLDER_CHIP_LIMIT,
  splitFolderChips,
} from '../lib/library-folders';
import {
  groupByCaptureWeek,
  libraryWeekBounds,
  type LibraryPeriod,
} from '../lib/library-organization';
import { PageHeader, PageShell } from '../components/ui/page-shell';
import { ContentIngestCard } from '../components/ingest/content-ingest-card';
import { LibrarySearch } from '../components/library/library-search';
import { TagFilterMenu } from '../components/library/tag-filter-menu';
import { useI18n, type Locale, type TranslateFn } from '../lib/i18n';
import { resolveTranscriptPreviewSrc } from '../lib/preview-src';
import { sourceHostname } from '../lib/source-url';
import {
  buildLibraryPageItems,
  isCurrentLibraryResponse,
  libraryPageStateFromParams,
  normalizeLibraryRequestQuery,
  updateLibraryParams,
} from '../lib/library-query-state';

const PAGE_SIZE = 24;
const TAG_CHIP_LIMIT = 6;

interface TranscriptSummary {
  id: string;
  source: 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK' | 'X' | 'WEB' | 'UPLOAD';
  url: string;
  title: string;
  channel: string | null;
  durationSec: number;
  language: string;
  transcriptionMethod: 'API' | 'SUBTITLES' | 'SCRAPE' | 'VISION' | 'DOCUMENT' | 'X_SEARCH';
  thumbnailUrl: string | null;
  costUsd: string | null;
  folderId: string | null;
  folder: { id: string; name: string } | null;
  tags: { id: string; name: string; slug: string }[];
  status: 'ACTIVE' | 'ARCHIVED' | 'TRASH';
  createdAt: string;
  snippet?: string;
  graphMatch?: boolean;
}

interface SearchResponse {
  transcripts: TranscriptSummary[];
  query: string;
  total?: number;
  limit?: number;
  offset?: number;
  hasMore?: boolean;
}

interface LibraryFolder {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
  _count: { transcripts: number; children: number };
}

interface FoldersResponse {
  folders: LibraryFolder[];
}

interface LibraryTag {
  id: string;
  name: string;
  slug: string;
  count: number;
}

type LibraryTagIdentity = Pick<LibraryTag, 'id' | 'name' | 'slug'>;

interface TagsResponse {
  tags: LibraryTag[];
  total: number;
  limit: number;
  offset: number;
  query: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'TRASH' | 'ALL';
  hasMore: boolean;
  selectedTag: LibraryTagIdentity | null;
}

type StatusFilter = 'active' | 'archived' | 'trash';
/** null = todas; 'none' = sem pasta; string = id da pasta */
type FolderFilter = string | null;

function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function TranscricoesPage(): React.ReactElement {
  const { locale, t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const status = normalizeStatusFilter(searchParams.get('status'));
  const inbox = searchParams.get('view') === 'inbox';
  const folderFilter = inbox ? null : normalizeFolderFilter(searchParams.get('folderId'));
  const tagFilter = normalizeTagFilter(searchParams.get('tagId'));
  const period = normalizePeriodFilter(searchParams.get('period'));
  const q = normalizeSearchQuery(searchParams.get('q'));
  const pageState = libraryPageStateFromParams(searchParams);
  const currentPage = pageState.page;
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [reorganizing, setReorganizing] = useState(false);
  const [regeneratingTitles, setRegeneratingTitles] = useState(false);
  const [generatingTags, setGeneratingTags] = useState(false);
  const [clearingFolders, setClearingFolders] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [confirmRetitleOpen, setConfirmRetitleOpen] = useState(false);
  const debouncedQ = useDebounced(q, 250);
  const requestQ = normalizeLibraryRequestQuery(debouncedQ);
  const periodBounds = useMemo(() => libraryWeekBounds(period), [period]);
  const offset = (currentPage - 1) * PAGE_SIZE;

  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (requestQ) params.set('q', requestQ);
    if (status !== 'active') params.set('status', status);
    if (inbox) params.set('view', 'inbox');
    else if (folderFilter === 'none') params.set('folderId', 'none');
    else if (folderFilter) params.set('folderId', folderFilter);
    if (tagFilter) params.set('tagId', tagFilter);
    if (period !== 'all') params.set('period', period);
    if (periodBounds) {
      params.set('from', periodBounds.from);
      params.set('to', periodBounds.to);
    }
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));
    return `/api/transcripts?${params.toString()}`;
  }, [folderFilter, inbox, offset, period, periodBounds, requestQ, status, tagFilter]);

  const {
    data,
    resolvedPath,
    loading,
    error,
    refresh: refreshTranscripts,
  } = useFetch<SearchResponse>(listUrl);
  const { data: foldersData, refresh: refreshFolders } =
    useFetch<FoldersResponse>('/api/library/folders');
  const tagParams = new URLSearchParams({ limit: String(TAG_CHIP_LIMIT), status });
  if (tagFilter) tagParams.set('selectedId', tagFilter);
  const { data: tagsData, refresh: refreshTags } = useFetch<TagsResponse>(
    `/api/library/tags?${tagParams.toString()}`,
  );
  const folders = foldersData?.folders ?? [];
  const tags = tagsData?.tags ?? [];
  const tagTotal = tagsData?.total ?? tags.length;
  const selectedTag = tagsData?.selectedTag ?? tags.find((tag) => tag.id === tagFilter) ?? null;
  const isSearching = requestQ.length > 0;
  const queryChanging = q !== debouncedQ;
  const responseMatches = isCurrentLibraryResponse({
    resolvedPath,
    requestedPath: listUrl,
    responseQuery: data?.query,
    requestedQuery: requestQ,
    responseOffset: data?.offset,
    requestedOffset: offset,
  });
  const items = responseMatches ? (data?.transcripts ?? []) : [];
  const total = responseMatches ? (data?.total ?? items.length) : 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    if (pageState.isCanonical) return;
    setSearchParams(
      updateLibraryParams(searchParams, { page: pageState.page }, { resetPage: false }),
      { replace: true },
    );
  }, [pageState.isCanonical, pageState.page, searchParams, setSearchParams]);

  useEffect(() => {
    if (!responseMatches || currentPage <= totalPages) return;
    setSearchParams(updateLibraryParams(searchParams, { page: totalPages }, { resetPage: false }), {
      replace: true,
    });
  }, [currentPage, responseMatches, searchParams, setSearchParams, totalPages]);

  function patchFilters(
    patch: Parameters<typeof updateLibraryParams>[1],
    options: { replace?: boolean } = {},
  ): void {
    setSearchParams(updateLibraryParams(searchParams, patch), {
      replace: options.replace ?? false,
    });
  }

  function setQuery(next: string): void {
    patchFilters({ q: next.slice(0, 240) }, { replace: true });
  }

  function setStatus(next: StatusFilter): void {
    patchFilters({ status: next === 'active' ? null : next });
  }

  function setFolder(next: FolderFilter): void {
    patchFilters({ view: null, folderId: next });
  }

  function setInbox(next: boolean): void {
    patchFilters({ view: next ? 'inbox' : null, folderId: null });
  }

  function setTag(next: string | null): void {
    patchFilters({ tagId: next });
  }

  function setPeriod(next: LibraryPeriod): void {
    patchFilters({ period: next === 'all' ? null : next });
  }

  function setPage(next: number): void {
    const page = Math.min(totalPages, Math.max(1, Math.floor(next)));
    setSearchParams(updateLibraryParams(searchParams, { page }, { resetPage: false }), {
      replace: false,
    });
    document
      .getElementById('library-results')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function clearFilters(): void {
    setSearchParams(
      updateLibraryParams(searchParams, {
        q: null,
        page: null,
        period: null,
        status: null,
        view: null,
        folderId: null,
        tagId: null,
      }),
      { replace: false },
    );
  }

  async function createFolder(): Promise<void> {
    const name = newFolderName.trim();
    if (!name || creatingFolder) return;
    setCreatingFolder(true);
    try {
      const body = await apiPost<{ folder: LibraryFolder }>('/api/library/folders', { name });
      setNewFolderName('');
      refreshFolders();
      setFolder(body.folder.id);
      toast.success(t('library.folderSaved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('library.folderError'));
    } finally {
      setCreatingFolder(false);
    }
  }

  async function clearAllFolders(): Promise<void> {
    if (clearingFolders || folders.length === 0) return;
    setClearingFolders(true);
    try {
      const body = await apiPost<{ deleted: number; affectedTranscripts: number }>(
        '/api/library/folders/clear',
      );
      toast.success(
        t('library.clearFoldersDone', {
          deleted: body.deleted,
          items: body.affectedTranscripts,
        }),
      );
      setFolder(null);
      refreshFolders();
      refreshTags();
      refreshTranscripts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('library.clearFoldersError'));
    } finally {
      setClearingFolders(false);
    }
  }

  async function reorganizeWithAi(): Promise<void> {
    if (reorganizing) return;
    setReorganizing(true);
    let totalAssigned = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    try {
      for (let i = 0; i < 20; i++) {
        const body = await apiPost<{
          processed: number;
          assigned: number;
          skipped: number;
          failed: number;
          remaining: number;
          pendingTotal: number;
        }>('/api/library/reorganize', { limit: 15 });
        totalAssigned += body.assigned;
        totalFailed += body.failed;
        totalSkipped += body.skipped;
        if (body.pendingTotal === 0 && body.processed === 0) {
          toast.message(t('library.reorgNothing'));
          break;
        }
        if (body.remaining === 0) {
          toast.success(
            t('library.reorgDone', {
              assigned: totalAssigned,
              skipped: totalSkipped,
              failed: totalFailed,
            }),
          );
          break;
        }
        if (i === 19) {
          toast.success(
            t('library.reorgPartial', {
              assigned: totalAssigned,
              remaining: body.remaining,
            }),
          );
        }
      }
      refreshFolders();
      refreshTags();
      patchFilters({ page: null }, { replace: true });
      refreshTranscripts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('library.reorgError'));
    } finally {
      setReorganizing(false);
    }
  }

  // Gera tags via IA só para conteúdo sem tag, drenando em lotes. Custa créditos
  // (1 chamada de IA por conteúdo). Cada tag também vira/reaproveita uma pasta.
  async function generateTagsBatch(): Promise<void> {
    if (generatingTags) return;
    setGeneratingTags(true);
    let totalTagged = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    try {
      for (let i = 0; i < 30; i++) {
        const body = await apiPost<{
          processed: number;
          tagged: number;
          skipped: number;
          failed: number;
          remaining: number;
          pendingTotal: number;
        }>('/api/library/generate-tags', { limit: 10 });
        totalTagged += body.tagged;
        totalSkipped += body.skipped;
        totalFailed += body.failed;
        if (body.pendingTotal === 0 && body.processed === 0) {
          toast.message(t('library.tagsNothing'));
          break;
        }
        if (body.remaining === 0) {
          toast.success(
            t('library.tagsDone', {
              tagged: totalTagged,
              skipped: totalSkipped,
              failed: totalFailed,
            }),
          );
          break;
        }
        if (i === 29) {
          toast.success(
            t('library.tagsPartial', { tagged: totalTagged, remaining: body.remaining }),
          );
        }
      }
      refreshFolders();
      refreshTags();
      patchFilters({ page: null }, { replace: true });
      refreshTranscripts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('library.tagsError'));
    } finally {
      setGeneratingTags(false);
    }
  }

  // Regenera os títulos via IA drenando a Base de conhecimento por cursor. Custa créditos
  // (1 chamada LLM por conteúdo); títulos já bons voltam KEEP e são mantidos.
  async function regenerateTitles(): Promise<void> {
    if (regeneratingTitles) return;
    setRegeneratingTitles(true);
    let totalChanged = 0;
    let totalKept = 0;
    let totalFailed = 0;
    let cursor: string | null = null;
    try {
      for (let i = 0; i < 60; i++) {
        const body: {
          processed: number;
          changed: number;
          kept: number;
          skipped: number;
          failed: number;
          pendingTotal: number;
          nextCursor: string | null;
        } = await apiPost('/api/library/regenerate-titles', { limit: 15, cursor });
        totalChanged += body.changed;
        totalKept += body.kept;
        totalFailed += body.failed;
        if (i === 0 && body.pendingTotal === 0) {
          toast.message(t('library.retitleNothing'));
          break;
        }
        // Falha sistêmica (ex.: chave da OpenRouter inválida): o lote inteiro
        // falhou. Aborta em vez de gastar créditos rodando os 60 lotes.
        if (body.processed > 0 && body.failed === body.processed) {
          toast.error(t('library.retitleError'));
          break;
        }
        cursor = body.nextCursor;
        if (!cursor) {
          toast.success(
            t('library.retitleDone', {
              changed: totalChanged,
              kept: totalKept,
              failed: totalFailed,
            }),
          );
          break;
        }
        if (i === 59) {
          toast.success(t('library.retitlePartial', { changed: totalChanged }));
        }
      }
      patchFilters({ page: null }, { replace: true });
      refreshTranscripts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('library.retitleError'));
    } finally {
      setRegeneratingTitles(false);
    }
  }

  const pageLoading = loading && !responseMatches;
  const sortedFolders = useMemo(
    () => [...folders].sort((a, b) => a.name.localeCompare(b.name, locale)),
    [folders, locale],
  );
  const { visible: visibleFolders, overflow: overflowFolders } = useMemo(
    () => splitFolderChips(sortedFolders, LIBRARY_FOLDER_CHIP_LIMIT),
    [sortedFolders],
  );
  const activeFolderHidden =
    folderFilter !== null &&
    folderFilter !== 'none' &&
    overflowFolders.some((folder) => folder.id === folderFilter);
  const selectedFolder =
    typeof folderFilter === 'string' && folderFilter !== 'none'
      ? (sortedFolders.find((folder) => folder.id === folderFilter) ?? null)
      : null;
  const activeTagHidden = tagFilter !== null && !tags.some((tag) => tag.id === tagFilter);
  const captureWeeks = useMemo(() => groupByCaptureWeek(items), [items]);
  const activeFilterCount =
    Number(Boolean(q)) +
    Number(period !== 'all') +
    Number(status !== 'active') +
    Number(inbox || folderFilter !== null) +
    Number(Boolean(tagFilter));

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow={t('library.eyebrow')}
        icon={Library}
        iconClassName="text-violet-400"
        title={t('library.title')}
        description={t('library.description')}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={reorganizing}
              onClick={() => void reorganizeWithAi()}
              className="h-8 text-xs"
            >
              {reorganizing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-violet-400" />
              )}
              {reorganizing ? t('library.reorgRunning') : t('library.reorgAction')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={regeneratingTitles}
              onClick={() => setConfirmRetitleOpen(true)}
              className="h-8 text-xs"
              title={t('library.retitleHint')}
            >
              {regeneratingTitles ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Type className="h-3.5 w-3.5 text-violet-400" />
              )}
              {regeneratingTitles ? t('library.retitleRunning') : t('library.retitleAction')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={generatingTags}
              onClick={() => void generateTagsBatch()}
              className="h-8 text-xs"
              title={t('library.tagsHint')}
            >
              {generatingTags ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Tags className="h-3.5 w-3.5 text-violet-400" />
              )}
              {generatingTags ? t('library.tagsRunning') : t('library.tagsAction')}
            </Button>
            {folders.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={clearingFolders}
                onClick={() => setConfirmClearOpen(true)}
                className="h-8 text-xs text-[var(--color-app-muted)] hover:text-red-300"
              >
                {clearingFolders ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                {t('library.clearFolders')}
              </Button>
            )}
          </>
        }
      />

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        variant="destructive"
        title={t('library.clearFolders')}
        description={t('library.clearFoldersConfirm')}
        confirmLabel={t('library.clearFolders')}
        loading={clearingFolders}
        onConfirm={clearAllFolders}
      />

      <ConfirmDialog
        open={confirmRetitleOpen}
        onOpenChange={setConfirmRetitleOpen}
        title={t('library.retitleAction')}
        description={t('library.retitleConfirm')}
        confirmLabel={t('library.retitleAction')}
        loading={regeneratingTitles}
        onConfirm={regenerateTitles}
      />

      <LibrarySearch
        value={q}
        changing={queryChanging}
        onChange={setQuery}
        onClear={() => setQuery('')}
      />

      <section
        className="space-y-4 rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)] p-3 sm:p-4"
        aria-labelledby="library-filters-title"
      >
        <div className="flex flex-wrap items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-violet-400" aria-hidden />
          <h2 id="library-filters-title" className="text-sm font-semibold">
            {t('library.filtersTitle')}
          </h2>
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium tabular-nums text-violet-300">
              {t('library.activeFilters', { count: activeFilterCount })}
            </span>
          )}
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-[11px] text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
            >
              <X className="h-3 w-3" />
              {t('library.clearFilters')}
            </button>
          )}
        </div>

        <section className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-app-muted)]">
            {t('library.added')}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {(['all', 'this-week', 'previous-week'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setPeriod(item)}
                aria-pressed={period === item}
                className={[
                  'min-h-11 rounded-md px-3 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40',
                  period === item
                    ? 'bg-[var(--color-app-surface-hover)] text-[var(--color-app-fg)]'
                    : 'text-[var(--color-app-muted)] hover:text-[var(--color-app-subtle)] hover:bg-[var(--color-app-surface-hover)]',
                ].join(' ')}
              >
                {item === 'all'
                  ? t('library.allPeriods')
                  : item === 'this-week'
                    ? t('library.thisWeek')
                    : t('library.previousWeek')}
              </button>
            ))}
          </div>
        </section>

        {/* Organização — Inbox e pastas em uma superfície única. */}
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <FolderChip
              active={inbox}
              onClick={() => setInbox(!inbox)}
              icon={<Inbox className="h-3 w-3 text-violet-400" />}
              label={t('library.inbox')}
            />
            <FolderChip
              active={!inbox && folderFilter === null}
              onClick={() => setFolder(null)}
              icon={<FolderOpen className="h-3 w-3" />}
              label={t('library.allFolders')}
            />
            {visibleFolders.map((folder) => (
              <FolderChip
                key={folder.id}
                active={!inbox && folderFilter === folder.id}
                onClick={() => setFolder(folder.id)}
                icon={<Folder className="h-3 w-3 text-amber-500/80" />}
                label={folder.name}
                count={folder._count.transcripts}
              />
            ))}
            {sortedFolders.length > 0 && (
              <FolderOverflowMenu
                folders={sortedFolders}
                active={activeFolderHidden}
                activeFolderId={folderFilter}
                selectedFolder={selectedFolder}
                onSelect={setFolder}
                translate={t}
              />
            )}
          </div>
          <div className="flex min-w-0 gap-2">
            <input
              type="text"
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void createFolder();
              }}
              placeholder={t('library.newFolderPlaceholder')}
              className="h-8 min-w-0 flex-1 rounded-md border border-[var(--color-app-border)] bg-transparent px-2.5 text-xs text-[var(--color-app-fg)] placeholder:text-[var(--color-app-muted)] focus:outline-none focus:border-zinc-500/60"
              disabled={creatingFolder}
              maxLength={120}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={creatingFolder || newFolderName.trim().length === 0}
              onClick={() => void createFolder()}
              className="h-8 px-2.5 text-xs"
            >
              {creatingFolder ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <FolderPlus className="h-3 w-3" />
              )}
              <span className="hidden sm:inline">{t('library.createFolder')}</span>
            </Button>
          </div>
        </section>

        {(tagTotal > 0 || tagFilter) && (
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-app-muted)]">
                {t('library.tagsLabel')}
              </p>
              {tagFilter && (
                <button
                  type="button"
                  onClick={() => setTag(null)}
                  className="inline-flex h-5 items-center gap-1 rounded px-1 text-[10px] text-[var(--color-app-muted)] hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)]"
                >
                  <X className="h-2.5 w-2.5" />
                  {t('library.clearTagFilter')}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {tags.map((tag) => (
                <FolderChip
                  key={tag.id}
                  active={tagFilter === tag.id}
                  onClick={() => setTag(tagFilter === tag.id ? null : tag.id)}
                  icon={<Tags className="h-3 w-3 text-violet-400" />}
                  label={tag.name}
                  count={tag.count}
                />
              ))}
              <TagFilterMenu
                active={activeTagHidden}
                activeTagId={tagFilter}
                selectedTag={selectedTag}
                status={status}
                onSelect={setTag}
                translate={t}
              />
            </div>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--color-app-border)] pt-3">
          {(['active', 'archived', 'trash'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setStatus(item)}
              className={[
                'h-7 rounded-md px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40',
                status === item
                  ? 'bg-[var(--color-app-surface-hover)] text-[var(--color-app-fg)]'
                  : 'text-[var(--color-app-muted)] hover:text-[var(--color-app-subtle)] hover:bg-[var(--color-app-surface-hover)]',
              ].join(' ')}
            >
              {statusFilterLabel(item, t)}
            </button>
          ))}
          {!pageLoading && total > 0 && (
            <span className="ml-auto text-[11px] tabular-nums text-[var(--color-app-muted)]">
              {t('library.resultsRange', {
                from: offset + 1,
                to: offset + items.length,
                total,
              })}
            </span>
          )}
        </div>
      </section>

      <ContentIngestCard />

      <div id="library-results" className="scroll-mt-6" />

      {isSearching && !pageLoading && (
        <p className="text-[11px] text-[var(--color-app-muted)] -mt-2">
          <span className="tabular-nums">{total}</span>{' '}
          {t('library.searchResults', {
            count: total,
            label: total === 1 ? t('library.resultSingular') : t('library.resultPlural'),
            query: debouncedQ,
          })}
        </p>
      )}

      {pageLoading && (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-[72px] rounded-lg" />
          ))}
        </div>
      )}

      {!pageLoading && error && items.length === 0 && (
        <Card elevated>
          <FetchError message={error} onRetry={refreshTranscripts} />
        </Card>
      )}

      {!pageLoading && !error && items.length === 0 && (
        <Card elevated>
          <CardContent className="py-14 text-center space-y-3">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]">
              <Search className="h-4 w-4 text-[var(--color-app-muted)]" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {isSearching ? t('library.noResults') : t('library.empty')}
              </p>
              <p className="text-xs text-[var(--color-app-muted)]">
                {isSearching ? t('library.tryOtherKeywords') : t('library.emptyDescription')}
              </p>
            </div>
            {!isSearching && (
              <Button variant="primary" size="sm" asChild className="mt-2">
                <Link to="/">{t('library.addFirst')}</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {!pageLoading && items.length > 0 && (
        <div className="space-y-5">
          {captureWeeks.map((week) => (
            <section key={week.key} className="space-y-1.5">
              <h2 className="px-1 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-app-muted)]">
                {t('library.capturedWeek', { date: formatCaptureWeek(week.start, locale) })}
              </h2>
              <div className="space-y-1.5">
                {week.items.map((transcript) => (
                  <TranscriptRow
                    key={transcript.id}
                    t={transcript}
                    highlightQuery={debouncedQ}
                    locale={locale}
                    translate={t}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {!pageLoading && totalPages > 1 && (
        <nav
          className="flex flex-wrap items-center justify-center gap-1 border-t border-[var(--color-app-border)] pt-4"
          aria-label={t('library.pagination', { page: currentPage, pages: totalPages })}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={currentPage <= 1 || loading}
            onClick={() => setPage(currentPage - 1)}
            className="mr-1 h-9 px-2 text-xs sm:px-3"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('library.previousPage')}</span>
          </Button>
          {buildLibraryPageItems(currentPage, totalPages).map((item) =>
            typeof item === 'number' ? (
              <button
                key={item}
                type="button"
                onClick={() => setPage(item)}
                aria-current={item === currentPage ? 'page' : undefined}
                aria-label={t('library.goToPage', { page: item })}
                className={[
                  'inline-flex h-9 min-w-9 items-center justify-center rounded-md border px-2 text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40',
                  item === currentPage
                    ? 'border-violet-500/35 bg-violet-500/10 text-violet-200'
                    : 'border-transparent text-[var(--color-app-muted)] hover:border-[var(--color-app-border)] hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)]',
                ].join(' ')}
              >
                {item}
              </button>
            ) : (
              <span
                key={item}
                aria-hidden
                className="inline-flex h-9 min-w-7 items-center justify-center text-xs text-[var(--color-app-muted)]"
              >
                …
              </span>
            ),
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages || loading}
            onClick={() => setPage(currentPage + 1)}
            className="ml-1 h-9 px-2 text-xs sm:px-3"
          >
            <span className="hidden sm:inline">{t('library.nextPage')}</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </nav>
      )}
    </PageShell>
  );
}

function FolderChip({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-pressed={active}
      className={[
        'inline-flex min-h-11 max-w-[180px] items-center gap-1.5 rounded-md border px-3 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40',
        active
          ? 'border-[var(--color-app-border-strong)] bg-[var(--color-app-surface-hover)] text-[var(--color-app-fg)]'
          : 'border-transparent bg-[var(--color-app-surface)] text-[var(--color-app-muted)] hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-subtle)]',
      ].join(' ')}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
      {typeof count === 'number' && (
        <span className="tabular-nums text-[10px] text-[var(--color-app-muted)]">{count}</span>
      )}
    </button>
  );
}

/**
 * Chip final "+K mais" da fileira de pastas. Abre um popover pesquisável com
 * a lista completa de pastas (não só as escondidas — assim o usuário acha
 * qualquer pasta ali, mesmo uma que já apareça como chip direto).
 */
function FolderOverflowMenu({
  folders,
  active,
  activeFolderId,
  selectedFolder,
  onSelect,
  translate,
}: {
  folders: LibraryFolder[];
  active: boolean;
  activeFolderId: FolderFilter;
  selectedFolder: LibraryFolder | null;
  onSelect: (id: string) => void;
  translate: TranslateFn;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => filterFoldersByQuery(folders, query), [folders, query]);

  function handleOpenChange(next: boolean): void {
    setOpen(next);
    if (!next) setQuery('');
  }

  function handleSelect(id: string): void {
    onSelect(id);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={translate('library.filterFolders')}
          aria-label={translate('library.filterFolders')}
          aria-pressed={active}
          className={[
            'inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40',
            active
              ? 'border-[var(--color-app-border-strong)] bg-[var(--color-app-surface-hover)] text-[var(--color-app-fg)]'
              : 'border-transparent bg-[var(--color-app-surface)] text-[var(--color-app-muted)] hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-subtle)]',
            'data-[state=open]:bg-[var(--color-app-surface-hover)] data-[state=open]:text-[var(--color-app-fg)]',
          ].join(' ')}
        >
          <Search className="h-3 w-3 shrink-0" />
          <span className="max-w-[160px] truncate">
            {active && selectedFolder ? selectedFolder.name : translate('library.filterFolders')}
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
              onChange={(event) => setQuery(event.target.value)}
              placeholder={translate('library.folderSearchPlaceholder')}
              autoComplete="off"
              spellCheck={false}
              className="h-8 w-full rounded-md border border-[var(--color-app-border)] bg-[var(--color-app-bg)] pl-7 pr-2 text-xs text-[var(--color-app-fg)] placeholder:text-[var(--color-app-muted)] focus:outline-none focus:border-zinc-500/60"
            />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 && (
            <p className="px-2 py-3 text-center text-[11px] text-[var(--color-app-muted)]">
              {translate('library.folderSearchEmpty')}
            </p>
          )}
          {filtered.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => handleSelect(folder.id)}
              className={[
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40',
                activeFolderId === folder.id
                  ? 'bg-[var(--color-app-surface-hover)] text-[var(--color-app-fg)]'
                  : 'text-[var(--color-app-subtle)] hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)]',
              ].join(' ')}
            >
              <Folder className="h-3 w-3 shrink-0 text-amber-500/80" />
              <span className="min-w-0 flex-1 truncate">{folder.name}</span>
              <span className="shrink-0 tabular-nums text-[10px] text-[var(--color-app-muted)]">
                {folder._count.transcripts}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TranscriptRow({
  t,
  highlightQuery,
  locale,
  translate,
}: {
  t: TranscriptSummary;
  highlightQuery: string;
  locale: Locale;
  translate: TranslateFn;
}): React.ReactElement {
  const isVisualTranscript = t.transcriptionMethod === 'VISION';
  const isDocumentTranscript = t.transcriptionMethod === 'DOCUMENT';
  const previewSrc = resolveTranscriptPreviewSrc(t.id, t.thumbnailUrl);
  const showDuration = t.source !== 'WEB' && !isVisualTranscript && !isDocumentTranscript;

  return (
    <Link
      to={`/transcricoes/${t.id}`}
      className="group flex items-center gap-3 rounded-lg border border-transparent px-2 py-2 transition-colors hover:border-[var(--color-app-border)] hover:bg-[var(--color-app-surface-hover)] focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500/40"
    >
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-[var(--color-app-bg-elevated)] sm:h-14 sm:w-[88px]">
        <img
          src={previewSrc}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          onError={(e) => {
            const el = e.currentTarget;
            const fallback = `/api/transcripts/${t.id}/preview`;
            if (el.src && !el.src.endsWith('/preview') && el.src !== fallback) {
              el.src = fallback;
              return;
            }
            el.style.opacity = '0';
          }}
        />
      </div>

      <div className="min-w-0 flex-1 space-y-0.5">
        <h3 className="truncate text-[13px] font-medium leading-snug text-[var(--color-app-fg)] group-hover:text-[var(--color-app-fg)]">
          {highlightInText(t.title, highlightQuery)}
        </h3>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--color-app-muted)]">
          <span className="inline-flex items-center gap-1 shrink-0">
            {t.source === 'WEB' && <Globe className="h-2.5 w-2.5" />}
            {displaySource(t.source, translate)}
          </span>
          {sourceHostname(t.url) && (
            <span className="truncate max-w-[160px] font-mono text-[10px] opacity-80">
              {sourceHostname(t.url)}
            </span>
          )}
          {showDuration && <span className="tabular-nums">{formatDuration(t.durationSec)}</span>}
          {t.channel && <span className="truncate max-w-[140px]">{t.channel}</span>}
          {t.folder && (
            <span className="inline-flex min-w-0 max-w-[120px] items-center gap-1 truncate text-[var(--color-app-muted)]">
              <Folder className="h-2.5 w-2.5 shrink-0 text-amber-500/70" />
              <span className="truncate">{t.folder.name}</span>
            </span>
          )}
          {t.status === 'ARCHIVED' && (
            <Badge variant="muted" className="h-4 px-1 text-[9px]">
              {translate('library.statusArchived')}
            </Badge>
          )}
          {t.status === 'TRASH' && (
            <Badge variant="danger" className="h-4 px-1 text-[9px]">
              {translate('library.statusTrash')}
            </Badge>
          )}
          {t.graphMatch && (
            <Badge
              variant="outline"
              className="h-4 gap-1 px-1 text-[9px] text-[var(--color-accent-violet)]"
            >
              <Network className="h-2.5 w-2.5" aria-hidden />
              {translate('library.graphMatch')}
            </Badge>
          )}
        </div>
        {t.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            {t.tags.slice(0, 4).map((tag) => (
              <span
                key={tag.id}
                className="inline-flex max-w-[130px] items-center gap-1 truncate rounded-full border border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-1.5 py-0.5 text-[10px] text-[var(--color-app-subtle)]"
              >
                <Tags className="h-2.5 w-2.5 shrink-0 text-violet-400/80" />
                <span className="truncate">{tag.name}</span>
              </span>
            ))}
            {t.tags.length > 4 && (
              <span className="text-[10px] text-[var(--color-app-muted)]">
                +{t.tags.length - 4}
              </span>
            )}
          </div>
        )}
        {t.snippet && (
          <p className="hidden text-[11px] leading-relaxed text-[var(--color-app-muted)] line-clamp-1 sm:block">
            {renderSnippet(t.snippet)}
          </p>
        )}
      </div>

      <div className="hidden shrink-0 flex-col items-end gap-0.5 text-[10px] text-[var(--color-app-muted)] sm:flex">
        <span>{formatRelative(new Date(t.createdAt), locale)}</span>
        <span className="font-mono tabular-nums opacity-70">{formatUsd(t.costUsd)}</span>
      </div>
    </Link>
  );
}

function normalizeStatusFilter(value: string | null): StatusFilter {
  if (value === 'archived' || value === 'trash') return value;
  return 'active';
}

function normalizeSearchQuery(value: string | null): string {
  return (value ?? '').slice(0, 240);
}

function normalizeFolderFilter(value: string | null): FolderFilter {
  if (!value) return null;
  if (value === 'none') return 'none';
  return value;
}

function normalizeTagFilter(value: string | null): string | null {
  const id = value?.trim();
  return id && id.length <= 191 ? id : null;
}

function normalizePeriodFilter(value: string | null): LibraryPeriod {
  if (value === 'this-week' || value === 'previous-week') return value;
  return 'all';
}

function formatCaptureWeek(value: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' })
    .format(value)
    .replace(/\.$/, '');
}

function statusFilterLabel(status: StatusFilter, t: TranslateFn): string {
  switch (status) {
    case 'active':
      return t('library.status.active');
    case 'archived':
      return t('library.status.archived');
    case 'trash':
      return t('library.status.trash');
  }
}

function displaySource(source: TranscriptSummary['source'], t: TranslateFn): string {
  switch (source) {
    case 'YOUTUBE':
      return 'YouTube';
    case 'INSTAGRAM':
      return 'Instagram';
    case 'TIKTOK':
      return 'TikTok';
    case 'X':
      return 'X';
    case 'WEB':
      return t('library.source.web');
    case 'UPLOAD':
      return 'Upload';
  }
}

function highlightInText(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((tok) => tok.length >= 2);
  if (tokens.length === 0) return text;
  const re = new RegExp(`(${tokens.map(escapeRegex).join('|')})`, 'gi');
  const parts = text.split(re);
  return parts.map((p, i) =>
    new RegExp(`^(${tokens.map(escapeRegex).join('|')})$`, 'i').test(p) ? (
      <mark key={i} className="bg-violet-500/20 text-violet-200 rounded-sm px-0.5 -mx-0.5">
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

function renderSnippet(snippet: string): React.ReactNode {
  const parts = snippet.split(/(«[^»]*»)/g);
  return parts.map((p, i) => {
    if (p.startsWith('«') && p.endsWith('»')) {
      return (
        <mark key={i} className="bg-violet-500/20 text-violet-200 rounded-sm px-0.5">
          {p.slice(1, -1)}
        </mark>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
