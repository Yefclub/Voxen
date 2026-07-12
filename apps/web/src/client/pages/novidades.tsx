import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { useFetch } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
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
  const [channel, setChannel] = useState<'all' | 'prod' | 'dev'>('all');
  const url = useMemo(() => {
    const params = new URLSearchParams({ limit: '80' });
    if (channel !== 'all') params.set('channel', channel);
    return `/api/releases?${params.toString()}`;
  }, [channel]);
  const { data, loading, error, refresh } = useFetch<ReleasesResponse>(url);
  const releases = data?.releases ?? [];

  return (
    <AnimatedPage>
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
        <div className="space-y-3">
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
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {t('novidades.title')}
          </h1>
          <p className="text-sm text-[var(--color-app-muted)]">{t('novidades.description')}</p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(['all', 'prod', 'dev'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setChannel(item)}
              className={[
                'h-7 rounded-md px-2.5 text-[11px] font-medium transition-colors',
                channel === item
                  ? 'bg-[var(--color-app-surface-hover)] text-[var(--color-app-fg)]'
                  : 'text-[var(--color-app-muted)] hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-subtle)]',
              ].join(' ')}
            >
              {t(`novidades.channel.${item}`)}
            </button>
          ))}
        </div>

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
          <ol className="space-y-4">
            {releases.map((entry, idx) => (
              <li
                key={`${entry.version}-${entry.channel}-${entry.pr ?? idx}-${entry.title ?? ''}`}
                className="rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/30 px-4 py-4 sm:px-5"
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
                  <div className="prose-release space-y-2 text-[13px] leading-relaxed text-[var(--color-app-muted)] whitespace-pre-wrap">
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
                    className="mt-3 inline-block text-[11px] text-violet-400/90 hover:underline"
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
