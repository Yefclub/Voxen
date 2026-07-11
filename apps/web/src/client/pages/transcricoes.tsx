import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Folder, FolderPlus, Globe, Library, Loader2, Search, X } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Button } from '../components/ui/button';
import { apiPost } from '../lib/api';
import { useFetch } from '../lib/hooks';
import { formatDuration, formatRelative, formatUsd } from '../lib/format';
import type { JobStatus } from '../lib/types';
import { AnimatedPage, StaggerContainer, StaggerItem } from '../components/motion/animated-page';
import { useI18n, type Locale, type TranslateFn } from '../lib/i18n';

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
  status: 'ACTIVE' | 'ARCHIVED' | 'TRASH';
  createdAt: string;
  snippet?: string;
}

interface SearchResponse {
  transcripts: TranscriptSummary[];
  query: string;
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

type StatusFilter = 'active' | 'archived' | 'trash';

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
  const folderId = searchParams.get('folderId');
  const [q, setQ] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const debouncedQ = useDebounced(q, 250);
  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedQ) params.set('q', debouncedQ);
    if (status !== 'active') params.set('status', status);
    if (folderId) params.set('folderId', folderId);
    const suffix = params.toString();
    return `/api/transcripts${suffix ? `?${suffix}` : ''}`;
  }, [debouncedQ, folderId, status]);
  const { data, loading } = useFetch<SearchResponse>(url);
  const { data: foldersData, refresh: refreshFolders } =
    useFetch<FoldersResponse>('/api/library/folders');
  const transcripts = data?.transcripts ?? [];
  const folders = foldersData?.folders ?? [];
  const isSearching = debouncedQ.length > 0;
  const queryChanging = q !== debouncedQ;

  function setStatus(next: StatusFilter): void {
    const params = new URLSearchParams(searchParams);
    if (next === 'active') params.delete('status');
    else params.set('status', next);
    setSearchParams(params, { replace: true });
  }

  function setFolder(next: string | null): void {
    const params = new URLSearchParams(searchParams);
    if (next) params.set('folderId', next);
    else params.delete('folderId');
    setSearchParams(params, { replace: true });
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

  return (
    <AnimatedPage>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-5 sm:space-y-10 sm:px-6 sm:py-8 lg:px-8 lg:py-12">
        <header className="space-y-2 sm:space-y-3">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium">
            <Library className="h-3.5 w-3.5 text-violet-400" />
            {t('library.eyebrow')}
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-[-0.03em] sm:text-4xl">
            {t('library.title')}
          </h1>
          <p className="hidden max-w-2xl text-[15px] leading-relaxed text-[var(--color-app-muted)] sm:block">
            {t('library.description')}
          </p>
        </header>

        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-app-muted)] pointer-events-none z-10" />
          {/* type="text" em vez de "search" — o type=search injeta um botão
              nativo de clear no Chrome/Safari que sobrepõe a lupa após digitar.
              Mantemos UX equivalente com nosso próprio botão (X à direita). */}
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('library.searchPlaceholder')}
            autoComplete="off"
            spellCheck={false}
            className="w-full h-12 rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/60 backdrop-blur-sm pl-11 pr-12 text-[15px] text-zinc-100 placeholder:text-[var(--color-app-muted)] focus:outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/15 transition-colors"
          />
          {q.length > 0 && (
            <button
              type="button"
              onClick={() => setQ('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-app-muted)] hover:text-zinc-100 hover:bg-[var(--color-app-surface-hover)] transition-colors"
              aria-label={t('library.clearSearch')}
            >
              {queryChanging ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>

        <section className="-mt-2 space-y-3 rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/40 p-3 sm:-mt-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-app-muted)]">
              <Folder className="h-3.5 w-3.5 text-amber-400" />
              {t('library.folders')}
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
                className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--color-app-border)] bg-zinc-100/[0.03] px-3 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/15"
                disabled={creatingFolder}
                maxLength={120}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={creatingFolder || newFolderName.trim().length === 0}
                onClick={() => void createFolder()}
              >
                {creatingFolder ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FolderPlus className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">{t('library.createFolder')}</span>
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={!folderId ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setFolder(null)}
            >
              {t('library.allFolders')}
            </Button>
            {folders.map((folder) => (
              <Button
                key={folder.id}
                type="button"
                variant={folderId === folder.id ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setFolder(folder.id)}
                className="max-w-[220px]"
              >
                <Folder className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                <span className="truncate">{folder.name}</span>
                <span className="tabular-nums text-[var(--color-app-muted)]">
                  {folder._count.transcripts}
                </span>
              </Button>
            ))}
          </div>
        </section>

        <div className="-mt-2 flex flex-wrap items-center gap-2 sm:-mt-4">
          {(['active', 'archived', 'trash'] as const).map((item) => (
            <Button
              key={item}
              type="button"
              variant={status === item ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setStatus(item)}
            >
              {statusFilterLabel(item, t)}
            </Button>
          ))}
        </div>

        {isSearching && !loading && (
          <p className="text-xs text-[var(--color-app-muted)] -mt-6">
            <span className="tabular-nums">{transcripts.length}</span>{' '}
            {t('library.searchResults', {
              count: transcripts.length,
              label:
                transcripts.length === 1 ? t('library.resultSingular') : t('library.resultPlural'),
              query: debouncedQ,
            })}
          </p>
        )}

        {loading && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="min-h-[430px] rounded-2xl" />
            ))}
          </div>
        )}

        {!loading && transcripts.length === 0 && (
          <Card elevated>
            <CardContent className="py-20 text-center space-y-4">
              <div className="mx-auto h-12 w-12 rounded-2xl bg-gradient-to-br from-violet-500/20 to-emerald-500/20 border border-[var(--color-app-border-strong)] flex items-center justify-center">
                <Search className="h-5 w-5 text-violet-400" />
              </div>
              <div className="space-y-1.5">
                <p className="font-display text-lg font-semibold tracking-tight">
                  {isSearching ? t('library.noResults') : t('library.empty')}
                </p>
                <p className="text-sm text-[var(--color-app-muted)]">
                  {isSearching ? t('library.tryOtherKeywords') : t('library.emptyDescription')}
                </p>
              </div>
              {!isSearching && (
                <Button variant="primary" size="lg" asChild className="mt-3">
                  <Link to="/">{t('library.addFirst')}</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {!loading && transcripts.length > 0 && (
          <StaggerContainer className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
            {transcripts.map((transcript) => (
              <StaggerItem key={transcript.id} className="h-full">
                <TranscriptCard
                  t={transcript}
                  highlightQuery={debouncedQ}
                  locale={locale}
                  translate={t}
                />
              </StaggerItem>
            ))}
          </StaggerContainer>
        )}
      </div>
    </AnimatedPage>
  );
}

function TranscriptCard({
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
  const previewSrc = t.thumbnailUrl || `/api/transcripts/${t.id}/preview`;
  return (
    <motion.div
      className="h-full"
      whileHover={{ y: -3 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <Link
        to={`/transcricoes/${t.id}`}
        className="group block h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 rounded-2xl"
      >
        <Card
          hoverable
          elevated
          className="flex h-full min-h-[168px] flex-row overflow-hidden p-0 transition-colors duration-200 sm:min-h-[430px] sm:flex-col"
        >
          <div className="relative aspect-square w-28 shrink-0 self-stretch overflow-hidden bg-[var(--color-app-bg-elevated)] sm:aspect-video sm:w-full sm:self-auto">
            <img
              src={previewSrc}
              alt=""
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              loading="lazy"
            />
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent"
            />
            {t.source !== 'WEB' && !isVisualTranscript && !isDocumentTranscript && (
              <div className="absolute bottom-2 right-2">
                <Badge
                  variant="default"
                  className="bg-black/60 backdrop-blur-sm border-white/10 text-[10px] tabular-nums"
                >
                  {formatDuration(t.durationSec)}
                </Badge>
              </div>
            )}
          </div>

          <CardContent className="flex min-h-0 flex-1 flex-col space-y-2 px-4 py-3 sm:space-y-3 sm:px-5 sm:pb-5 sm:pt-4">
            <div>
              <h3 className="max-w-full break-words text-[15px] font-semibold leading-snug tracking-tight line-clamp-2 [overflow-wrap:anywhere] group-hover:text-violet-300 transition-colors font-display">
                {highlightInText(t.title, highlightQuery)}
              </h3>
              <p className="min-h-[18px] text-xs text-[var(--color-app-muted)] mt-1.5 truncate">
                {t.channel ?? t.folder?.name ?? ''}
              </p>
            </div>

            <p className="hidden h-[54px] text-xs leading-relaxed text-[var(--color-app-subtle)] line-clamp-3 sm:block">
              {t.snippet ? renderSnippet(t.snippet) : null}
            </p>

            <div className="flex max-h-[48px] flex-wrap content-start items-start gap-1.5 overflow-hidden pt-0.5 sm:h-[50px] sm:max-h-none sm:gap-2 sm:pt-1">
              {/* Source primário — diferencia Vídeo / Web e plataforma */}
              <Badge variant={t.source === 'WEB' ? 'muted' : 'success'} className="text-[10px]">
                {t.source === 'WEB' && <Globe className="h-2.5 w-2.5" />}
                {displaySource(t.source, translate)}
              </Badge>
              {t.status === 'ARCHIVED' && (
                <Badge variant="muted" className="text-[10px]">
                  {translate('library.statusArchived')}
                </Badge>
              )}
              {t.status === 'TRASH' && (
                <Badge variant="danger" className="text-[10px]">
                  {translate('library.statusTrash')}
                </Badge>
              )}
              {/* Método (só faz sentido pra vídeos) */}
              {t.source !== 'WEB' && (
                <Badge
                  variant={t.transcriptionMethod === 'SUBTITLES' ? 'success' : 'default'}
                  className="text-[10px]"
                >
                  {displayMethod(t.transcriptionMethod, translate)}
                </Badge>
              )}
              {t.language && (
                <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                  {t.language}
                </Badge>
              )}
              {t.folder && (
                <Badge variant="muted" className="max-w-full text-[10px]">
                  <Folder className="h-2.5 w-2.5 shrink-0" />
                  <span className="truncate">{t.folder.name}</span>
                </Badge>
              )}
            </div>

            <div className="mt-auto flex items-center justify-between border-t border-[var(--color-app-border)] pt-2 text-[11px] text-[var(--color-app-muted)] sm:pt-3">
              <span>{formatRelative(new Date(t.createdAt), locale)}</span>
              <span className="tabular-nums font-mono">{formatUsd(t.costUsd)}</span>
            </div>
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}

function normalizeStatusFilter(value: string | null): StatusFilter {
  if (value === 'archived' || value === 'trash') return value;
  return 'active';
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

function displayMethod(method: TranscriptSummary['transcriptionMethod'], t: TranslateFn): string {
  switch (method) {
    case 'SUBTITLES':
      return t('library.method.subtitles');
    case 'VISION':
      return t('library.method.vision');
    case 'DOCUMENT':
      return t('library.method.document');
    case 'X_SEARCH':
      return 'X';
    case 'SCRAPE':
      return 'Web';
    case 'API':
      return t('library.method.ai');
  }
}

function highlightInText(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
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

export type { JobStatus };
