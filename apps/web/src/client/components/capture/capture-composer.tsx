import {
  forwardRef,
  useCallback,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { ArrowRight, Link2, Upload } from '@/components/ui/icons';
import { toast } from '@/lib/toast';
import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';
import { TextInput } from '../ui/text-input';
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
  /** The BrowserRouter location key that owns submission callbacks. */
  journeyKey: string;
  onExisting: (transcriptId: string) => void;
  onJob: (job: CaptureJob, deduped: boolean) => void;
}

function hasFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Link + file capture input. Enter submits the link; a picked or dropped file
 * goes to the upload endpoint. Existing content opens directly; invalid links
 * and configuration errors stay inline.
 */
export const CaptureComposer = forwardRef<CaptureComposerHandle, CaptureComposerProps>(
  function CaptureComposer({ journeyKey, onJob, onExisting }, ref) {
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
    const request = useRef<symbol | null>(null);

    useLayoutEffect(() => {
      setBusy(null);
      setUpload(null);
      return () => {
        // An abandoned journey must not publish a pending submission's result.
        request.current = null;
      };
    }, [journeyKey]);

    const ownsRequest = useCallback(
      (owner: symbol): boolean => {
        // Lazy route transitions can leave this component mounted after history moves.
        const currentJourney = window.history.state as { key?: string } | null;
        return request.current === owner && (currentJourney?.key ?? 'default') === journeyKey;
      },
      [journeyKey],
    );

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
        if (!trimmed || request.current) return;
        const owner = Symbol();
        request.current = owner;
        setBusy('link');
        try {
          const result = await submitCaptureLink(trimmed);
          if (ownsRequest(owner)) handleResult(result);
        } catch {
          if (ownsRequest(owner))
            handleResult({ kind: 'error', status: 0, error: null, message: null });
        } finally {
          if (request.current === owner) {
            request.current = null;
            setBusy(null);
          }
        }
      },
      [handleResult, ownsRequest],
    );

    const sendFile = useCallback(
      async (file: File): Promise<void> => {
        if (request.current) return;
        const owner = Symbol();
        request.current = owner;
        setBusy('upload');
        setNotice(null);
        setUpload({ name: file.name, percent: 0 });
        try {
          const result = await uploadCaptureFile(file, (fraction) => {
            if (ownsRequest(owner))
              setUpload({ name: file.name, percent: Math.round(fraction * 100) });
          });
          if (ownsRequest(owner)) handleResult(result);
        } catch {
          if (ownsRequest(owner))
            handleResult({ kind: 'error', status: 0, error: null, message: null });
        } finally {
          if (request.current === owner) {
            request.current = null;
            setBusy(null);
            setUpload(null);
          }
        }
      },
      [handleResult, ownsRequest],
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
            <TextInput
              ref={urlInput}
              id={inputId}
              type="text"
              label={t('capture.inputLabel')}
              isLabelHidden
              startIcon={<Link2 className="h-4 w-4" />}
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              hasSpellCheck={false}
              enterKeyHint="go"
              value={url}
              onChange={setUrl}
              placeholder={t('capture.inputPlaceholder')}
              status={invalidUrl ? { type: 'error' } : undefined}
              aria-describedby={notice ? noticeId : undefined}
              maxLength={4096}
              controlClassName="capture-url-control"
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
