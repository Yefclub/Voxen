import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Eraser,
  Globe,
  ListVideo,
  PlayCircle,
  Sparkles,
} from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { Badge } from '../components/ui/badge';
import { useFetch, useMe } from '../lib/hooks';
import type { JobSummary } from '../lib/types';
import { formatRelative } from '../lib/format';
import { jobStatusBadge } from '../lib/job-display';
import { useI18n, type Locale, type TranslateFn } from '../lib/i18n';
import {
  detectSourceFromUrl,
  displayJobSource,
  isUploadSourceUrl,
  youtubeVideoId,
} from '../lib/source-detect';
import { AnimatedPage, StaggerContainer, StaggerItem } from '../components/motion/animated-page';
import { NumberTicker } from '../components/motion/number-ticker';

export function DashboardPage(): React.ReactElement {
  const { data: me } = useMe();
  const { locale, t } = useI18n();
  const { data, loading } = useFetch<{ jobs: JobSummary[] }>('/api/jobs');
  const jobs = data?.jobs ?? [];
  const queued = jobs.filter((j) => j.status === 'QUEUED' || j.status === 'RUNNING').length;
  const done = jobs.filter((j) => j.status === 'DONE').length;
  const failed = jobs.filter((j) => j.status === 'FAILED').length;
  const firstName = me?.user?.name?.split(' ')[0] ?? t('dashboard.fallbackName');

  // "Limpar" oculta a lista de atividade recente (client-side, por usuário) sem
  // tocar nos jobs nem na biblioteca: persiste um timestamp e some os jobs
  // anteriores a ele; jobs novos voltam a aparecer.
  const userId = me?.user?.id;
  const storageKey = userId ? `voxen:dashboard:activity-cleared-at:${userId}` : null;
  const [clearedAt, setClearedAt] = useState(0);
  useEffect(() => {
    if (!storageKey) {
      setClearedAt(0);
      return;
    }
    const raw = window.localStorage.getItem(storageKey);
    setClearedAt(raw ? Number(raw) || 0 : 0);
  }, [storageKey]);

  const visibleJobs = useMemo(
    () => (clearedAt ? jobs.filter((j) => new Date(j.queuedAt).getTime() > clearedAt) : jobs),
    [jobs, clearedAt],
  );

  const clearActivity = useCallback(() => {
    if (!storageKey) return;
    const now = Date.now();
    window.localStorage.setItem(storageKey, String(now));
    setClearedAt(now);
    toast.success(t('dashboard.clearedToast'), {
      action: {
        label: t('dashboard.undo'),
        onClick: () => {
          window.localStorage.removeItem(storageKey);
          setClearedAt(0);
        },
      },
    });
  }, [storageKey, t]);

  return (
    <AnimatedPage>
      <div className="px-4 sm:px-8 py-8 sm:py-12 mx-auto max-w-6xl space-y-12">
        {/* Header */}
        <header className="flex items-end justify-between gap-6 flex-wrap">
          <div className="space-y-2">
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4 }}
              className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium"
            >
              <Sparkles className="h-3 w-3 text-emerald-400" />
              {t('dashboard.welcome')}
            </motion.div>
            <h1 className="font-display text-4xl font-semibold tracking-[-0.03em] text-balance">
              {firstName}.
            </h1>
          </div>
          <Button variant="primary" size="lg" asChild>
            <Link to="/jobs">
              {t('dashboard.newContent')}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </header>

        {/* Stats com number tickers */}
        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StaggerItem>
            <StatCard
              label={t('dashboard.processing')}
              value={loading ? null : queued}
              accent="amber"
              Icon={PlayCircle}
              loading={loading}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label={t('dashboard.readyTranscripts')}
              value={loading ? null : done}
              accent="emerald"
              Icon={ListVideo}
              loading={loading}
              hero={done > 0}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label={t('dashboard.failed')}
              value={loading ? null : failed}
              accent={failed > 0 ? 'rose' : 'muted'}
              Icon={ArrowUpRight}
              loading={loading}
            />
          </StaggerItem>
        </StaggerContainer>

        {/* Atividade recente */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-xl font-semibold tracking-tight">
                {t('dashboard.recentActivity')}
              </h2>
              {visibleJobs.length > 0 && (
                <span className="text-xs text-[var(--color-app-muted)] tabular-nums">
                  {visibleJobs.length}{' '}
                  {visibleJobs.length === 1
                    ? t('dashboard.itemSingular')
                    : t('dashboard.itemPlural')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {visibleJobs.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearActivity}
                  className="text-[var(--color-app-muted)]"
                >
                  <Eraser className="h-3.5 w-3.5" />
                  {t('dashboard.clearActivity')}
                </Button>
              )}
              <Button variant="link" size="sm" asChild>
                <Link to="/jobs" className="text-[var(--color-app-muted)]">
                  {t('dashboard.viewAll')}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </div>

          {loading && (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          )}

          {!loading && jobs.length === 0 && <EmptyState t={t} />}

          {!loading && jobs.length > 0 && visibleJobs.length === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-sm text-[var(--color-app-muted)]">
                {t('dashboard.allClear')}
              </CardContent>
            </Card>
          )}

          {!loading && visibleJobs.length > 0 && (
            <Card>
              <StaggerContainer delay={0.1}>
                <ul className="divide-y divide-[var(--color-app-border)]">
                  {visibleJobs.slice(0, 5).map((j) => (
                    <StaggerItem key={j.id}>
                      <ActivityRow job={j} locale={locale} t={t} />
                    </StaggerItem>
                  ))}
                </ul>
              </StaggerContainer>
            </Card>
          )}
        </section>
      </div>
    </AnimatedPage>
  );
}

