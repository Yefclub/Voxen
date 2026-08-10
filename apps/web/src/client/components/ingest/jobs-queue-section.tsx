import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Globe, PlayCircle, RefreshCw, RotateCw } from '@/components/ui/icons';
import { motion } from 'motion/react';
import { toast } from '@/lib/toast';
import { ApiError, apiPost } from '../../lib/api';
import { canRetryJob, jobRetryRefusalMessage, resolveJobRetryFeedback } from '../../lib/job-retry';
import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';
import { Card, CardContent } from '../ui/card';
import { FetchError } from '../ui/fetch-error';
import { Badge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';
import { useFetch, useSse } from '../../lib/hooks';
import { formatDuration, formatRelative } from '../../lib/format';
import { jobSourceLabel, jobStatusBadge, stageLabel } from '../../lib/job-display';
import type { JobSummary } from '../../lib/types';
import {
  detectSourceFromUrl,
  displayJobSource,
  isUploadSourceUrl,
  youtubeVideoId,
  type DetectedSource,
} from '../../lib/source-detect';
import { StaggerContainer, StaggerItem } from '../motion/animated-page';
import { useI18n, type Locale, type TranslateFn } from '../../lib/i18n';
import { jobDestination } from './job-destination';
import {
  createDeferredJobRefresh,
  reconcileClosedJobStreams,
  reconcileJobSummaries,
} from '../../lib/job-list-reconciliation';

interface ProgressEvent {
  jobId: string;
  stage: string;
  percent?: number;
  chunkIndex?: number;
  transcriptId?: string;
  errorMsg?: string;
  ts: string;
}

export interface JobProgressState {
  jobId: string;
  stage: string;
  percent: number;
  progressedAt: number;
}

function progressTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function progressPercent(value: number | null | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : fallback;
}

export function jobProgressSnapshot(
  job: Pick<JobSummary, 'id' | 'status' | 'progressStage' | 'progressPercent' | 'progressedAt'>,
): JobProgressState {
  const percent =
    typeof job.progressPercent === 'number' && Number.isFinite(job.progressPercent)
      ? Math.min(100, Math.max(0, job.progressPercent))
      : 0;

  return {
    jobId: job.id,
    stage: job.progressStage?.trim() || job.status.toLowerCase(),
    percent,
    progressedAt: progressTimestamp(job.progressedAt),
  };
}

export function reconcileJobProgress(
  current: JobProgressState,
  incoming: JobProgressState,
): JobProgressState {
  if (current.jobId !== incoming.jobId) return incoming;
  if (incoming.progressedAt < current.progressedAt) return current;
  if (incoming.progressedAt === current.progressedAt && incoming.percent < current.percent) {
    return current;
  }
  if (
    incoming.stage === current.stage &&
    incoming.percent === current.percent &&
    incoming.progressedAt === current.progressedAt
  ) {
    return current;
  }
  return incoming;
}

export function JobsQueueSection({
  titleId = 'queue-title',
  showHeading = true,
}: {
  titleId?: string;
  /** When false, only the refresh control is shown (page supplies the title). */
  showHeading?: boolean;
} = {}): React.ReactElement {
  const [queuePage, setQueuePage] = useState(1);
  const queueLimit = 10;
  const queueUrl = `/api/jobs?page=${queuePage}&limit=${queueLimit}`;
  const {
    data,
    loading,
    error: queueError,
    refresh,
  } = useFetch<{
    jobs: JobSummary[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  }>(queueUrl);
  const { locale, t } = useI18n();
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const [closedJobStreams, setClosedJobStreams] = useState<ReadonlySet<string>>(() => new Set());
  const reportStreamState = useCallback((jobId: string, closed: boolean): void => {
    setClosedJobStreams((current) => reconcileClosedJobStreams(current, jobId, closed));
  }, []);

  const currentData = data?.page === queuePage ? data : null;
  const jobsCacheRef = useRef<{ page: number; jobs: JobSummary[] }>({ page: queuePage, jobs: [] });
  const jobs = useMemo(() => {
    if (!currentData)
      return jobsCacheRef.current.page === queuePage ? jobsCacheRef.current.jobs : [];
    const previous = jobsCacheRef.current.page === queuePage ? jobsCacheRef.current.jobs : [];
    const reconciled = reconcileJobSummaries(previous, currentData.jobs);
    jobsCacheRef.current = { page: queuePage, jobs: reconciled };
    return reconciled;
  }, [currentData, queuePage]);
  const queueTotal = currentData?.total ?? jobs.length;
  const totalPages = currentData?.totalPages ?? 1;

  useEffect(() => {
    if (closedJobStreams.size === 0) return;

    const reconcile = (): void => {
      if (document.visibilityState === 'hidden' || !navigator.onLine) return;
      refreshRef.current();
    };
    const interval = window.setInterval(reconcile, 10_000);
    window.addEventListener('online', reconcile);
    document.addEventListener('visibilitychange', reconcile);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('online', reconcile);
      document.removeEventListener('visibilitychange', reconcile);
    };
  }, [closedJobStreams.size]);

  return (
    <section className="space-y-3" aria-labelledby={showHeading ? titleId : undefined}>
      <div className="flex items-center justify-between">
        {showHeading ? (
          <div className="flex items-center gap-3">
            <h2 id={titleId} className="font-display text-xl font-semibold tracking-tight">
              {t('jobs.queueTitle')}
            </h2>
            {queueTotal > 0 && (
              <span className="text-xs text-[var(--color-app-muted)] tabular-nums">
                {queueTotal}{' '}
                {queueTotal === 1 ? t('dashboard.itemSingular') : t('dashboard.itemPlural')}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            {queueTotal > 0 && (
              <span className="text-xs text-[var(--color-app-muted)] tabular-nums">
                {queueTotal}{' '}
                {queueTotal === 1 ? t('dashboard.itemSingular') : t('dashboard.itemPlural')}
              </span>
            )}
          </div>
        )}
        <Button variant="ghost" size="sm" onClick={refresh} className="h-8 text-xs">
          <RefreshCw className="h-3.5 w-3.5" />
          {t('jobs.refresh')}
        </Button>
      </div>

      {loading && !currentData && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {!loading && queueError && !currentData && (
        <Card>
          <FetchError message={queueError} onRetry={refresh} />
        </Card>
      )}

      {!loading && !queueError && currentData && jobs.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--color-app-muted)]">
            {t('jobs.queueEmpty')}
          </CardContent>
        </Card>
      )}

      {currentData && jobs.length > 0 && (
        <>
          <StaggerContainer delay={0.05} className="space-y-1.5">
            {jobs.map((j) => (
              <StaggerItem key={j.id}>
                <JobRow
                  job={j}
                  onUpdate={refresh}
                  locale={locale}
                  t={t}
                  onStreamStateChange={reportStreamState}
                />
              </StaggerItem>
            ))}
          </StaggerContainer>
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
  );
}

const JobRow = memo(function JobRow({
  job,
  onUpdate,
  locale,
  t,
  onStreamStateChange,
}: {
  job: JobSummary;
  onUpdate: () => void;
  locale: Locale;
  t: TranslateFn;
  onStreamStateChange: (jobId: string, closed: boolean) => void;
}): React.ReactElement {
  const isActive = job.status === 'QUEUED' || job.status === 'RUNNING';
  const [progress, setProgress] = useState<JobProgressState>(() => jobProgressSnapshot(job));
  const [reprocessing, setReprocessing] = useState(false);
  const onUpdateRef = useRef(onUpdate);
  const terminalRefreshRef = useRef<ReturnType<typeof createDeferredJobRefresh> | null>(null);
  terminalRefreshRef.current ??= createDeferredJobRefresh();
  onUpdateRef.current = onUpdate;

  const { closed } = useSse<ProgressEvent>(
    isActive ? `/api/jobs/${job.id}/events` : null,
    (evt) => {
      setProgress((current) =>
        reconcileJobProgress(current, {
          jobId: job.id,
          stage: evt.stage.trim() || current.stage,
          percent: progressPercent(evt.percent, current.percent),
          progressedAt: progressTimestamp(evt.ts) || Date.now(),
        }),
      );
      if (
        evt.stage === 'done' ||
        evt.stage === 'completed_with_warnings' ||
        evt.stage === 'failed' ||
        evt.stage === 'cancelled'
      ) {
        terminalRefreshRef.current?.schedule(() => onUpdateRef.current());
      }
    },
  );

  useEffect(() => {
    const snapshot = jobProgressSnapshot(job);
    setProgress((current) => reconcileJobProgress(current, snapshot));
  }, [job.id, job.progressedAt, job.progressPercent, job.progressStage, job.status]);

  useEffect(() => {
    onStreamStateChange(job.id, isActive && closed);
  }, [closed, isActive, job.id, onStreamStateChange]);

  useEffect(() => {
    return () => {
      onStreamStateChange(job.id, false);
      terminalRefreshRef.current?.cancel();
    };
  }, [job.id, onStreamStateChange]);

  // Reprocessa um item que falhou/foi cancelado sem exigir que o usuário recole
  // o link. Reaproveita `POST /api/jobs/:id/retry` (dono derivado da sessão,
  // dedupe de job em andamento). Recusa só notifica — o item fica como estava.
  async function onReprocess(): Promise<void> {
    if (reprocessing) return;
    setReprocessing(true);
    try {
      const endpoint = job.status === 'COMPLETED_WITH_WARNINGS' ? 'enrichment-retry' : 'retry';
      const res = await apiPost<{ jobId?: string | null }>(`/api/jobs/${job.id}/${endpoint}`);
      const feedback = resolveJobRetryFeedback(
        { ok: true, jobId: res?.jobId ?? null },
        t('jobs.reprocessError'),
      );
      if (feedback.kind === 'queued') {
        toast.success(t('jobs.reprocessQueued'));
        onUpdateRef.current();
        return;
      }
      toast.error(feedback.message);
    } catch (err) {
      toast.error(
        jobRetryRefusalMessage(
          err instanceof ApiError ? err.message : null,
          t('jobs.reprocessError'),
        ),
      );
    } finally {
      setReprocessing(false);
    }
  }

  const { variant, label } = jobStatusBadge(job.status, t);
  const canReprocess = canRetryJob(job.status);
  const source = detectSourceFromUrl(job.sourceUrl);
  const isUpload = isUploadSourceUrl(job.sourceUrl);
  const ytId = source === 'YOUTUBE' ? youtubeVideoId(job.sourceUrl) : null;
  // Nunca usa CDN assinada (TikTok etc.) no browser — só preview interno ou YT mqdefault.
  // Host checado via URL.hostname (não includes) — evita open-redirect de substring.
  const remoteIsSafeYt = isYtimgThumbnailUrl(job.thumbnailUrl);
  const previewSrc: string | null = job.transcriptId
    ? `/api/transcripts/${job.transcriptId}/preview`
    : remoteIsSafeYt && job.thumbnailUrl
      ? job.thumbnailUrl
      : ytId
        ? `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`
        : null;
  const displayTitle = job.title?.trim() || displayJobSource(job.sourceUrl);

  return (
    // O link cobre a linha inteira como overlay (`absolute inset-0`) em vez de
    // envolver o conteúdo: assim a ação de reprocessar é um <button> de verdade,
    // e não um botão aninhado dentro de um <a> (HTML inválido + a11y quebrada).
    <div className="group relative flex flex-col gap-3 rounded-lg border border-transparent px-2 py-2 transition-colors hover:border-[var(--color-app-border)] hover:bg-[var(--color-app-surface-hover)] sm:flex-row sm:items-center sm:gap-4">
      <Link
        to={jobDestination(job)}
        aria-label={`${job.transcriptId ? t('common.open') : t('jobs.details')}: ${displayTitle}`}
        className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500/40"
      />
      <JobPreview
        previewSrc={previewSrc}
        source={source}
        isUpload={isUpload}
        durationSec={job.durationSec ?? null}
      />
      <Badge
        variant={variant}
        className="hidden shrink-0 min-w-28 justify-center text-center sm:inline-flex"
      >
        {isActive ? stageLabel(progress.stage, t, job.type) : label}
      </Badge>
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className="text-sm text-[var(--color-app-fg)] truncate font-medium tracking-tight font-display">
          {displayTitle}
        </p>
        <p className="text-xs text-[var(--color-app-muted)] truncate font-mono">
          {jobSourceLabel(job, t)}
        </p>
        {isActive ? (
          <div className="flex items-center gap-2.5">
            <div className="h-1 flex-1 max-w-[280px] rounded-full bg-[var(--color-app-bg-elevated)] overflow-hidden">
              <motion.div
                animate={{ width: `${Math.max(3, progress.percent)}%` }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="h-full rounded-full bg-emerald-500"
              />
            </div>
            <span className="text-[10px] font-mono tabular-nums text-[var(--color-app-muted)]">
              {progress.percent}%
            </span>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant={variant} className="shrink-0 sm:hidden">
              {isActive ? stageLabel(progress.stage, t, job.type) : label}
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
      <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
        {canReprocess && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            // z-10: fica acima do overlay do link, senão o clique vira navegação.
            className="relative z-10 h-8 shrink-0 text-xs"
            disabled={reprocessing}
            onClick={() => void onReprocess()}
          >
            {reprocessing ? <Spinner size={14} /> : <RotateCw className="h-3.5 w-3.5" />}
            {reprocessing ? t('jobs.reprocessing') : t('jobs.reprocess')}
          </Button>
        )}
        <span className="inline-flex items-center gap-1 text-xs text-[var(--color-app-muted)] transition-colors group-hover:text-[var(--color-app-fg)]">
          {job.transcriptId ? t('common.open') : t('jobs.details')}
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </div>
  );
});

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
          <span className="absolute bottom-1 right-1 rounded bg-black/65 px-1 py-0.5 text-[9px] tabular-nums text-[var(--color-app-fg)]">
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
    WEB: 'from-zinc-500/10 to-zinc-500/5 text-[var(--color-app-muted)] border-zinc-500/20',
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

/** True só se o host da URL for ytimg.com (ou subdomínio). */
function isYtimgThumbnailUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'ytimg.com' || host.endsWith('.ytimg.com');
  } catch {
    return false;
  }
}
