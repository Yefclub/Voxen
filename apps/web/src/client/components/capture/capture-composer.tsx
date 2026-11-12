import { forwardRef, useCallback, useId, useImperativeHandle, useRef, useState } from 'react';
import { ArrowRight, Link2, Upload } from '@/components/ui/icons';
import { toast } from '@/lib/toast';
import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';
import { useI18n } from '../../lib/i18n';
import {
  submitCaptureLink,
  uploadCaptureFile,
  type CaptureJob,
  type CaptureSubmitResult,
} from '../../lib/capture-api';
import { CAPTURE_FILE_ACCEPT, actionForCode } from '../../lib/capture-state';
import { CaptureNotice, captureErrorText, type CaptureNoticeState } from './capture-notice';

export interface CaptureComposerHandle {
  openFilePicker: () => void;
  /** Fills the link field and focuses it without submitting. */
  prefillUrl: (url: string) => void;
  showNotice: (notice: CaptureNoticeState | null) => void;
}

interface CaptureComposerProps {
  onExisting: (transcriptId: string) => void;
  onJob: (job: CaptureJob, deduped: boolean) => void;
}

function hasFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Link + file capture input. Enter submits the link; a picked or dropped file
 * goes to the upload endpoint. Synchronous outcomes other than a new job
 * Existing content opens directly; invalid links and configuration errors stay inline.
 */
export const CaptureComposer = forwardRef<CaptureComposerHandle, CaptureComposerProps>(
  function CaptureComposer({ onJob, onExisting }, ref) {
    const { t } = useI18n();
    const [url, setUrl] = useState('');
    const [busy, setBusy] = useState<'link' | 'upload' | null>(null);
    const [upload, setUpload] = useState<{ name: string; percent: number } | null>(null);
    const [notice, setNotice] = useState<CaptureNoticeState | null>(null);
    const [dragging, setDragging] = useState(false);
    const dragDepth = useRef(0);
    const fileInput = useRef<HTMLInputElement>(null);
    const urlInput = useRef<HTMLInputElement>(null);
    const noticeId = useId();
    const inputId = useId();

    const handleResult = useCallback(
      (result: CaptureSubmitResult): void => {
        if (result.kind === 'job') {
          setUrl('');
          setNotice(null);
          toast.success(result.deduped ? t('capture.dedupedToast') : t('capture.queuedToast'));
          onJob(result.job, result.deduped);
          return;
        }
        if (result.kind === 'existing') {
          onExisting(result.transcript.id);
          return;
        }
        const code =
          result.error?.code ?? (result.status === 429 ? 'SHARE_RATE_LIMITED' : 'UNKNOWN');
        setNotice({
          type: 'error',
          code,
          message: captureErrorText(t, code, result.error?.message ?? result.message),
          action: result.error?.action ?? actionForCode(code),
          settingsUrl: result.error?.settingsUrl,
        });
        if (code === 'INVALID_URL' || code === 'BLOCKED_ADDRESS') urlInput.current?.focus();
      },
      [onJob, onExisting, t],
    );

    const submitUrl = useCallback(
      async (value: string): Promise<void> => {
        const trimmed = value.trim();
        if (!trimmed || busy) return;
        setBusy('link');
        try {
          handleResult(await submitCaptureLink(trimmed));
        } catch {
          handleResult({ kind: 'error', status: 0, error: null, message: null });
        } finally {
          setBusy(null);
        }
      },
      [busy, handleResult],
    );

    const sendFile = useCallback(
      async (file: File): Promise<void> => {
        if (busy) return;
        setBusy('upload');
        setNotice(null);
        setUpload({ name: file.name, percent: 0 });
        try {
          handleResult(
            await uploadCaptureFile(file, (fraction) =>
              setUpload({ name: file.name, percent: Math.round(fraction * 100) }),
            ),
          );
        } catch {
          handleResult({ kind: 'error', status: 0, error: null, message: null });
        } finally {
          setBusy(null);
          setUpload(null);
        }
      },
      [busy, handleResult],
    );

    useImperativeHandle(
      ref,
      () => ({
        openFilePicker: () => fileInput.current?.click(),
        prefillUrl: (value: string) => {
          setUrl(value);
          urlInput.current?.focus();
        },
        showNotice: setNotice,
      }),
      [],
    );

    const invalidUrl =
      notice?.type === 'error' &&
      (notice.code === 'INVALID_URL' || notice.code === 'BLOCKED_ADDRESS');

    return (
      <div
        className="relative space-y-3"
        onDragEnter={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (hasFiles(event)) event.preventDefault();
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void sendFile(file);
        }}
      >
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void submitUrl(url);
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Link2
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-app-muted)]"
              aria-hidden
            />
            <input
              ref={urlInput}
              id={inputId}
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="go"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={t('capture.inputPlaceholder')}
              aria-label={t('capture.inputLabel')}
              aria-invalid={invalidUrl || undefined}
              aria-describedby={notice ? noticeId : undefined}
              maxLength={4096}
              className="h-12 w-full rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)] pl-9 pr-3 text-[15px] text-[var(--color-app-fg)] placeholder:text-[var(--color-app-muted)] transition-colors hover:border-[var(--color-app-border-strong)] focus:border-[var(--color-accent-primary)] focus:outline-none focus:ring-2 focus:ring-violet-500/40 aria-[invalid=true]:border-[var(--color-app-danger)]/60 sm:text-sm"
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            className="h-11 shrink-0 px-4"
            disabled={!url.trim() || busy !== null}
          >
            {busy === 'link' ? (
              <Spinner size={14} />
            ) : (
              <ArrowRight className="h-4 w-4" aria-hidden />
            )}
            <span>{t('capture.submit')}</span>
          </Button>
        </form>
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p
            className="min-w-0 text-xs leading-relaxed text-[var(--color-app-muted)]"
            aria-live="polite"
          >
            {upload
              ? t('capture.uploading', { name: upload.name, percent: upload.percent })
              : t('capture.fileHint')}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            disabled={busy !== null}
            onClick={() => fileInput.current?.click()}
          >
            {busy === 'upload' ? (
              <Spinner size={12} />
            ) : (
              <Upload className="h-3.5 w-3.5" aria-hidden />
            )}
            {t('capture.pickFile')}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept={CAPTURE_FILE_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void sendFile(file);
            }}
          />
        </div>
        {notice && (
          <CaptureNotice
            id={noticeId}
            notice={notice}
            onDismiss={() => setNotice(null)}
            onUpload={() => fileInput.current?.click()}
          />
        )}
        {dragging && (
          <div
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-violet-500/60 bg-[var(--color-app-bg)]/85 text-sm font-medium text-[var(--color-app-fg)]"
            aria-hidden
          >
            {t('capture.dropHint')}
          </div>
        )}
      </div>
    );
  },
);