function ActivityRow({
  job,
  locale,
  t,
}: {
  job: JobSummary;
  locale: Locale;
  t: TranslateFn;
}): React.ReactElement {
  const { variant, label } = jobStatusBadge(job.status, t);
  const to = job.transcriptId ? `/transcricoes/${job.transcriptId}` : `/jobs/${job.id}`;
  const source = detectSourceFromUrl(job.sourceUrl);
  const isUpload = isUploadSourceUrl(job.sourceUrl);
  const ytId = source === 'YOUTUBE' ? youtubeVideoId(job.sourceUrl) : null;
  return (
    <li className="group">
      <Link
        to={to}
        className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-[var(--color-app-surface-hover)]/50 focus:outline-none focus-visible:bg-[var(--color-app-surface-hover)]"
      >
        <SourcePreview source={source} ytId={ytId} isUpload={isUpload} />
        <Badge variant={variant} className="shrink-0 min-w-28 justify-center text-center">
          {label}
        </Badge>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-zinc-200 truncate font-mono tracking-tight">
            {displayJobSource(job.sourceUrl)}
          </p>
          <p className="text-xs text-[var(--color-app-muted)] mt-0.5">
            {formatRelative(new Date(job.queuedAt), locale)}
          </p>
        </div>
        <ArrowRight className="h-4 w-4 text-[var(--color-app-muted)] transition-all opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 shrink-0" />
      </Link>
    </li>
  );
}

