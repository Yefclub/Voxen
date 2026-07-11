import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Globe,
  Link2,
  PlayCircle,
  Plus,
  RefreshCw,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
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
import { uploadMedia } from '../lib/upload';
import { useFetch, useMe, useSse } from '../lib/hooks';
import { formatDuration, formatRelative } from '../lib/format';
import { jobStatusBadge, stageLabel } from '../lib/job-display';
import type { JobStatus, JobSummary } from '../lib/types';
import {
  detectSourceFromUrl,
  displayJobSource,
  isUploadSourceUrl,
  youtubeVideoId,
  type DetectedSource,
} from '../lib/source-detect';
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

const MEDIA_ACCEPT =
  'audio/*,video/*,image/png,image/jpeg,image/webp,image/gif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/markdown,text/csv,text/html,application/json,application/xml,application/epub+zip,.mp3,.wav,.m4a,.aac,.ogg,.opus,.flac,.mp4,.mov,.m4v,.webm,.mkv,.avi,.png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.pptx,.xls,.xlsx,.csv,.txt,.md,.json,.xml,.html,.htm,.epub';

function hasFileDrag(types: readonly string[] | DOMStringList | undefined): boolean {
  if (!types) return false;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === 'Files') return true;
  }
  return false;
}

export function HomePage(): React.ReactElement {
  const [mode, setMode] = useState<'link' | 'upload'>('link');
  const [url, setUrl] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const uploadInFlightRef = useRef(false);
  const [queuePage, setQueuePage] = useState(1);
  const queueLimit = 10;
  const queueUrl = `/api/jobs?page=${queuePage}&limit=${queueLimit}`;
  const { data, loading, refresh } = useFetch<{
    jobs: JobSummary[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  }>(queueUrl);
  const { data: me } = useMe();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const sharedUrlLockRef = useRef<string | null>(null);
  const { locale, t } = useI18n();
  const firstName = me?.user?.name?.split(' ')[0] ?? t('dashboard.fallbackName');

  const detected: DetectedSource | null = useMemo(
    () => (url.trim() ? detectSourceFromUrl(url.trim()) : null),
    [url],
  );

  const handleAutoJobError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.status === 409 && err.body && typeof err.body === 'object') {
          const transcriptId = (err.body as { transcriptId?: string }).transcriptId;
          const jobId = (err.body as { jobId?: string }).jobId;
          if (transcriptId) {
            toast(t('jobs.toast.alreadyIndexed'), {
              action: {
                label: t('common.open'),
                onClick: () => navigate(`/transcricoes/${transcriptId}`),
              },
            });
            navigate(`/transcricoes/${transcriptId}`);
          } else if (jobId) {
            toast(t('jobs.toast.alreadyQueued'), {
              action: {
                label: t('common.open'),
                onClick: () => navigate(`/jobs/${jobId}`),
              },
            });
            navigate(`/jobs/${jobId}`);
          }
        }
      } else {
        setError(t('jobs.error.unexpected'));
      }
    },
    [navigate, t],
  );

  const submitUrl = useCallback(
    async (
      value: string,
      options: { clearInput?: boolean; replace?: boolean } = {},
    ): Promise<{
      jobId: string;
      status: JobStatus;
      sourceUrl: string;
      kind: 'video' | 'web' | 'x';
    }> => {
      const res = await apiPost<{
        jobId: string;
        status: JobStatus;
        sourceUrl: string;
        kind: 'video' | 'web' | 'x';
      }>('/api/jobs/auto', { url: value });
      if (options.clearInput !== false) setUrl('');
      refresh();
      const successMsg =
        res.kind === 'web'
          ? t('jobs.toast.webQueued')
          : res.kind === 'x'
            ? t('jobs.toast.xQueued')
            : t('jobs.toast.videoQueued');
      toast.success(successMsg, {
        description: t('jobs.toast.progress'),
        action: {
          label: t('common.open'),
          onClick: () => navigate(`/jobs/${res.jobId}`),
        },
      });
      navigate(`/jobs/${res.jobId}`, { replace: options.replace === true });
      return res;
    },
    [navigate, refresh, t],
  );

  const startUpload = useCallback(
    async (file: File): Promise<void> => {
      if (uploadInFlightRef.current) return;
      uploadInFlightRef.current = true;
      setError(null);
      setMode('upload');
      setMediaFile(file);
      setUploading(true);
      setUploadProgress(0);
      try {
        const result = await uploadMedia(file, {
          onProgress: (percent) => setUploadProgress(percent),
        });
        const jobId = result.jobId;
        setMediaFile(null);
        refresh();
        toast.success(
          result.kind === 'image'
            ? t('jobs.toast.imageQueued')
            : result.kind === 'document'
              ? t('jobs.toast.documentQueued')
              : t('jobs.toast.fileQueued'),
          {
            description:
              result.kind === 'image'
                ? t('jobs.toast.imageDescription')
                : result.kind === 'document'
                  ? t('jobs.toast.documentDescription')
                  : t('jobs.toast.mediaDescription'),
            action: {
              label: t('common.open'),
              onClick: () => navigate(`/jobs/${jobId}`),
            },
          },
        );
        navigate(`/jobs/${jobId}`);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.status === 413 ? t('jobs.error.uploadTooLarge') : err.message);
        } else {
          setError(t('jobs.error.unexpected'));
        }
      } finally {
        uploadInFlightRef.current = false;
        setUploading(false);
        setUploadProgress(0);
      }
    },
    [navigate, refresh, t],
  );

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await submitUrl(url, { clearInput: true });
    } catch (err) {
      handleAutoJobError(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function onUploadSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!mediaFile) return;
    await startUpload(mediaFile);
  }

  function onContentPaste(e: React.ClipboardEvent<HTMLInputElement>): void {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      e.preventDefault();
      const file = files[0];
      if (file) void startUpload(file);
    }
  }

  useEffect(() => {
    function onDragEnter(e: DragEvent): void {
      if (!hasFileDrag(e.dataTransfer?.types)) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setDragOver(true);
    }
    function onDragLeave(e: DragEvent): void {
      if (!hasFileDrag(e.dataTransfer?.types) && dragDepthRef.current === 0) return;
      e.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragOver(false);
    }
    function onDragOver(e: DragEvent): void {
      if (!hasFileDrag(e.dataTransfer?.types)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    }
    function onDrop(e: DragEvent): void {
      if (!hasFileDrag(e.dataTransfer?.types)) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) void startUpload(file);
    }

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [startUpload]);

  const jobs = data?.jobs ?? [];
  const queueTotal = data?.total ?? jobs.length;
  const totalPages = data?.totalPages ?? 1;
  const hasActiveJobs = jobs.some((job) => job.status === 'QUEUED' || job.status === 'RUNNING');
  const queued = jobs.filter((j) => j.status === 'QUEUED' || j.status === 'RUNNING').length;
  const done = jobs.filter((j) => j.status === 'DONE').length;
  const failed = jobs.filter((j) => j.status === 'FAILED').length;

  useEffect(() => {
    if (searchParams.get('shared') !== '1') return;

    const jobId = searchParams.get('jobId');
    if (jobId) {
      const count = Number(searchParams.get('queued') ?? '1') || 1;
      toast.success(count > 1 ? t('jobs.shareQueuedMany', { count }) : t('jobs.shareQueued'), {
        description: t('jobs.toast.progress'),
      });
      refresh();
      navigate(`/jobs/${jobId}`, { replace: true });
      return;
    }

    const shareError = searchParams.get('share_error');
    if (shareError) {
      const message = shareErrorMessage(shareError, t);
      setError(message);
      toast.error(message);
      setSearchParams({}, { replace: true });
      return;
    }

    const sharedUrl = searchParams.get('url')?.trim();
    if (!sharedUrl) return;
    setMode('link');
    setUrl(sharedUrl);

    const lockKey = `voxen:share-target:${sharedUrl}`;
    if (sharedUrlLockRef.current === lockKey) return;
    sharedUrlLockRef.current = lockKey;
    try {
      if (window.sessionStorage.getItem(lockKey) === 'pending') return;
      window.sessionStorage.setItem(lockKey, 'pending');
    } catch {
      // sessionStorage é só trava contra double-effect; falha não bloqueia ingestão.
    }

    setSubmitting(true);
    submitUrl(sharedUrl, { clearInput: false, replace: true })
      .catch((err: unknown) => {
        setSearchParams({}, { replace: true });
        handleAutoJobError(err);
      })
      .finally(() => {
        try {
          window.sessionStorage.removeItem(lockKey);
        } catch {
          // no-op
        }
        setSubmitting(false);
        sharedUrlLockRef.current = null;
      });
  }, [handleAutoJobError, navigate, refresh, searchParams, setSearchParams, submitUrl, t]);

  useEffect(() => {
    if (!hasActiveJobs) return;
    const id = window.setInterval(() => {
      refresh();
    }, 6_000);
    return () => window.clearInterval(id);
  }, [hasActiveJobs, refresh]);

  return (
    <AnimatedPage>
      <div className="relative mx-auto max-w-6xl space-y-6 px-4 py-5 sm:space-y-10 sm:px-6 sm:py-8 lg:px-8 lg:py-12">
        <header className="space-y-3 sm:space-y-4">
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
            className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium"
          >
            <Sparkles className="h-3 w-3 text-emerald-400" />
            {t('home.eyebrow')}
          </motion.div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-1.5">
              <h1 className="font-display text-3xl font-semibold tracking-[-0.03em] text-balance sm:text-4xl">
                {t('home.greeting', { name: firstName })}
              </h1>
              <p className="hidden max-w-2xl text-[15px] leading-relaxed text-[var(--color-app-muted)] sm:block">
                {t('home.description')}
              </p>
            </div>
            {!loading && jobs.length > 0 && (
              <div className="flex flex-wrap gap-2 text-xs tabular-nums text-[var(--color-app-muted)]">
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-200">
                  {queued} {t('dashboard.processing').toLowerCase()}
                </span>
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-200">
                  {done} {t('home.statReady')}
                </span>
                {failed > 0 && (
                  <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-rose-200">
                    {failed} {t('dashboard.failed').toLowerCase()}
                  </span>
                )}
              </div>
            )}
          </div>
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
                      <Label htmlFor="url">{t('jobs.mode.link')}</Label>
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
                          onPaste={onContentPaste}
                          placeholder={t('home.urlPlaceholder')}
                          autoComplete="off"
                          required
                          className="pl-10 font-mono h-12 text-[15px]"
                        />
                      </div>
                      <Button
                        type="submit"
                        variant="primary"
                        size="lg"
                        disabled={submitting || url.trim().length === 0}
                        className="h-12 w-full px-5 sm:w-auto"
                      >
                        {submitting ? <Spinner /> : <Plus className="h-4 w-4" />}
                        {t('jobs.add')}
                      </Button>
                    </div>
                    <p className="hidden text-xs text-[var(--color-app-muted)] sm:block">
                      {t('jobs.linkHint')}
                    </p>
                  </form>
                ) : (
                  <form onSubmit={onUploadSubmit} className="space-y-3">
                    <Label htmlFor="media">{t('jobs.uploadLabel')}</Label>
                    <div className="space-y-2.5 sm:flex sm:gap-2.5 sm:space-y-0">
                      <div className="flex gap-2.5 sm:flex-1">
                        <label className="relative flex h-12 flex-1 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[var(--color-app-border-strong)] bg-[var(--color-app-bg-elevated)] px-3 text-sm text-[var(--color-app-muted)] transition-colors hover:border-emerald-400/50 hover:text-zinc-100">
                          <Upload className="h-4 w-4 shrink-0" />
                          <span className="truncate">
                            {mediaFile ? mediaFile.name : t('jobs.selectFile')}
                          </span>
                          <input
                            id="media"
                            type="file"
                            accept={MEDIA_ACCEPT}
                            className="sr-only"
                            onChange={(e) => setMediaFile(e.target.files?.[0] ?? null)}
                          />
                        </label>
                        {mediaFile && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-12 w-11"
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
                        className="h-12 w-full px-5 sm:w-auto"
                      >
                        {uploading ? <Spinner /> : <Upload className="h-4 w-4" />}
                        {t('jobs.send')}
                      </Button>
                    </div>
                    {uploading ? (
                      <div className="space-y-1.5">
                        <div
                          className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-app-bg-elevated)]"
                          role="progressbar"
                          aria-valuenow={uploadProgress}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-[width] duration-200"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                        <p className="text-xs tabular-nums text-[var(--color-app-muted)]">
                          {t('jobs.uploading', { percent: uploadProgress })}
                        </p>
                      </div>
                    ) : (
                      mediaFile && (
                        <p className="text-xs text-[var(--color-app-muted)]">
                          {(mediaFile.size / 1024 / 1024).toFixed(1)} MiB · {t('jobs.sizeHint')}
                        </p>
                      )
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
              {queueTotal > 0 && (
                <span className="text-xs text-[var(--color-app-muted)] tabular-nums">
                  {queueTotal}{' '}
                  {queueTotal === 1 ? t('dashboard.itemSingular') : t('dashboard.itemPlural')}
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
            <>
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
              {totalPages > 1 && (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-[var(--color-app-muted)] tabular-nums">
                    {t('jobs.pageOf', { page: queuePage, total: totalPages })}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={queuePage <= 1}
                      onClick={() => setQueuePage((p) => Math.max(1, p - 1))}
                    >
                      {t('jobs.prevPage')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={queuePage >= totalPages}
                      onClick={() => setQueuePage((p) => Math.min(totalPages, p + 1))}
                    >
                      {t('jobs.nextPage')}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <AnimatePresence>
        {dragOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm"
            aria-live="polite"
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="mx-6 flex max-w-md flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-emerald-400/50 bg-[var(--color-app-bg-elevated)]/95 px-10 py-12 text-center shadow-2xl"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10">
                <Upload className="h-6 w-6 text-emerald-400" />
              </div>
              <p className="font-display text-lg font-semibold tracking-tight text-zinc-100">
                {t('home.dropTitle')}
              </p>
              <p className="text-sm text-[var(--color-app-muted)]">{t('home.dropHint')}</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
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
  const source = detectSourceFromUrl(job.sourceUrl);
  const isUpload = isUploadSourceUrl(job.sourceUrl);
  const ytId = source === 'YOUTUBE' ? youtubeVideoId(job.sourceUrl) : null;
  const previewSrc =
    job.thumbnailUrl ||
    (ytId ? `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg` : null) ||
    (job.transcriptId ? `/api/transcripts/${job.transcriptId}/preview` : null);
  const displayTitle = job.title?.trim() || displayJobSource(job.sourceUrl);

  return (
    <li className="group flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-[var(--color-app-surface-hover)]/50 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
      <JobPreview
        previewSrc={previewSrc}
        source={source}
        isUpload={isUpload}
        durationSec={job.durationSec ?? null}
      />
      <Badge variant={variant} className="hidden shrink-0 min-w-28 justify-center text-center sm:inline-flex">
        {isActive ? stageLabel(stage, t) : label}
      </Badge>
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className="text-sm text-zinc-100 truncate font-medium tracking-tight font-display">
          {displayTitle}
        </p>
        <p className="text-xs text-[var(--color-app-muted)] truncate font-mono">
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
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant={variant} className="shrink-0 sm:hidden">
              {isActive ? stageLabel(stage, t) : label}
            </Badge>
            <p className="text-xs text-[var(--color-app-muted)] truncate">
              {job.finishedAt
                ? t('jobs.finished', { time: formatRelative(new Date(job.finishedAt), locale) })
                : t('jobs.queued', { time: formatRelative(new Date(job.queuedAt), locale) })}
            </p>
          </div>
        )}
        {job.errorMsg && !isActive && (
          <p className="text-xs text-rose-300 mt-1 line-clamp-2 break-words">{job.errorMsg}</p>
        )}
      </div>
      {job.transcriptId ? (
        <Button variant="ghost" size="sm" asChild className="w-full sm:w-auto">
          <Link to={`/transcricoes/${job.transcriptId}`}>
            {t('common.open')}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </Button>
      ) : (
        <Button variant="ghost" size="sm" asChild className="w-full sm:w-auto">
          <Link to={`/jobs/${job.id}`}>
            {t('jobs.details')}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </Button>
      )}
    </li>
  );
}

function JobPreview({
  previewSrc,
  source,
  isUpload,
  durationSec,
}: {
  previewSrc: string | null;
  source: DetectedSource | null;
  isUpload: boolean;
  durationSec: number | null;
}): React.ReactElement {
  if (previewSrc) {
    return (
      <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] sm:h-16 sm:w-28">
        <img
          src={previewSrc}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
        {typeof durationSec === 'number' && durationSec > 0 && (
          <span className="absolute bottom-1 right-1 rounded bg-black/65 px-1 py-0.5 text-[9px] tabular-nums text-zinc-100">
            {formatDuration(durationSec)}
          </span>
        )}
      </div>
    );
  }
  const map = {
    YOUTUBE: 'from-rose-500/15 to-rose-500/5 text-rose-300/80 border-rose-500/20',
    INSTAGRAM: 'from-fuchsia-500/15 to-pink-500/5 text-fuchsia-300/80 border-fuchsia-500/20',
    TIKTOK: 'from-emerald-500/15 to-cyan-500/5 text-emerald-300/80 border-emerald-500/20',
    X: 'from-sky-500/15 to-blue-500/5 text-sky-300/80 border-sky-500/20',
    WEB: 'from-zinc-500/10 to-zinc-500/5 text-zinc-400 border-zinc-500/20',
  } as const;
  const cls = isUpload
    ? 'from-emerald-500/15 to-violet-500/5 text-emerald-300/80 border-emerald-500/20'
    : source
      ? map[source]
      : map.WEB;
  const Icon = source === 'WEB' ? Globe : PlayCircle;
  return (
    <div
      className={`flex h-14 w-20 shrink-0 items-center justify-center rounded-lg border bg-gradient-to-br sm:h-16 sm:w-28 ${cls}`}
    >
      <Icon className="h-5 w-5" />
    </div>
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

function shareErrorMessage(errorCode: string, t: TranslateFn): string {
  const key = `jobs.shareError.${errorCode}` as Parameters<TranslateFn>[0];
  const translated = t(key);
  if (translated !== key) return translated;
  return t('jobs.shareError.generic');
}
