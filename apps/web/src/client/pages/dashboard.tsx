import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, ListVideo, PlayCircle, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { Badge } from '../components/ui/badge';
import { useFetch, useMe } from '../lib/hooks';
import type { JobSummary } from '../lib/types';
import { formatRelative } from '../lib/format';
import { jobStatusBadge } from '../lib/job-display';
import { AnimatedPage, StaggerContainer, StaggerItem } from '../components/motion/animated-page';
import { NumberTicker } from '../components/motion/number-ticker';

export function DashboardPage(): React.ReactElement {
  const { data: me } = useMe();
  const { data, loading } = useFetch<{ jobs: JobSummary[] }>('/api/jobs');
  const jobs = data?.jobs ?? [];
  const queued = jobs.filter((j) => j.status === 'QUEUED' || j.status === 'RUNNING').length;
  const done = jobs.filter((j) => j.status === 'DONE').length;
  const failed = jobs.filter((j) => j.status === 'FAILED').length;
  const firstName = me?.user?.name?.split(' ')[0] ?? 'Olá';

  return (
    <AnimatedPage>
      <div className="px-8 py-12 mx-auto max-w-6xl space-y-12">
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
              Bem-vindo de volta
            </motion.div>
            <h1 className="font-display text-4xl font-semibold tracking-[-0.03em] text-balance">
              {firstName}.
            </h1>
          </div>
          <Button variant="primary" size="lg" asChild>
            <Link to="/jobs">
              Transcrever vídeo
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </header>

        {/* Stats com number tickers */}
        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StaggerItem>
            <StatCard
              label="Em processamento"
              value={loading ? null : queued}
              accent="amber"
              Icon={PlayCircle}
              loading={loading}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label="Transcrições prontas"
              value={loading ? null : done}
              accent="emerald"
              Icon={ListVideo}
              loading={loading}
              hero={done > 0}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label="Com erro"
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
                Atividade recente
              </h2>
              {jobs.length > 0 && (
                <span className="text-xs text-[var(--color-app-muted)] tabular-nums">
                  {jobs.length} {jobs.length === 1 ? 'item' : 'itens'}
                </span>
              )}
            </div>
            <Button variant="link" size="sm" asChild>
              <Link to="/jobs" className="text-[var(--color-app-muted)]">
                Ver tudo
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>

          {loading && (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          )}

          {!loading && jobs.length === 0 && <EmptyState />}

          {!loading && jobs.length > 0 && (
            <Card>
              <StaggerContainer delay={0.1}>
                <ul className="divide-y divide-[var(--color-app-border)]">
                  {jobs.slice(0, 5).map((j) => {
                    const { variant, label } = jobStatusBadge(j.status);
                    return (
                      <StaggerItem key={j.id}>
                        <li className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-[var(--color-app-surface-hover)]/50">
                          <Badge variant={variant} className="shrink-0 w-28 justify-center">
                            {label}
                          </Badge>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-zinc-200 truncate font-mono tracking-tight">
                              {j.sourceUrl}
                            </p>
                            <p className="text-xs text-[var(--color-app-muted)] mt-0.5">
                              {formatRelative(new Date(j.queuedAt))}
                            </p>
                          </div>
                          {j.transcriptId ? (
                            <Button variant="ghost" size="sm" asChild>
                              <Link to={`/transcricoes/${j.transcriptId}`}>
                                Ver
                                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                              </Link>
                            </Button>
                          ) : (
                            <Button variant="ghost" size="sm" asChild>
                              <Link to={`/jobs/${j.id}`}>
                                Detalhes
                                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                              </Link>
                            </Button>
                          )}
                        </li>
                      </StaggerItem>
                    );
                  })}
                </ul>
              </StaggerContainer>
            </Card>
          )}
        </section>
      </div>
    </AnimatedPage>
  );
}

function EmptyState(): React.ReactElement {
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
          <p className="font-display text-lg font-semibold tracking-tight">Comece sua biblioteca</p>
          <p className="text-sm text-[var(--color-app-muted)] max-w-sm mx-auto leading-relaxed">
            Cole um link de vídeo para o Voxen transcrever e indexar. Tudo fica disponível para
            conversar com o agente depois.
          </p>
        </div>
        <Button variant="primary" size="lg" asChild className="mt-2">
          <Link to="/jobs">
            Transcrever primeiro vídeo
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
