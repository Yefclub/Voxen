import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ExternalLink,
  Link2,
  Paperclip,
  RotateCw,
  Settings,
  Upload,
  X,
} from '@/components/ui/icons';
import { toast } from '@/lib/toast';
import { Badge, type BadgeProps } from '../ui/badge';
import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';
import { cn } from '../../lib/utils';
import { formatRelative, formatUsd } from '../../lib/format';
import { useI18n, type I18nKey } from '../../lib/i18n';
import { captureStageKey } from '../../lib/job-stage-i18n';
import { captureCommand, type CaptureJob, type CaptureStatus } from '../../lib/capture-api';
import { canRetry, captureLabel, isActiveCapture, platformLabel } from '../../lib/capture-state';
import { useCaptureLive } from '../../lib/use-capture-live';
import { captureErrorText } from './capture-notice';

const STATUS: Record<CaptureStatus, { key: I18nKey; variant: BadgeProps['variant'] }> = {
  QUEUED: { key: 'job.status.queued', variant: 'muted' },
  RUNNING: { key: 'job.status.running', variant: 'default' },
  DONE: { key: 'job.status.done', variant: 'success' },
  COMPLETED_WITH_WARNINGS: { key: 'job.status.completedWithWarnings', variant: 'warning' },
  FAILED: { key: 'job.status.failed', variant: 'danger' },
  CANCELLED: { key: 'job.status.cancelled', variant: 'muted' },
};

const METHOD: Record<string, I18nKey> = {
  API: 'library.method.aiTranscript',
  SUBTITLES: 'library.method.officialSubtitles',
  DOCUMENT: 'library.method.document',
  VISION: 'library.method.visualAnalysis',
  SCRAPE: 'capture.method.scrape',
};

const WARNING: Record<string, I18nKey> = {
  speech_not_transcribed: 'capture.warning.speech_not_transcribed',
  frames_unavailable: 'capture.warning.frames_unavailable',
  images_not_described: 'capture.warning.images_not_described',
};

interface CaptureJobCardProps {
  job: CaptureJob;
  /** Open an SSE stream while the job is active. */
  live: boolean;
  focused?: boolean;
  onChange: (job: CaptureJob) => void;
  /** Opens the composer's file picker (upload path after a blocked link). */
  onUpload?: () => void;
}

