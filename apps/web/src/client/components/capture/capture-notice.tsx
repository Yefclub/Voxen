import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  RotateCw,
  Settings,
  Upload,
  X,
} from '@/components/ui/icons';
import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';
import { cn } from '../../lib/utils';
import { useI18n, type I18nKey } from '../../lib/i18n';
import type { CaptureAction } from '../../lib/capture-api';

export type CaptureNoticeState =
  | { type: 'existing'; transcriptId: string; title: string }
  | { type: 'error'; code: string; message: string; action: CaptureAction; settingsUrl?: string };

/** Localized text for a code, falling back to the server message. */
export function captureErrorText(
  t: (key: I18nKey) => string,
  code: string,
  serverMessage?: string | null,
): string {
  if (serverMessage) return serverMessage;
  const key = `capture.error.${code}` as I18nKey;
  const text = t(key);
  return text === key ? t('capture.genericError') : text;
}

/**
 * Synchronous submit outcome shown under the composer or at the top of the
 * capture page: an existing document (open / reprocess) or an error with its
 * suggested next step.
 */
export function CaptureNotice({
  notice,
  id,
  reprocessing = false,
  onDismiss,
  onReprocess,
  onUpload,
  className,
}: {
  notice: CaptureNoticeState;
  id?: string;
  reprocessing?: boolean;
  onDismiss: () => void;
  onReprocess?: (transcriptId: string) => void;
  onUpload?: () => void;
  className?: string;
}): React.ReactElement {
  const { t } = useI18n();
  const isError = notice.type === 'error';
  return (
    <div
      id={id}
      role={isError ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm',
        isError
          ? 'border-[var(--color-app-danger)]/35 bg-[var(--color-app-danger)]/5'
          : 'border-[var(--color-app-border-strong)] bg-[var(--color-app-bg-elevated)]',
        className,
      )}
    >
      {isError ? (
        <AlertTriangle
          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-app-danger)]"
          aria-hidden
        />
      ) : (
        <CheckCircle2
          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-app-success-fg)]"
          aria-hidden
        />
      )}
      <div className="min-w-0 flex-1 space-y-2">
        {notice.type === 'existing' ? (
          <div className="space-y-0.5">
            <p className="font-medium text-[var(--color-app-fg)]">{t('capture.existingTitle')}</p>
            {notice.title && (
              <p className="break-words text-[var(--color-app-muted)]">
                {t('capture.existingNamed', { title: notice.title })}
              </p>
            )}
          </div>
        ) : (
          <p className="break-words text-[var(--color-app-fg)]">{notice.message}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {notice.type === 'existing' && (
            <>
              <Button asChild size="sm" variant="secondary">
                <Link to={`/transcricoes/${encodeURIComponent(notice.transcriptId)}`}>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  {t('capture.open')}
                </Link>
              </Button>
              {onReprocess && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={reprocessing}
                  onClick={() => onReprocess(notice.transcriptId)}
                >
                  {reprocessing ? (
                    <Spinner size={12} />
                  ) : (
                    <RotateCw className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {t('capture.reprocess')}
                </Button>
              )}
            </>
          )}
          {notice.type === 'error' && notice.action === 'configure_ai' && (
            <Button asChild size="sm" variant="secondary">
              <Link to={notice.settingsUrl ?? '/conta/ia'}>
                <Settings className="h-3.5 w-3.5" aria-hidden />
                {t('capture.configure')}
              </Link>
            </Button>
          )}
          {notice.type === 'error' && notice.action === 'upload' && onUpload && (
            <Button type="button" size="sm" variant="secondary" onClick={onUpload}>
              <Upload className="h-3.5 w-3.5" aria-hidden />
              {t('capture.pickFile')}
            </Button>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('capture.dismiss')}
        className="-mr-1 -mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
