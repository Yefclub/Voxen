import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Search,
  Sparkles,
} from '@/components/ui/icons';
import { useFetch } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import type { VersionResponse } from '../lib/types';
import { resolveVersionEnvironment } from '../lib/version-env';
import { releaseTypeI18nKey } from '../../shared/release-type';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { DataSurface } from '../components/ui/data-surface';
import { FetchError } from '../components/ui/fetch-error';
import { PageHeader, PageShell } from '../components/ui/page-shell';
import { Skeleton } from '../components/ui/skeleton';

type ReleaseEntry = {
  version: string;
  channel: string;
  type?: string;
  title?: string;
  body?: string;
  summary?: string;
  pr?: number | null;
  prUrl?: string;
  author?: string | null;
  date?: string;
  promoted?: Array<{
    type?: string;
    title?: string;
    body?: string;
    pr?: number | null;
    prUrl?: string;
  }>;
};

type ReleasesResponse = {
  releases: ReleaseEntry[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

const PAGE_SIZE = 12;
const RELEASE_TYPES = ['feat', 'fix', 'perf', 'ui', 'infra', 'security', 'chore'] as const;

export function NovidadesPage(): React.ReactElement {
  const { locale, t } = useI18n();
  const typeLabel = (releaseType: string): string => {
    const key = releaseTypeI18nKey(releaseType);
    return key ? t(key) : releaseType;
  };
  const [searchParams, setSearchParams] = useSearchParams();
  const page = positivePage(searchParams.get('page'));
  const channel = normalizeChannel(searchParams.get('channel'));
  const type = normalizeType(searchParams.get('type'));
  const queryParam = searchParams.get('q')?.trim() ?? '';
  const [query, setQuery] = useState(queryParam);
  const [retained, setRetained] = useState<ReleasesResponse | null>(null);

  useEffect(() => setQuery(queryParam), [queryParam]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (query.trim() === queryParam) return;
      updateReleaseParams(setSearchParams, searchParams, { q: query.trim(), page: '1' });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, queryParam, searchParams, setSearchParams]);

  const releasesUrl = useMemo(() => {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String((page - 1) * PAGE_SIZE),
    });
    if (channel !== 'all') params.set('channel', channel);
    if (type !== 'all') params.set('type', type);
    if (queryParam) params.set('q', queryParam);
    return `/api/releases?${params.toString()}`;
  }, [channel, page, queryParam, type]);
  const { data, loading, error, refresh } = useFetch<ReleasesResponse>(releasesUrl);
  const { data: versionData } = useFetch<VersionResponse>('/api/version');

  useEffect(() => {
    if (data) setRetained(data);
  }, [data]);

  const feed = data ?? retained;
  const releases = feed?.releases ?? [];
  const total = feed?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const environment = versionData ? resolveVersionEnvironment(versionData.version) : null;

  useEffect(() => {
    if (!data || page <= totalPages) return;
    updateReleaseParams(setSearchParams, searchParams, { page: String(totalPages) });
  }, [data, page, searchParams, setSearchParams, totalPages]);

  function setFilter(key: 'channel' | 'type', value: string): void {
    updateReleaseParams(setSearchParams, searchParams, {
      [key]: value === 'all' ? '' : value,
      page: '1',
    });
  }

  function setPage(next: number): void {
    updateReleaseParams(setSearchParams, searchParams, {
      page: String(Math.min(Math.max(next, 1), totalPages)),
    });
  }

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow={
          <>
            <Sparkles className="h-3.5 w-3.5 text-[var(--color-accent-violet)]" />
            {t('novidades.eyebrow')}
          </>
        }
        title={t('novidades.title')}
        description={t('novidades.description')}
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">
              <ArrowLeft className="h-3.5 w-3.5" />
              {t('novidades.back')}
            </Link>
          </Button>
        }
      />

      <DataSurface data-page-reveal className="overflow-visible p-3 sm:p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(18rem,1fr)_12rem_12rem_auto] lg:items-end">
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-app-muted)]">
              {t('novidades.search')}
            </span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-app-muted)]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('novidades.searchPlaceholder')}
                className="h-11 w-full rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg)] pl-10 pr-3 text-sm outline-none transition focus:border-[var(--color-accent-violet)]/60 focus:ring-2 focus:ring-[var(--color-accent-violet-soft)]"
              />
            </span>
          </label>
          <ReleaseSelect
            label={t('novidades.filter.channel')}
            value={channel}
            onChange={(value) => setFilter('channel', value)}
            options={[
              ['all', t('novidades.filter.all')],
              ['prod', t('novidades.channel.prod')],
              ['dev', t('novidades.channel.dev')],
            ]}
          />
          <ReleaseSelect
            label={t('novidades.filter.type')}
            value={type}
            onChange={(value) => setFilter('type', value)}
            options={[
              ['all', t('novidades.filter.all')],
              ...RELEASE_TYPES.map((releaseType) => [releaseType, typeLabel(releaseType)] as const),
            ]}
          />
          <div className="flex min-h-11 items-center gap-2 lg:justify-end">
            {environment && (
              <Badge
                variant={environment === 'dev' ? 'warning' : 'success'}
                className="text-[10px]"
              >
                {environment === 'dev'
                  ? t('novidades.environment.dev')
                  : t('novidades.environment.prod')}
              </Badge>
            )}
          </div>
        </div>
      </DataSurface>

      {loading && !feed && (
        <div className="space-y-3" data-page-reveal>
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-36 rounded-xl" />
          ))}
        </div>
      )}

      {!loading && error && !feed && <FetchError message={error} onRetry={refresh} />}

      {!loading && error && feed && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.08] px-4 py-3 text-sm"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
          <p className="min-w-0 flex-1 text-[var(--color-app-muted)]">
            {t('novidades.refreshError')}
          </p>
          <Button variant="outline" size="sm" onClick={refresh}>
            <RotateCw className="h-3.5 w-3.5" />
            {t('common.fetchErrorRetry')}
          </Button>
        </div>
      )}

      {feed && (
        <section data-page-reveal className="space-y-4" aria-busy={loading}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-[var(--color-app-muted)]">
              {t('novidades.results', { count: total })}
            </p>
            <p className="text-xs tabular-nums text-[var(--color-app-muted)]">
              {t('novidades.pagination', { page, pages: totalPages })}
            </p>
          </div>

          {releases.length === 0 ? (
            <DataSurface className="px-5 py-12 text-center">
              <p className="text-sm font-medium">{t('novidades.empty')}</p>
              <p className="mt-1 text-xs text-[var(--color-app-muted)]">
                {t('novidades.emptyHint')}
              </p>
            </DataSurface>
          ) : (
            <ol className="relative space-y-3 before:absolute before:bottom-5 before:left-[1.15rem] before:top-5 before:w-px before:bg-[var(--color-app-border)] sm:before:left-[1.4rem]">
              {releases.map((entry, index) => (
                <ReleaseItem
                  key={`${entry.version}-${entry.channel}-${entry.pr ?? index}-${entry.title ?? ''}`}
                  entry={entry}
                  locale={locale}
                  typeLabel={typeLabel}
                  promotedLabel={t('novidades.promoted', {
                    count: entry.promoted?.length ?? 0,
                  })}
                  prodLabel={t('novidades.channel.prod')}
                  devLabel={t('novidades.channel.dev')}
                />
              ))}
            </ol>
          )}

          <nav
            className="flex items-center justify-between border-t border-[var(--color-app-border)] pt-4"
            aria-label={t('novidades.pagination', { page, pages: totalPages })}
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              {t('novidades.previous')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
            >
              {t('novidades.next')}
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </nav>
        </section>
      )}
    </PageShell>
  );
}

function ReleaseSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
}): React.ReactElement {
  return (
    <label className="space-y-1.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-app-muted)]">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg)] px-3 text-sm outline-none transition focus:border-[var(--color-accent-violet)]/60 focus:ring-2 focus:ring-[var(--color-accent-violet-soft)]"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function ReleaseItem({
  entry,
  locale,
  typeLabel,
  promotedLabel,
  prodLabel,
  devLabel,
}: {
  entry: ReleaseEntry;
  locale: string;
  typeLabel: (releaseType: string) => string;
  promotedLabel: string;
  prodLabel: string;
  devLabel: string;
}): React.ReactElement {
  return (
    <li className="relative pl-10 sm:pl-12">
      <span className="absolute left-[0.82rem] top-6 h-3 w-3 rounded-full border-2 border-[var(--color-app-bg)] bg-[var(--color-accent-violet)] ring-1 ring-[var(--color-app-border-strong)] sm:left-[1.08rem]" />
      <DataSurface className="p-4 transition-colors hover:border-[var(--color-app-border-strong)] sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-[var(--color-app-subtle)]">v{entry.version}</span>
          <Badge variant={entry.channel === 'prod' ? 'success' : 'muted'} className="text-[10px]">
            {entry.channel === 'prod' ? prodLabel : devLabel}
          </Badge>
          {entry.type && (
            <Badge variant="outline" className="text-[10px] uppercase">
              {typeLabel(entry.type)}
            </Badge>
          )}
          {entry.date && (
            <time className="ml-auto text-[11px] text-[var(--color-app-muted)]">
              {formatDate(entry.date, locale)}
            </time>
          )}
        </div>

        {(entry.title || entry.summary) && (
          <h2 className="mt-3 text-base font-semibold tracking-tight text-[var(--color-app-fg)] sm:text-lg">
            {entry.title || entry.summary}
          </h2>
        )}

        {(entry.body || (entry.title ? entry.summary : null)) && (
          <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[var(--color-app-muted)]">
            {(entry.body || entry.summary || '').trim()}
          </p>
        )}

        {entry.promoted && entry.promoted.length > 0 && (
          <details className="mt-4 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg)]/45 px-3 py-2.5">
            <summary className="cursor-pointer text-xs font-medium text-[var(--color-app-subtle)]">
              {promotedLabel}
            </summary>
            <ul className="mt-3 space-y-3 border-l border-[var(--color-app-border)] pl-3">
              {entry.promoted.map((promoted, index) => (
                <li key={`${promoted.pr ?? index}-${promoted.title}`} className="text-xs">
                  <p className="font-medium text-[var(--color-app-subtle)]">{promoted.title}</p>
                  {promoted.body && (
                    <p className="mt-1 whitespace-pre-wrap text-[var(--color-app-muted)]">
                      {promoted.body}
                    </p>
                  )}
                  {promoted.prUrl && (
                    <a
                      href={promoted.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-[var(--color-accent-violet)] hover:underline"
                    >
                      #{promoted.pr}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}

        {entry.prUrl && (
          <a
            href={entry.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-block text-xs font-medium text-[var(--color-accent-violet)] hover:underline"
          >
            PR #{entry.pr}
          </a>
        )}
      </DataSurface>
    </li>
  );
}

function updateReleaseParams(
  setSearchParams: ReturnType<typeof useSearchParams>[1],
  current: URLSearchParams,
  updates: Record<string, string>,
): void {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(updates)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  if (next.get('page') === '1') next.delete('page');
  setSearchParams(next, { replace: true });
}

function positivePage(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function normalizeChannel(value: string | null): 'all' | 'dev' | 'prod' {
  return value === 'dev' || value === 'prod' ? value : 'all';
}

function normalizeType(value: string | null): string {
  return value && RELEASE_TYPES.includes(value as (typeof RELEASE_TYPES)[number]) ? value : 'all';
}

function formatDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale === 'en' ? 'en-US' : 'pt-BR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso.slice(0, 10);
  }
}
