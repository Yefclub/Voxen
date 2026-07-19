import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Globe, PlayCircle, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { FetchError } from '../ui/fetch-error';
import { Badge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';
import { useFetch, useSse } from '../../lib/hooks';
import { formatDuration, formatRelative } from '../../lib/format';
import { jobStatusBadge, stageLabel } from '../../lib/job-display';
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

interface ProgressEvent {
  jobId: string;
  stage: string;
  percent?: number;
  chunkIndex?: number;
  transcriptId?: string;
  errorMsg?: string;
  ts: string;
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

  const jobs = data?.jobs ?? [];
  const queueTotal = data?.total ?? jobs.length;
  const totalPages = data?.totalPages ?? 1;
  const hasActiveJobs = jobs.some((job) => job.status === 'QUEUED' || job.status === 'RUNNING');

  useEffect(() => {
    if (!hasActiveJobs) return;
    const id = window.setInterval(() => {
      refresh();
    }, 6_000);
    return () => window.clearInterval(id);
  }, [hasActiveJobs, refresh]);

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

      {loading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {!loading && queueError && (
        <Card>
          <FetchError message={queueError} onRetry={refresh} />
        </Card>
      )}

      {!loading && !queueError && jobs.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--color-app-muted)]">
            {t('jobs.queueEmpty')}
          </CardContent>
        </Card>
      )}

      {!loading && jobs.length > 0 && (
        <>
          <StaggerContainer delay={0.05} className="space-y-1.5">
            {jobs.map((j) => (
              <StaggerItem key={j.id}>
                <JobRow job={j} onUpdate={refresh} locale={locale} t={t} />
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
  // Nunca usa CDN assinada (TikTok etc.) no browser — só preview interno ou YT mqdefault.
  const remoteIsSafeYt =
    !!job.thumbnailUrl &&
    (job.thumbnailUrl.includes('i.ytimg.com') || job.thumbnailUrl.includes('ytimg.com'));
  const previewSrc = job.transcriptId
    ? `/api/transcripts/${job.transcriptId}/preview`
    : remoteIsSafeYt
      ? job.thumbnailUrl
      : ytId
        ? `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`
        : null;
  const displayTitle = job.title?.trim() || displayJobSource(job.sourceUrl);

  return (
    <Link
      to={jobDestination(job)}
      aria-label={`${job.transcriptId ? t('common.open') : t('jobs.details')}: ${displayTitle}`}
      className="group flex flex-col gap-3 rounded-lg border border-transparent px-2 py-2 transition-colors hover:border-[var(--color-app-border)] hover:bg-[var(--color-app-surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500/40 sm:flex-row sm:items-center sm:gap-4"
    >
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
        {isActive ? stageLabel(stage, t) : label}
      </Badge>
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className="text-sm text-[var(--color-app-fg)] truncate font-medium tracking-tight font-display">
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
      <span className="inline-flex w-full shrink-0 items-center justify-end gap-1 text-xs text-[var(--color-app-muted)] transition-colors group-hover:text-[var(--color-app-fg)] sm:w-auto">
        {job.transcriptId ? t('common.open') : t('jobs.details')}
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
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
