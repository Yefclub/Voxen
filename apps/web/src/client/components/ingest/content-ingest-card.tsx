import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Globe, Link2, PlayCircle, Plus, Upload, X } from '@/components/ui/icons';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from '@/lib/toast';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Alert, AlertDescription } from '../ui/alert';
import { Spinner } from '../ui/spinner';
import { ApiError, apiPost } from '../../lib/api';
import { uploadMedia } from '../../lib/upload';
import type { JobStatus } from '../../lib/types';
import { detectSourceFromUrl, type DetectedSource } from '../../lib/source-detect';
import { useI18n, type TranslateFn } from '../../lib/i18n';
import { MEDIA_ACCEPT, hasFileDrag, shareErrorMessage } from './ingest-helpers';

export function ContentIngestCard(): React.ReactElement {
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
  const sharedUrlLockRef = useRef<string | null>(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useI18n();

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
    [navigate, t],
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
    [navigate, t],
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

  // PWA share-target lands with ?shared=1 (often via / → /transcricoes redirect).
  useEffect(() => {
    if (searchParams.get('shared') !== '1') return;

    const jobId = searchParams.get('jobId');
    if (jobId) {
      const count = Number(searchParams.get('queued') ?? '1') || 1;
      toast.success(count > 1 ? t('jobs.shareQueuedMany', { count }) : t('jobs.shareQueued'), {
        description: t('jobs.toast.progress'),
      });
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
      // sessionStorage is only a double-effect guard; failure must not block ingest.
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
  }, [handleAutoJobError, navigate, searchParams, setSearchParams, submitUrl, t]);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <Card elevated>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="inline-flex rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] p-1">
                <button
                  type="button"
                  onClick={() => setMode('link')}
                  className={[
                    'inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40',
                    mode === 'link'
                      ? 'bg-[var(--color-app-surface)] text-[var(--color-app-fg)] shadow-sm'
                      : 'text-[var(--color-app-muted)] hover:text-[var(--color-app-fg)]',
                  ].join(' ')}
                >
                  <Link2 className="h-3.5 w-3.5" />
                  {t('jobs.mode.link')}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('upload')}
                  className={[
                    'inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40',
                    mode === 'upload'
                      ? 'bg-[var(--color-app-surface)] text-[var(--color-app-fg)] shadow-sm'
                      : 'text-[var(--color-app-muted)] hover:text-[var(--color-app-fg)]',
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
                    {/* Ação principal da tela: campo com destaque (superfície
                        elevada, borda forte e foco no acento) e placeholder curto. */}
                    <div className="relative flex-1">
                      <Link2 className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-accent-primary)] pointer-events-none" />
                      <Input
                        id="url"
                        type="url"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        onPaste={onContentPaste}
                        placeholder={t('home.urlPlaceholder')}
                        autoComplete="off"
                        required
                        className="h-12 border-[var(--color-app-border-strong)] bg-[var(--color-app-bg-elevated)] pl-10 font-mono text-[15px] placeholder:font-sans placeholder:text-[var(--color-app-subtle)] hover:border-[var(--color-accent-primary)]/50 focus:border-[var(--color-accent-primary)] focus:bg-[var(--color-app-bg-elevated)] focus:ring-4 focus:ring-[var(--color-accent-primary-soft)]"
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
                      <label className="relative flex h-12 flex-1 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[var(--color-app-border-strong)] bg-[var(--color-app-bg-elevated)] px-3 text-sm text-[var(--color-app-muted)] transition-colors hover:border-emerald-400/50 hover:text-[var(--color-app-fg)]">
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
              <p className="font-display text-lg font-semibold tracking-tight text-[var(--color-app-fg)]">
                {t('home.dropTitle')}
              </p>
              <p className="text-sm text-[var(--color-app-muted)]">{t('home.dropHint')}</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
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
    WEB: {
      label: t('jobs.detect.web'),
      cls: 'text-[var(--color-app-subtle)] border-zinc-500/40 bg-zinc-500/10',
    },
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
