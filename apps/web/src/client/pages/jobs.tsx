import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Globe, Link2, PlayCircle, Plus, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Spinner } from '../components/ui/spinner';
import { ApiError, apiPost } from '../lib/api';
import { useFetch, useSse } from '../lib/hooks';
import { formatRelative } from '../lib/format';
import { jobStatusBadge, stageLabel } from '../lib/job-display';
import type { JobStatus, JobSummary } from '../lib/types';
import { AnimatedPage, StaggerContainer, StaggerItem } from '../components/motion/animated-page';

interface ProgressEvent {
  jobId: string;
  stage: string;
  percent?: number;
  chunkIndex?: number;
  transcriptId?: string;
  errorMsg?: string;
  ts: string;
}

type SourceTab = 'youtube' | 'web';

export function JobsPage(): React.ReactElement {
  const [tab, setTab] = useState<SourceTab>('youtube');
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data, loading, refresh } = useFetch<{ jobs: JobSummary[] }>('/api/jobs');
  const navigate = useNavigate();

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const endpoint = tab === 'web' ? '/api/jobs/scrape' : '/api/jobs';
      const res = await apiPost<{ jobId: string; status: JobStatus; sourceUrl: string }>(endpoint, {
        url,
      });
      setUrl('');
      refresh();
      const successMsg = tab === 'web' ? 'Página na fila.' : 'Vídeo na fila.';
      toast.success(successMsg, {
        description: 'Acompanhe o progresso em tempo real.',
        action: {
          label: 'Abrir',
          onClick: () => navigate(`/jobs/${res.jobId}`),
        },
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.status === 409 && err.body && typeof err.body === 'object') {
          const transcriptId = (err.body as { transcriptId?: string }).transcriptId;
          if (transcriptId) {
            toast('Já indexado.', {
              action: {
                label: 'Abrir',
                onClick: () => navigate(`/transcricoes/${transcriptId}`),
              },
            });
          }
        }
      } else {
        setError('Erro inesperado.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const jobs = data?.jobs ?? [];

  return (
    <AnimatedPage>
      <div className="px-8 py-12 mx-auto max-w-6xl space-y-10">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium">
            <PlayCircle className="h-3.5 w-3.5 text-rose-400" />
            Indexar conteúdo
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-[-0.03em]">Novo conteúdo</h1>
          <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed max-w-2xl">
            Cole um link do YouTube ou de uma página web. O Voxen indexa pra busca e pro chat com o
            agente.
          </p>
        </header>

        {/* Abas: YouTube | Web */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--color-app-surface)]/60 border border-[var(--color-app-border)] w-fit">
          <button
            type="button"
            onClick={() => {
              setTab('youtube');
              setError(null);
              setUrl('');
            }}
            className={
              tab === 'youtube'
                ? 'flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium bg-[var(--color-app-bg-elevated)] text-zinc-100 border border-[var(--color-app-border-strong)]'
                : 'flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium text-[var(--color-app-muted)] hover:text-zinc-100 transition-colors'
            }
          >
            <PlayCircle className="h-3.5 w-3.5" />
            Vídeo
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('web');
              setError(null);
              setUrl('');
            }}
            className={
              tab === 'web'
                ? 'flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium bg-[var(--color-app-bg-elevated)] text-zinc-100 border border-[var(--color-app-border-strong)]'
                : 'flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium text-[var(--color-app-muted)] hover:text-zinc-100 transition-colors'
            }
          >
            <Globe className="h-3.5 w-3.5" />
            Página web
          </button>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <Card elevated className="overflow-hidden relative">
            <div
              aria-hidden
              className="absolute inset-0 opacity-40 pointer-events-none"
              style={{
                background:
                  'radial-gradient(ellipse 80% 50% at 0% 0%, oklch(73% 0.16 159 / 0.08), transparent 60%)',
              }}
            />
            <CardContent className="pt-6 relative">
              <form onSubmit={onSubmit} className="space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-2">
                  <Label htmlFor="url">{tab === 'web' ? 'URL da página' : 'URL do vídeo'}</Label>
                  <div className="flex gap-2.5">
                    <div className="relative flex-1">
                      <Link2 className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-app-muted)] pointer-events-none" />
                      <Input
                        id="url"
                        type="url"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder={
                          tab === 'web'
                            ? 'https://exemplo.com/artigo'
                            : 'https://youtu.be/... · instagram.com/reel/... · tiktok.com/@user/video/...'
                        }
                        autoComplete="off"
                        required
                        className="pl-10 font-mono h-11 text-[15px]"
                      />
                    </div>
                    <Button
                      type="submit"
                      variant="primary"
                      size="lg"
                      disabled={submitting || url.trim().length === 0}
                      className="h-11 px-5"
                    >
                      {submitting ? <Spinner /> : <Plus className="h-4 w-4" />}
                      Adicionar
                    </Button>
                  </div>
                  <p className="text-xs text-[var(--color-app-muted)]">
                    {tab === 'web'
                      ? 'Aceita blogs, news, docs, wikis. SPAs/JS-heavy podem falhar.'
                      : 'Aceita YouTube (watch/shorts), Instagram (reel/p/tv) e TikTok público.'}
                  </p>
                </div>
              </form>
            </CardContent>
          </Card>
        </motion.div>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-xl font-semibold tracking-tight">Sua fila</h2>
              {jobs.length > 0 && (
                <span className="text-xs text-[var(--color-app-muted)] tabular-nums">
                  {jobs.length} {jobs.length === 1 ? 'item' : 'itens'}
                </span>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={refresh}>
              <RefreshCw className="h-3.5 w-3.5" />
              Atualizar
            </Button>
          </div>

          {loading && (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          )}

          {!loading && jobs.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center text-sm text-[var(--color-app-muted)]">
                Você ainda não enviou nenhum vídeo. Cole um link acima para começar.
              </CardContent>
            </Card>
          )}

          {!loading && jobs.length > 0 && (
            <Card>
              <StaggerContainer delay={0.05}>
                <ul className="divide-y divide-[var(--color-app-border)]">
                  {jobs.map((j) => (
                    <StaggerItem key={j.id}>
                      <JobRow job={j} onUpdate={refresh} />
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

function JobRow({ job, onUpdate }: { job: JobSummary; onUpdate: () => void }): React.ReactElement {
  const isActive = job.status === 'QUEUED' || job.status === 'RUNNING';
  const [stage, setStage] = useState<string>(job.status === 'RUNNING' ? 'running' : 'queued');
  const [percent, setPercent] = useState<number>(0);

  useSse<ProgressEvent>(isActive ? `/api/jobs/${job.id}/events` : null, (evt) => {
    setStage(evt.stage);
    if (typeof evt.percent === 'number') setPercent(evt.percent);
    if (evt.stage === 'done' || evt.stage === 'failed') {
      setTimeout(onUpdate, 400);
    }
  });

  const { variant, label } = jobStatusBadge(job.status);

  return (
    <li className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-[var(--color-app-surface-hover)]/50">
      <Badge variant={variant} className="shrink-0 w-28 justify-center">
        {isActive ? stageLabel(stage) : label}
      </Badge>
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className="text-sm text-zinc-200 truncate font-mono tracking-tight">{job.sourceUrl}</p>
        {isActive ? (
          <div className="flex items-center gap-2.5">
            <div className="h-1 flex-1 max-w-[280px] rounded-full bg-[var(--color-app-bg-elevated)] overflow-hidden">
              <motion.div
                animate={{ width: `${Math.max(3, percent)}%` }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="h-full rounded-full bg-emerald-500"
              />
            </div>
            <span className="text-[10px] font-mono tabular-nums text-[var(--color-app-muted)]">
              {percent}%
            </span>
          </div>
        ) : (
          <p className="text-xs text-[var(--color-app-muted)]">
            {job.finishedAt
              ? `Finalizado ${formatRelative(new Date(job.finishedAt))}`
              : `Enfileirado ${formatRelative(new Date(job.queuedAt))}`}
          </p>
        )}
        {job.errorMsg && !isActive && <p className="text-xs text-rose-300 mt-1">{job.errorMsg}</p>}
      </div>
      {job.transcriptId ? (
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/transcricoes/${job.transcriptId}`}>
            Abrir
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </Button>
      ) : (
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/jobs/${job.id}`}>
            Detalhes
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </Button>
      )}
    </li>
  );
}