function SourcePreview({
  source,
  ytId,
  isUpload,
}: {
  source: ReturnType<typeof detectSourceFromUrl>;
  ytId: string | null;
  isUpload: boolean;
}): React.ReactElement {
  if (source === 'YOUTUBE' && ytId) {
    return (
      <div className="shrink-0 h-14 w-24 rounded-lg overflow-hidden bg-[var(--color-app-bg-elevated)] border border-[var(--color-app-border)]">
        <img
          src={`https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={(e) => {
            const img = e.currentTarget as HTMLImageElement;
            img.style.display = 'none';
          }}
        />
      </div>
    );
  }
  // Sem thumbnail real (IG/TT precisariam fetch externo, web não tem). Fallback
  // visual com ícone temático por fonte — preserva consistência da grid.
  const map = {
    INSTAGRAM: {
      Icon: PlayCircle,
      cls: 'from-fuchsia-500/15 to-pink-500/5 text-fuchsia-300/80 border-fuchsia-500/20',
    },
    TIKTOK: {
      Icon: PlayCircle,
      cls: 'from-emerald-500/15 to-cyan-500/5 text-emerald-300/80 border-emerald-500/20',
    },
    X: {
      Icon: PlayCircle,
      cls: 'from-sky-500/15 to-blue-500/5 text-sky-300/80 border-sky-500/20',
    },
    WEB: {
      Icon: Globe,
      cls: 'from-zinc-500/10 to-zinc-500/5 text-zinc-400 border-zinc-500/20',
    },
    YOUTUBE: {
      Icon: PlayCircle,
      cls: 'from-rose-500/15 to-rose-500/5 text-rose-300/80 border-rose-500/20',
    },
    null: {
      Icon: PlayCircle,
      cls: 'from-zinc-500/10 to-zinc-500/5 text-zinc-400 border-zinc-500/20',
    },
  } as const;
  if (isUpload) {
    return (
      <div className="shrink-0 h-14 w-24 rounded-lg overflow-hidden border bg-gradient-to-br from-emerald-500/15 to-violet-500/5 text-emerald-300/80 border-emerald-500/20 flex items-center justify-center">
        <PlayCircle className="h-5 w-5" />
      </div>
    );
  }
  const { Icon, cls } =
    source === null ? map.null : (map[source as Exclude<typeof source, null>] ?? map.null);
  return (
    <div
      className={`shrink-0 h-14 w-24 rounded-lg overflow-hidden border bg-gradient-to-br flex items-center justify-center ${cls}`}
    >
      <Icon className="h-5 w-5" />
    </div>
  );
}

function EmptyState({ t }: { t: TranslateFn }): React.ReactElement {
  return (
    <Card elevated className="overflow-hidden relative">
      <div
        aria-hidden
        className="absolute inset-0 opacity-50"
        style={{
          background:
            'radial-gradient(ellipse 60% 80% at 50% 0%, oklch(72% 0.18 290 / 0.12), transparent 70%)',
        }}
      />
      <CardContent className="relative py-16 text-center space-y-4">
        <div className="mx-auto h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-violet-500/20 border border-[var(--color-app-border-strong)] flex items-center justify-center">
          <PlayCircle className="h-5 w-5 text-emerald-400" />
        </div>
        <div className="space-y-1.5">
          <p className="font-display text-lg font-semibold tracking-tight">
            {t('dashboard.emptyTitle')}
          </p>
          <p className="text-sm text-[var(--color-app-muted)] max-w-sm mx-auto leading-relaxed">
            {t('dashboard.emptyDescription')}
          </p>
        </div>
        <Button variant="primary" size="lg" asChild className="mt-2">
          <Link to="/jobs">
            {t('dashboard.emptyCta')}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

interface StatCardProps {
  label: string;
  value: number | null;
  accent: 'emerald' | 'amber' | 'rose' | 'muted';
  Icon: typeof PlayCircle;
  loading: boolean;
  hero?: boolean;
}

function StatCard({
  label,
  value,
  accent,
  Icon,
  loading,
  hero,
}: StatCardProps): React.ReactElement {
  const accentMap = {
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    rose: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
    muted:
      'text-[var(--color-app-muted)] bg-[var(--color-app-surface-hover)] border-[var(--color-app-border)]',
  } as const;
  const iconColors = {
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    rose: 'text-rose-400',
    muted: 'text-[var(--color-app-muted)]',
  } as const;

  return (
    <Card hoverable elevated glow={hero ? 'emerald' : null}>
      <CardContent className="pt-6 pb-5">
        <div className="flex items-start justify-between">
          <div className="space-y-2.5 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium">
              {label}
            </p>
            {loading || value === null ? (
              <Skeleton className="h-10 w-16" />
            ) : (
              <p className="font-display text-4xl font-semibold tracking-[-0.03em] tabular-nums leading-none">
                <NumberTicker value={value} />
              </p>
            )}
          </div>
          <div
            className={`h-9 w-9 rounded-xl border flex items-center justify-center shrink-0 ${accentMap[accent]}`}
          >
            <Icon className={`h-4 w-4 ${iconColors[accent]}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
