import { Link } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { useFetch } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import type { VersionResponse } from '../lib/types';
import { resolveVersionEnvironment } from '../lib/version-env';
import { AnimatedPage } from '../components/motion/animated-page';
import { Badge } from '../components/ui/badge';
import { FetchError } from '../components/ui/fetch-error';
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

type ReleasesResponse = { releases: ReleaseEntry[] };

const TYPE_LABEL: Record<string, string> = {
  feat: 'feat',
  fix: 'fix',
  perf: 'perf',
  ui: 'ui',
  infra: 'infra',
  security: 'security',
  chore: 'chore',
};

export function NovidadesPage(): React.ReactElement {
  const { locale, t } = useI18n();
  const { data, loading, error, refresh } = useFetch<ReleasesResponse>('/api/releases?limit=80');
  const releases = data?.releases ?? [];
  const { data: versionData } = useFetch<VersionResponse>('/api/version');
  const environment = versionData ? resolveVersionEnvironment(versionData.version) : null;

  return (
    <AnimatedPage>
      <div className="mx-auto max-w-5xl space-y-7 px-4 py-6 sm:px-6 sm:py-10 lg:px-10">
        <div className="rounded-2xl border border-[var(--color-app-border)] bg-gradient-to-br from-violet-500/[0.08] via-transparent to-emerald-500/[0.06] px-5 py-6 sm:px-8 sm:py-8 space-y-3">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs text-[var(--color-app-muted)] hover:text-[var(--color-app-subtle)]"
          >
            <ArrowLeft className="h-3 w-3" />
            {t('novidades.back')}
          </Link>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--color-app-muted)]">
            <Sparkles className="h-3 w-3 text-violet-400" />
            {t('novidades.eyebrow')}
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {t('novidades.title')}
          </h1>
          <p className="text-sm text-[var(--color-app-muted)]">{t('novidades.description')}</p>
        </div>

        {environment && (
          <Badge variant={environment === 'dev' ? 'warning' : 'success'} className="text-[10px]">
            {environment === 'dev'
              ? t('novidades.environment.dev')
              : t('novidades.environment.prod')}
          </Badge>
        )}

        {loading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        )}

        {!loading && error && <FetchError message={error} onRetry={refresh} />}

        {!loading && !error && releases.length === 0 && (
          <div className="rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/40 px-5 py-10 text-center">
            <p className="text-sm font-medium">{t('novidades.empty')}</p>
            <p className="mt-1 text-xs text-[var(--color-app-muted)]">{t('novidades.emptyHint')}</p>
          </div>
        )}

        {!loading && releases.length > 0 && (
          <ol className="grid gap-4 lg:grid-cols-2">
            {releases.map((entry, idx) => (
              <li
                key={`${entry.version}-${entry.channel}-${entry.pr ?? idx}-${entry.title ?? ''}`}
                className="flex min-h-44 flex-col rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/45 px-4 py-4 sm:px-5"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-[var(--color-app-subtle)]">
                    v{entry.version}
                  </span>
                  <Badge
                    variant={entry.channel === 'prod' ? 'success' : 'muted'}
                    className="text-[10px]"
                  >
                    {entry.channel === 'prod'
                      ? t('novidades.channel.prod')
                      : t('novidades.channel.dev')}
                  </Badge>
                  {entry.type && (
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {TYPE_LABEL[entry.type] ?? entry.type}
                    </Badge>
                  )}
                  {entry.date && (
                    <span className="text-[11px] text-[var(--color-app-muted)]">
                      {formatDate(entry.date, locale)}
                    </span>
                  )}
                </div>

                {entry.channel === 'prod' && entry.title ? (
                  <h2 className="mb-2 text-base font-semibold tracking-tight text-[var(--color-app-fg)]">
                    {entry.title}
                  </h2>
                ) : null}

                {entry.channel !== 'prod' && (entry.title || entry.summary) ? (
                  <h2 className="mb-2 text-[15px] font-medium tracking-tight text-[var(--color-app-fg)]">
                    {entry.title || entry.summary}
                  </h2>
                ) : null}

                {(entry.body || entry.summary) && (
                  <div className="prose-release space-y-2 break-words text-[13px] leading-relaxed text-[var(--color-app-muted)] whitespace-pre-wrap">
                    {(entry.body || entry.summary || '').trim()}
                  </div>
                )}

                {entry.channel === 'prod' && entry.promoted && entry.promoted.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[11px] text-[var(--color-app-muted)] hover:text-[var(--color-app-subtle)]">
                      {t('novidades.promoted', { count: entry.promoted.length })}
                    </summary>
                    <ul className="mt-2 space-y-2 border-l border-[var(--color-app-border)] pl-3">
                      {entry.promoted.map((p, i) => (
                        <li
                          key={`${p.pr ?? i}-${p.title}`}
                          className="text-[12px] text-[var(--color-app-muted)]"
                        >
                          <span className="font-medium text-[var(--color-app-subtle)]">
                            {p.title}
                          </span>
                          {p.prUrl && (
                            <a
                              href={p.prUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-2 text-[11px] text-violet-400/80 hover:underline"
                            >
                              #{p.pr}
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
                    className="mt-auto pt-4 inline-block text-[11px] text-violet-400/90 hover:underline"
                  >
                    PR #{entry.pr}
                  </a>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </AnimatedPage>
  );
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
