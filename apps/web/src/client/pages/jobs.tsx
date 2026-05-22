import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Globe, Link2, PlayCircle, Plus, RefreshCw, Upload, X } from 'lucide-react';
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
import { detectSourceFromUrl, displayJobSource, type DetectedSource } from '../lib/source-detect';
import { AnimatedPage, StaggerContainer, StaggerItem } from '../components/motion/animated-page';
import { useI18n, type Locale, type TranslateFn } from '../lib/i18n';

interface ProgressEvent {
  jobId: string;
  stage: string;
  percent?: number;
  chunkIndex?: number;
  transcriptId?: string;
  errorMsg?: string;
  ts: string;
}

export function JobsPage(): React.ReactElement {
  const [mode, setMode] = useState<'link' | 'upload'>('link');
  const [url, setUrl] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data, loading, refresh } = useFetch<{ jobs: JobSummary[] }>('/api/jobs');
  const navigate = useNavigate();
  const { locale, t } = useI18n();

  // Detecta tipo enquanto user digita — UI mostra badge "Vídeo do YouTube",
  // "Página web", etc. Reaproveita o mesmo regex do back (parseVideoUrl).
  const detected: DetectedSource | null = useMemo(
    () => (url.trim() ? detectSourceFromUrl(url.trim()) : null),
    [url],
  );

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiPost<{
        jobId: string;
        status: JobStatus;
        sourceUrl: string;
        kind: 'video' | 'web';
      }>('/api/jobs/auto', { url });
      setUrl('');
      refresh();
      const successMsg =
        res.kind === 'web' ? t('jobs.toast.webQueued') : t('jobs.toast.videoQueued');
      toast.success(successMsg, {
        description: t('jobs.toast.progress'),
        action: {
          label: t('common.open'),
          onClick: () => navigate(`/jobs/${res.jobId}`),
        },
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.status === 409 && err.body && typeof err.body === 'object') {
          const transcriptId = (err.body as { transcriptId?: string }).transcriptId;
          if (transcriptId) {
            toast(t('jobs.toast.alreadyIndexed'), {
              action: {
                label: t('common.open'),
                onClick: () => navigate(`/transcricoes/${transcriptId}`),
              },
            });
          }
        }
      } else {
        setError(t('jobs.error.unexpected'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onUploadSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!mediaFile) return;
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('media', mediaFile);
      const res = await fetch('/api/jobs/upload', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const body = (await res.json().catch(() => ({}))) as {
        jobId?: string;
        status?: JobStatus;
        sourceUrl?: string;
        kind?: 'media' | 'image' | 'document';
        error?: string;
      };
      if (!res.ok || !body.jobId) {
        throw new ApiError(body.error ?? t('jobs.error.upload'), res.status, body);
      }
      setMediaFile(null);
      refresh();
      toast.success(
        body.kind === 'image'
          ? t('jobs.toast.imageQueued')
          : body.kind === 'document'
            ? t('jobs.toast.documentQueued')
            : t('jobs.toast.fileQueued'),
        {
          description:
            body.kind === 'image'
              ? t('jobs.toast.imageDescription')
              : body.kind === 'document'
                ? t('jobs.toast.documentDescription')
                : t('jobs.toast.mediaDescription'),
          action: {
            label: t('common.open'),
            onClick: () => navigate(`/jobs/${body.jobId}`),
          },
        },
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('jobs.error.unexpected'));
    } finally {
      setUploading(false);
    }
  }

  const jobs = data?.jobs ?? [];
  const hasActiveJobs = jobs.some((job) => job.status === 'QUEUED' || job.status === 'RUNNING');

  useEffect(() => {
    if (!hasActiveJobs) return;
    const id = window.setInterval(() => {
      refresh();
    }, 6_000);
    return () => window.clearInterval(id);
  }, [hasActiveJobs, refresh]);

  return (
    <AnimatedPage>
      <div className="px-8 py-12 mx-auto max-w-6xl space-y-10">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium">
            <PlayCircle className="h-3.5 w-3.5 text-rose-400" />
            {t('jobs.eyebrow')}
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-[-0.03em]">
            {t('jobs.title')}
          </h1>
          <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed max-w-2xl">
            {t('jobs.description')}
          </p>
        </header>

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
              <div className="space-y-4">
                <div className="inline-flex rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] p-1">
                  <button
                    type="button"
                    onClick={() => setMode('link')}
                    className={[
                      'inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-medium transition-colors',
                      mode === 'link'
                        ? 'bg-[var(--color-app-surface)] text-zinc-100 shadow-sm'
                        : 'text-[var(--color-app-muted)] hover:text-zinc-100',
                    ].join(' ')}
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    {t('jobs.mode.link')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('upload')}
                    className={[
                      'inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-medium transition-colors',
                      mode === 'upload'
                        ? 'bg-[var(--color-app-surface)] text-zinc-100 shadow-sm'
                        : 'text-[var(--color-app-muted)] hover:text-zinc-100',
                    ].join(' ')}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {t('jobs.mode.upload')}
                  </button>
                </div>

                {error && (
                  <Alert variant="destructive">
                    <AlertDescription className="break-words">{error}</AlertDescription>
                  </Alert>
                )}

                {mode === 'link' ? (
                  <form onSubmit={onSubmit} className="space-y-2">
                    <div className="flex items-center justify-between min-h-[20px]">
                      <Label htmlFor="url">Link</Label>
                      {detected && (
                        <motion.div
                          initial={{ opacity: 0, y: -2 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.18 }}
                        >
                          <DetectedBadge source={detected} t={t} />
                        </motion.div>
                      )}
                    </div>
                    <div className="flex flex-col gap-2.5 sm:flex-row">
                      <div className="relative flex-1">
                        <Link2 className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-app-muted)] pointer-events-none" />
                        <Input
                          id="url"
                          type="url"
                          value={url}
                          onChange={(e) => setUrl(e.target.value)}
                          placeholder="https://youtu.be/... · x.com/.../status/... · exemplo.com/artigo"
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
                        className="h-11 px-5 sm:w-auto"
                      >
                        {submitting ? <Spinner /> : <Plus className="h-4 w-4" />}
                        {t('jobs.add')}
                      </Button>
                    </div>
                    <p className="text-xs text-[var(--color-app-muted)]">{t('jobs.linkHint')}</p>
                  </form>
                ) : (
                  <form onSubmit={onUploadSubmit} className="space-y-3">
                    <Label htmlFor="media">{t('jobs.uploadLabel')}</Label>
                    <div className="space-y-2.5 sm:flex sm:gap-2.5 sm:space-y-0">
                      <div className="flex gap-2.5 sm:flex-1">
                        <label className="relative flex h-11 flex-1 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[var(--color-app-border-strong)] bg-[var(--color-app-bg-elevated)] px-3 text-sm text-[var(--color-app-muted)] transition-colors hover:border-emerald-400/50 hover:text-zinc-100">
                          <Upload className="h-4 w-4 shrink-0" />
                          <span className="truncate">
                            {mediaFile ? mediaFile.name : t('jobs.selectFile')}
                          </span>
                          <input
                            id="media"
                            type="file"
                            accept="audio/*,video/*,image/png,image/jpeg,image/webp,image/gif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/markdown,text/csv,text/html,application/json,application/xml,application/epub+zip,.mp3,.wav,.m4a,.aac,.ogg,.opus,.flac,.mp4,.mov,.m4v,.webm,.mkv,.avi,.png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.pptx,.xls,.xlsx,.csv,.txt,.md,.json,.xml,.html,.htm,.epub"
                            className="sr-only"
                            onChange={(e) => setMediaFile(e.target.files?.[0] ?? null)}
                          />
                        </label>
                        {mediaFile && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11"
                            onClick={() => setMediaFile(null)}
                            aria-label={t('jobs.removeFile')}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <Button
                        type="submit"
                        variant="primary"
                        size="lg"
                        disabled={uploading || !mediaFile}
                        className="h-11 w-full px-5 sm:w-auto"
                      >
                        {uploading ? <Spinner /> : <Upload className="h-4 w-4" />}
                        {t('jobs.send')}
                      </Button>
                    </div>
                    {mediaFile && (
                      <p className="text-xs text-[var(--color-app-muted)]">
                        {(mediaFile.size / 1024 / 1024).toFixed(1)} MiB · {t('jobs.sizeHint')}
                      </p>
                    )}
                  </form>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-xl font-semibold tracking-tight">
                {t('jobs.queueTitle')}
              </h2>
              {jobs.length > 0 && (
                <span className="text-xs text-[var(--color-app-muted)] tabular-nums">
                  {jobs.length}{' '}
                  {jobs.length === 1 ? t('dashboard.itemSingular') : t('dashboard.itemPlural')}
                </span>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={refresh}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t('jobs.refresh')}
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
                {t('jobs.queueEmpty')}
              </CardContent>
            </Card>
          )}

          {!loading && jobs.length > 0 && (
            <Card>
              <StaggerContainer delay={0.05}>
                <ul className="divide-y divide-[var(--color-app-border)]">
                  {jobs.map((j) => (
                    <StaggerItem key={j.id}>
                      <JobRow job={j} onUpdate={refresh} locale={locale} t={t} />
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

function JobRow({
  job,
  onUpdate,
  locale,
  t,
}: {
  job: JobSummary;
  onUpdate: () => void;
  locale: Locale;
  t: TranslateFn;
}): React.ReactElement {
  const isActive = job.status === 'QUEUED' || job.status === 'RUNNING';
  const [stage, setStage] = useState<string>(job.status === 'RUNNING' ? 'running' : 'queued');
  const [percent, setPercent] = useState<number>(0);

  const { closed } = useSse<ProgressEvent>(
    isActive ? `/api/jobs/${job.id}/events` : null,
    (evt) => {
      setStage(evt.stage);
      if (typeof evt.percent === 'number') setPercent(evt.percent);
      if (evt.stage === 'done' || evt.stage === 'failed' || evt.stage === 'cancelled') {
        setTimeout(onUpdate, 400);
      }
    },
  );

  useEffect(() => {
    setStage(job.status === 'RUNNING' ? 'running' : 'queued');
    setPercent(0);
  }, [job.id, job.status]);

  useEffect(() => {
    if (closed && isActive) onUpdate();
  }, [closed, isActive, onUpdate]);

  const { variant, label } = jobStatusBadge(job.status, t);

  return (
    <li className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-[var(--color-app-surface-hover)]/50">
      <Badge variant={variant} className="shrink-0 w-28 justify-center">
        {isActive ? stageLabel(stage, t) : label}
      </Badge>
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className="text-sm text-zinc-200 truncate font-mono tracking-tight">
          {displayJobSource(job.sourceUrl)}
        </p>
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
              ? t('jobs.finished', { time: formatRelative(new Date(job.finishedAt), locale) })
              : t('jobs.queued', { time: formatRelative(new Date(job.queuedAt), locale) })}
          </p>
        )}
        {job.errorMsg && !isActive && (
          <p className="text-xs text-rose-300 mt-1 line-clamp-2 break-words">{job.errorMsg}</p>
        )}
      </div>
      {job.transcriptId ? (
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/transcricoes/${job.transcriptId}`}>
            {t('common.open')}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </Button>
      ) : (
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/jobs/${job.id}`}>
            {t('jobs.details')}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </Button>
      )}
    </li>
  );
}

function DetectedBadge({
  source,
  t,
}: {
  source: DetectedSource;
  t: TranslateFn;
}): React.ReactElement {
  const map = {
    YOUTUBE: {
      label: t('jobs.detect.youtube'),
      cls: 'text-rose-300 border-rose-500/40 bg-rose-500/10',
    },
    INSTAGRAM: {
      label: t('jobs.detect.instagram'),
      cls: 'text-fuchsia-300 border-fuchsia-500/40 bg-fuchsia-500/10',
    },
    TIKTOK: {
      label: t('jobs.detect.tiktok'),
      cls: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
    },
    X: { label: t('jobs.detect.x'), cls: 'text-sky-300 border-sky-500/40 bg-sky-500/10' },
    WEB: { label: t('jobs.detect.web'), cls: 'text-zinc-300 border-zinc-500/40 bg-zinc-500/10' },
  } as const;
  const { label, cls } = map[source];
  const Icon = source === 'WEB' ? Globe : PlayCircle;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wider font-medium ${cls}`}
    >
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}
