import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, ArrowRight, CheckCircle2, ExternalLink, XCircle } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Spinner } from '../components/ui/spinner';
import { useFetch, useSse } from '../lib/hooks';
import type { JobSummary } from '../lib/types';
import { formatDateTime } from '../lib/format';
import { jobStatusBadge, stageLabel } from '../lib/job-display';
import { AnimatedPage } from '../components/motion/animated-page';

interface ProgressEvent {
  jobId: string;
  stage: string;
  percent?: number;
  chunkIndex?: number;
  transcriptId?: string;
  errorMsg?: string;
  ts: string;
}

const STAGE_ORDER = [
  'queued',
  'running',
  'downloading',
  'extracting_audio',
  'choosing_method',
  'transcribing',
  'uploading',
  'indexing',
  'done',
];

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
        setTimeout(() => refresh(), 600);
      }
    },
  );

  useEffect(() => {
    if (closed && isActive) refresh();
  }, [closed, isActive, refresh]);

  if (!data?.job) {
    return (
      <div className="px-8 py-20 flex justify-center">
        <Spinner size={20} className="text-[var(--color-app-muted)]" />
      </div>
    );
  }

  const job = data.job;
  const { variant, label } = jobStatusBadge(job.status);
  const currentStage = events[events.length - 1]?.stage ?? 'queued';
  const currentStageIdx = STAGE_ORDER.indexOf(currentStage);

  return (
    <AnimatedPage>
      <div className="px-8 py-10 mx-auto max-w-3xl space-y-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link to="/jobs">
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar para fila
          </Link>
        </Button>

        <Card elevated className="overflow-hidden relative">
          {/* Glow no topo se ativo */}
          {isActive && (
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 h-32 pointer-events-none"
              style={{
                background:
                  'radial-gradient(ellipse 80% 100% at 50% 0%, oklch(72% 0.18 290 / 0.15), transparent 70%)',
              }}
            />
          )}

          <div className="relative px-6 pt-6 pb-5 border-b border-[var(--color-app-border)]">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="space-y-2 min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium">
                  Job · {job.id.slice(0, 12)}
                </p>
                <h2 className="font-mono text-[15px] font-medium tracking-tight text-zinc-100 truncate">
                  {job.sourceUrl}
                </h2>
              </div>
              <Badge variant={variant} className="text-xs">
                {label}
              </Badge>
            </div>
            <p className="text-xs text-[var(--color-app-muted)] mt-3">
              Enfileirado em {formatDateTime(new Date(job.queuedAt))}
              {job.finishedAt && <> · Finalizado em {formatDateTime(new Date(job.finishedAt))}</>}
            </p>
          </div>

          <CardContent className="pt-6 space-y-6 relative">
            {/* Bloco de progresso */}
            {isActive && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="absolute inset-0 rounded-full bg-violet-400 animate-ping opacity-60" />
                      <span className="relative rounded-full bg-violet-400 h-full w-full" />
                    </span>
                    <span className="text-sm font-medium text-zinc-100 truncate">
                      {stageLabel(currentStage)}
                    </span>
                  </div>
                  <span className="text-2xl font-display font-semibold tabular-nums text-zinc-100">
                    {percent}
                    <span className="text-sm text-[var(--color-app-muted)] ml-0.5">%</span>
                  </span>
                </div>

                <div className="relative h-2 w-full overflow-hidden rounded-full bg-[var(--color-app-bg-elevated)] border border-[var(--color-app-border)]">
                  <motion.div
                    initial={{ width: '0%' }}
                    animate={{ width: `${Math.max(2, percent)}%` }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-emerald-400 to-violet-400 shadow-[0_0_12px_oklch(73%_0.16_159_/_0.5)]"
                  />
                </div>

                {connected && (
                  <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-400/80 flex items-center gap-2">
                    <span className="h-1 w-1 rounded-full bg-emerald-400 animate-pulse" />
                    Recebendo eventos em tempo real
                  </p>
                )}
              </div>
            )}

            {/* Estado de sucesso */}
            {job.status === 'DONE' && job.transcriptId && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative rounded-xl bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border border-emerald-500/30 p-5"
              >
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                      <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                    </div>
                    <div>
                      <p className="font-display text-base font-semibold text-emerald-200">
                        Transcrição concluída
                      </p>
                      <p className="text-xs text-emerald-300/70 mt-0.5">
                        Já está no seu acervo, pronta para consultar.
                      </p>
                    </div>
                  </div>
                  <Button variant="primary" size="sm" asChild>
                    <Link to={`/transcricoes/${job.transcriptId}`}>
                      Abrir
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Estado de erro */}
            {job.status === 'FAILED' && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4 text-rose-400 mt-0.5 shrink-0" />
                <AlertDescription>{job.errorMsg ?? 'Algo deu errado.'}</AlertDescription>
              </Alert>
            )}

            {/* Timeline de eventos */}
            {events.length > 0 && (
              <div className="space-y-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium">
                  Histórico
                </p>
                <ol className="relative border-l border-[var(--color-app-border)] pl-5 space-y-2.5">
                  <AnimatePresence initial={false}>
                    {events.map((e, i) => {
                      const stageIdx = STAGE_ORDER.indexOf(e.stage);
                      const isCurrent = i === events.length - 1 && isActive;
                      const isDone = stageIdx >= 0 && stageIdx < currentStageIdx;
                      return (
                        <motion.li
                          key={`${e.stage}-${i}`}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.3 }}
                          className="relative text-sm"
                        >
                          <span
                            className={[
                              'absolute -left-[1.46rem] top-1.5 h-2 w-2 rounded-full ring-4 ring-[var(--color-app-surface)]',
                              isCurrent
                                ? 'bg-violet-400'
                                : isDone || e.stage === 'done'
                                  ? 'bg-emerald-400'
                                  : e.stage === 'failed'
                                    ? 'bg-rose-400'
                                    : 'bg-[var(--color-app-border-strong)]',
                            ].join(' ')}
                          />
                          <span className="text-zinc-200">{stageLabel(e.stage)}</span>
                          {typeof e.chunkIndex === 'number' && (
                            <span className="ml-2 text-xs text-[var(--color-app-muted)] tabular-nums">
                              bloco #{e.chunkIndex + 1}
                            </span>
                          )}
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ol>
              </div>
            )}

            {/* Link original */}
            <div className="pt-4 border-t border-[var(--color-app-border)]">
              <a
                href={job.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[var(--color-app-muted)] hover:text-zinc-100 inline-flex items-center gap-1.5 transition-colors group"
              >
                Abrir vídeo original
                <ExternalLink className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </AnimatedPage>
  );
}
