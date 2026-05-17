import { Link } from 'react-router-dom';
import { ArrowRight, ListVideo, PlayCircle, ShieldCheck } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { Badge } from '../components/ui/badge';
import { useFetch, useMe } from '../lib/hooks';
import type { JobSummary } from '../lib/types';
import { formatRelative } from '../lib/format';
import { jobStatusBadge } from '../lib/job-display';

export function DashboardPage(): React.ReactElement {
  const { data: me } = useMe();
  const { data, loading } = useFetch<{ jobs: JobSummary[] }>('/api/jobs');
  const jobs = data?.jobs ?? [];
  const queued = jobs.filter((j) => j.status === 'QUEUED' || j.status === 'RUNNING').length;
  const done = jobs.filter((j) => j.status === 'DONE').length;
  const failed = jobs.filter((j) => j.status === 'FAILED').length;

  return (
    <div className="px-8 py-10 mx-auto max-w-6xl space-y-10">
      <header className="flex items-end justify-between gap-6 flex-wrap">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-zinc-500 font-medium">
            Bem-vindo de volta
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {me?.user?.name?.split(' ')[0] ?? 'Olá'}
          </h1>
        </div>
        <Button variant="primary" size="lg" asChild>
          <Link to="/jobs">
            Transcrever vídeo
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Em processamento"
          value={loading ? null : queued}
          accent="amber"
          Icon={PlayCircle}
        />
        <StatCard
          label="Transcrições prontas"
          value={loading ? null : done}
          accent="emerald"
          Icon={ListVideo}
        />
        <StatCard
          label="Com erro"
          value={loading ? null : failed}
          accent={failed > 0 ? 'red' : 'zinc'}
          Icon={ShieldCheck}
        />
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Atividade recente</h2>
          <Button variant="link" size="sm" asChild>
            <Link to="/jobs">
              Ver tudo <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>

        {loading && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        )}

        {!loading && jobs.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center space-y-2">
              <p className="text-sm text-zinc-300">Nada por aqui ainda.</p>
              <p className="text-sm text-zinc-500">
                Cole um link de vídeo para começar seu acervo.
              </p>
              <Button variant="secondary" size="sm" asChild className="mt-3">
                <Link to="/jobs">Transcrever primeiro vídeo</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {!loading && jobs.length > 0 && (
          <Card>
            <ul className="divide-y divide-zinc-800/80">
              {jobs.slice(0, 5).map((j) => {
                const { variant, label } = jobStatusBadge(j.status);
                return (
                  <li
                    key={j.id}
                    className="flex items-center gap-4 px-5 py-4 hover:bg-zinc-900/40 transition-colors"
                  >
                    <Badge variant={variant} className="shrink-0 w-24 justify-center">
                      {label}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200 truncate font-mono">{j.sourceUrl}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {formatRelative(new Date(j.queuedAt))}
                      </p>
                    </div>
                    {j.transcriptId && (
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/transcricoes/${j.transcriptId}`}>Ver</Link>
                      </Button>
                    )}
                    {!j.transcriptId && (
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/jobs/${j.id}`}>Detalhes</Link>
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
  Icon,
}: {
  label: string;
  value: number | null;
  accent: 'amber' | 'emerald' | 'red' | 'zinc';
  Icon: typeof PlayCircle;
}): React.ReactElement {
  const colors: Record<typeof accent, string> = {
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
    zinc: 'text-zinc-500',
  };
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-zinc-500 font-medium">{label}</p>
            {value === null ? (
              <Skeleton className="h-8 w-12 mt-2" />
            ) : (
              <p className="text-3xl font-semibold tracking-tight mt-2 tabular-nums">{value}</p>
            )}
          </div>
          <Icon className={`h-5 w-5 ${colors[accent]}`} />
        </div>
      </CardContent>
    </Card>
  );
}
