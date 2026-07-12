import { Link } from 'react-router-dom';
import { House } from 'lucide-react';
import { useFetch, useMe } from '../lib/hooks';
import type { JobSummary } from '../lib/types';
import { AnimatedPage } from '../components/motion/animated-page';
import { useI18n } from '../lib/i18n';

export function HomePage(): React.ReactElement {
  const { data: me } = useMe();
  const { t } = useI18n();
  const firstName = me?.user?.name?.split(' ')[0] ?? t('dashboard.fallbackName');

  // Lightweight summary for mobile landing badges (links to /fila).
  const { data, loading } = useFetch<{
    jobs: JobSummary[];
    total: number;
  }>('/api/jobs?page=1&limit=10');

  const jobs = data?.jobs ?? [];
  const queued = jobs.filter((j) => j.status === 'QUEUED' || j.status === 'RUNNING').length;
  const done = jobs.filter((j) => j.status === 'DONE').length;
  const failed = jobs.filter((j) => j.status === 'FAILED').length;

  return (
    <AnimatedPage>
      <div className="relative mx-auto max-w-5xl space-y-5 px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--color-app-muted)]">
              <House className="h-3 w-3 text-zinc-400" />
              {t('home.eyebrow')}
            </div>
            <div className="space-y-1.5">
              <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
                {t('home.greeting', { name: firstName })}
              </h1>
              <p className="hidden max-w-2xl text-sm leading-relaxed text-[var(--color-app-muted)] sm:block">
                {t('home.description')}
              </p>
            </div>
          </div>
          {!loading && jobs.length > 0 && (
            <Link
              to="/fila"
              className="flex flex-wrap gap-1.5 text-[11px] tabular-nums text-[var(--color-app-muted)] transition-opacity hover:opacity-90"
              aria-label={t('jobs.queueTitle')}
            >
              <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-200">
                {queued} {t('dashboard.processing').toLowerCase()}
              </span>
              <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-200">
                {done} {t('home.statReady')}
              </span>
              {failed > 0 && (
                <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-rose-200">
                  {failed} {t('dashboard.failed').toLowerCase()}
                </span>
              )}
            </Link>
          )}
        </header>
      </div>
    </AnimatedPage>
  );
}
