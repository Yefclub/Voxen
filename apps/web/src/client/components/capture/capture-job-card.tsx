import { CaptureWarnings } from './capture-warnings';
import { useState } from 'react';
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
  const [actionError, setActionError] = useState(false);
  useCaptureLive(job, live, onChange);

  async function run(command: 'cancel' | 'retry'): Promise<void> {
    setPending(command);
    setActionError(false);
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
    } catch {
      setActionError(true);
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

  return (
    <article
      tabIndex={-1}
      aria-labelledby={titleId}
      className={cn(
        'py-5 transition-colors focus:outline-none',
        focused
          ? 'rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] p-5 sm:p-6'
          : '',
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] text-[var(--color-app-muted)]">
          <KindIcon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 basis-[calc(100%-4rem)] sm:basis-0">
          <p
            id={titleId}
            className="break-words text-[15px] font-medium leading-relaxed text-[var(--color-app-fg)]"
            title={job.sourceUrl ?? label}
          >
            {label}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-app-muted)]">
            {subtitle.join(' · ')}
          </p>
        </div>
        <Badge variant={status.variant} className="ml-12 shrink-0 sm:ml-0">
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
        <details className="mt-3 text-xs text-[var(--color-app-muted)]">
          <summary className="inline-flex min-h-11 cursor-pointer items-center gap-2">
            {t('capture.details')}
          </summary>
          <p className="break-words pb-2 leading-relaxed">{doneMeta.join(' · ')}</p>
        </details>
      )}

      {job.status === 'COMPLETED_WITH_WARNINGS' && (
        <div className="mt-3">
          <CaptureWarnings codes={job.warnings ?? []} />
        </div>
      )}

      {job.status === 'FAILED' && (
        <p className="mt-3 break-words text-sm text-[var(--color-app-danger)]">
          {captureErrorText(t, job.error?.code ?? 'UNKNOWN', job.error?.message)}
        </p>
      )}

      {actionError && (
        <p role="alert" className="mt-3 text-sm text-[var(--color-app-danger)]">
          {t('capture.actionError')}
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
