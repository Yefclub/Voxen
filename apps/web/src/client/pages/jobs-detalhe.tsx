import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ExternalLink } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Spinner } from '../components/ui/spinner';
import { useFetch, useSse } from '../lib/hooks';
import type { JobSummary } from '../lib/types';
import { formatDateTime } from '../lib/format';
import { jobStatusBadge, stageLabel } from '../lib/job-display';

interface ProgressEvent {
  jobId: string;
  stage: string;
  percent?: number;
  chunkIndex?: number;
  transcriptId?: string;
  errorMsg?: string;
  ts: string;
}

export function JobDetalhePage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const { data, refresh } = useFetch<{ job: JobSummary }>(id ? `/api/jobs/${id}` : null);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [percent, setPercent] = useState<number>(0);

  const isActive = data?.job && (data.job.status === 'QUEUED' || data.job.status === 'RUNNING');

  const { connected, closed } = useSse<ProgressEvent>(
    isActive && id ? `/api/jobs/${id}/events` : null,
    (evt) => {
      setEvents((prev) => [...prev, evt]);
      if (typeof evt.percent === 'number') setPercent(evt.percent);
      if (evt.stage === 'done' || evt.stage === 'failed') {
        // pequena pausa pra mostrar o final, depois refetch
        setTimeout(() => refresh(), 600);
      }
    },
  );

  useEffect(() => {
    if (closed && isActive) {
      refresh();
    }
  }, [closed, isActive, refresh]);

  if (!data?.job) {
    return (
      <div className="px-8 py-16 flex justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const job = data.job;
  const { variant, label } = jobStatusBadge(job.status);
  const currentStage = events[events.length - 1]?.stage ?? 'queued';

  return (
    <div className="px-8 py-10 mx-auto max-w-3xl space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/jobs">
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar para fila
        </Link>
      </Button>

      <Card>
        <CardHeader className="border-b border-zinc-800/60 pb-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2 min-w-0">
              <CardTitle className="truncate font-mono text-base">{job.sourceUrl}</CardTitle>
              <p className="text-xs text-zinc-500">
                Enfileirado em {formatDateTime(new Date(job.queuedAt))}
                {job.finishedAt && ` · Finalizado em ${formatDateTime(new Date(job.finishedAt))}`}
              </p>
            </div>
            <Badge variant={variant}>{label}</Badge>
          </div>
        </CardHeader>

        <CardContent className="pt-6 space-y-5">
          {/* Progresso */}
          {isActive && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400 font-medium">{stageLabel(currentStage)}</span>
                <span className="text-zinc-500 tabular-nums">{percent}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300 ease-out"
                  style={{ width: `${Math.max(2, percent)}%` }}
                />
              </div>
              {connected && (
                <p className="text-[10px] uppercase tracking-wider text-emerald-500/70 flex items-center gap-1.5 mt-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Recebendo eventos em tempo real
                </p>
              )}
            </div>
          )}

          {/* Erro */}
          {job.status === 'FAILED' && job.errorMsg && (
            <Alert variant="destructive">
              <AlertDescription>{job.errorMsg}</AlertDescription>
            </Alert>
          )}

          {/* Sucesso */}
          {job.status === 'DONE' && job.transcriptId && (
            <Alert variant="success">
              <AlertDescription className="flex items-center justify-between gap-3 w-full">
                <span>Transcrição concluída.</span>
                <Button variant="primary" size="sm" asChild>
                  <Link to={`/transcricoes/${job.transcriptId}`}>
                    Abrir transcrição
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* Histórico de eventos (timeline) */}
          {events.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wider text-zinc-500 font-medium mt-4">
                Histórico
              </p>
              <ol className="border-l border-zinc-800 pl-4 space-y-2 text-sm">
                {events.map((e, i) => (
                  <li key={i} className="relative">
                    <span className="absolute -left-[1.125rem] top-1.5 h-2 w-2 rounded-full bg-zinc-700" />
                    <span className="text-zinc-200">{stageLabel(e.stage)}</span>
                    {typeof e.chunkIndex === 'number' && (
                      <span className="ml-2 text-xs text-zinc-500">bloco #{e.chunkIndex + 1}</span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Link original */}
          <div className="pt-4 border-t border-zinc-800/60">
            <a
              href={job.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1 transition-colors"
            >
              Abrir vídeo original
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