export function CaptureJobCard({
  job,
  live,
  focused = false,
  onChange,
  onUpload,
}: CaptureJobCardProps): React.ReactElement {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [pending, setPending] = useState<'cancel' | 'retry' | null>(null);
  const root = useRef<HTMLElement>(null);
  useCaptureLive(job, live, onChange);

  useEffect(() => {
    if (!focused || !root.current) return;
    root.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    root.current.focus({ preventScroll: true });
  }, [focused]);

  async function run(command: 'cancel' | 'retry'): Promise<void> {
    setPending(command);
    try {
      const { job: updated, result } = await captureCommand(job.id, command);
      if (updated) {
        onChange(updated);
        if (command === 'cancel') toast(t('capture.cancelled'));
        return;
      }
      const error = result?.kind === 'error' ? result : null;
      const code = error?.error?.code ?? 'UNKNOWN';
      const message = captureErrorText(t, code, error?.error?.message ?? error?.message);
      if (code === 'AI_NOT_CONFIGURED') {
        const target = error?.error?.settingsUrl ?? '/conta/ia';
        toast.error(message, {
          action: { label: t('capture.configure'), onClick: () => navigate(target) },
        });
      } else {
        toast.error(message);
      }
    } finally {
      setPending(null);
    }
  }

  const active = isActiveCapture(job);
  const status = STATUS[job.status];
  const label = captureLabel(job);
  const titleId = `capture-${job.id}-title`;
  const percent = Math.max(0, Math.min(100, Math.round(job.percent ?? 0)));
  const finished = job.status === 'DONE' || job.status === 'COMPLETED_WITH_WARNINGS';
  const KindIcon = job.reprocessOf ? RotateCw : job.kind === 'upload' ? Paperclip : Link2;
  const subtitle = [
    job.reprocessOf
      ? t('capture.kind.reprocess')
      : job.kind === 'upload'
        ? t('capture.kind.upload')
        : platformLabel(job.platform),
    formatRelative(new Date(job.queuedAt), locale),
    job.attempt > 1 ? t('capture.attempt', { attempt: job.attempt }) : null,
    job.retryAt && active
      ? t('capture.retryAt', { when: formatRelative(new Date(job.retryAt), locale) })
      : null,
  ].filter(Boolean);
  const methodKey = job.transcript?.method ? METHOD[job.transcript.method] : undefined;
  const doneMeta = [
    methodKey ? t(methodKey) : null,
    job.transcript?.model ?? null,
    job.costUsd !== null ? t('capture.cost', { cost: formatUsd(job.costUsd, locale) }) : null,
  ].filter(Boolean);
  const errorAction = job.error?.action;
  const warningKeys = (job.warnings ?? [])
    .map((code) => WARNING[code])
    .filter((key): key is I18nKey => key !== undefined);

  return (
    <article
      ref={root}
      tabIndex={-1}
      aria-labelledby={titleId}
      className={cn(
        'rounded-xl border bg-[var(--color-app-surface)] p-3 transition-colors focus:outline-none sm:p-4',
        focused
          ? 'border-violet-500/60 ring-2 ring-violet-500/25'
          : 'border-[var(--color-app-border)]',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] text-[var(--color-app-muted)]">
          <KindIcon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p
            id={titleId}
            className="truncate text-sm font-medium text-[var(--color-app-fg)]"
            title={job.sourceUrl ?? label}
          >
            {label}
          </p>
          <p className="truncate text-xs text-[var(--color-app-muted)]">{subtitle.join(' · ')}</p>
        </div>
        <Badge variant={status.variant} className="shrink-0">
          {t(status.key)}
        </Badge>
      </div>

      {active && (
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span
              className="flex min-w-0 items-center gap-1.5 text-[var(--color-app-subtle)]"
              aria-live="polite"
            >
              <Spinner size={12} className="shrink-0 text-[var(--color-app-muted)]" />
              <span className="truncate">
                {t(captureStageKey(job.stage ?? job.status.toLowerCase()))}
              </span>
            </span>
            <span className="tabular-nums text-[var(--color-app-muted)]">{percent}%</span>
          </div>
          <div
            role="progressbar"
            aria-label={t('capture.progress')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-1.5 overflow-hidden rounded-full bg-[var(--color-app-bg-elevated)]"
          >
            <div
              className="h-full rounded-full bg-[var(--color-accent-primary)] transition-[width] duration-500 ease-out motion-reduce:transition-none"
              style={{ width: `${Math.max(percent, 3)}%` }}
            />
          </div>
        </div>
      )}

      {finished && doneMeta.length > 0 && (
        <p className="mt-2 truncate text-xs text-[var(--color-app-muted)]">
          {doneMeta.join(' · ')}
        </p>
      )}

      {job.status === 'COMPLETED_WITH_WARNINGS' && warningKeys.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-[var(--color-app-warning-fg)]">
          {warningKeys.map((key) => (
            <li key={key} className="break-words">
              {t(key)}
            </li>
          ))}
        </ul>
      )}

      {job.status === 'FAILED' && (
        <p className="mt-3 break-words text-sm text-[var(--color-app-danger)]">
          {captureErrorText(t, job.error?.code ?? 'UNKNOWN', job.error?.message)}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2 empty:hidden">
        {finished && job.transcript && (
          <Button asChild size="sm" variant="secondary">
            <Link to={`/transcricoes/${encodeURIComponent(job.transcript.id)}`}>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              {t('capture.openDocument')}
            </Link>
          </Button>
        )}
        {canRetry(job) && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pending !== null}
            onClick={() => void run('retry')}
          >
            {pending === 'retry' ? (
              <Spinner size={12} />
            ) : (
              <RotateCw className="h-3.5 w-3.5" aria-hidden />
            )}
            {t('capture.retry')}
          </Button>
        )}
        {job.status === 'FAILED' && errorAction === 'upload' && onUpload && (
          <Button type="button" size="sm" variant="outline" onClick={onUpload}>
            <Upload className="h-3.5 w-3.5" aria-hidden />
            {t('capture.pickFile')}
          </Button>
        )}
        {job.status === 'FAILED' && errorAction === 'configure_ai' && (
          <Button asChild size="sm" variant="outline">
            <Link to="/conta/ia">
              <Settings className="h-3.5 w-3.5" aria-hidden />
              {t('capture.configure')}
            </Link>
          </Button>
        )}
        {active && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending !== null}
            onClick={() => void run('cancel')}
          >
            {pending === 'cancel' ? (
              <Spinner size={12} />
            ) : (
              <X className="h-3.5 w-3.5" aria-hidden />
            )}
            {t('capture.cancel')}
          </Button>
        )}
      </div>
    </article>
  );
}
