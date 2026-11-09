import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download } from '@/components/ui/icons';
import { Button } from '../components/ui/button';
import { FetchError } from '../components/ui/fetch-error';
import { Skeleton } from '../components/ui/skeleton';
import { Spinner } from '../components/ui/spinner';
import { PageHeader, PageShell } from '../components/ui/page-shell';
import {
  CaptureComposer,
  type CaptureComposerHandle,
} from '../components/capture/capture-composer';
import { CaptureJobCard } from '../components/capture/capture-job-card';
import { captureErrorText } from '../components/capture/capture-notice';
import { useI18n } from '../lib/i18n';
import { fetchCapture, fetchCaptures, type CaptureJob } from '../lib/capture-api';
import {
  actionForCode,
  isActiveCapture,
  mergeCaptures,
  readCapturePageIntent,
} from '../lib/capture-state';

/** Open SSE streams for at most this many active jobs; the rest are polled. */
const MAX_LIVE_STREAMS = 3;
const POLL_MS = 10_000;

export function CapturarPage(): React.ReactElement {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const intent = useMemo(() => readCapturePageIntent(params), [params]);
  const composer = useRef<CaptureComposerHandle>(null);
  const [jobs, setJobs] = useState<CaptureJob[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharedPending, setSharedPending] = useState(false);
  const [tick, setTick] = useState(0);

  const upsert = useCallback((job: CaptureJob) => {
    setJobs((current) => mergeCaptures(current, [job]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchCaptures()
      .then((page) => {
        if (cancelled) return;
        setJobs((current) => mergeCaptures(current, page.captures));
        setCursor((current) => current ?? page.nextCursor);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t('capture.loadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t, tick]);

  // A focused job (share target, library bar) may be older than the first page.
  useEffect(() => {
    const id = intent.focusJobId;
    if (!id || loading || jobs.some((job) => job.id === id)) return;
    let cancelled = false;
    void fetchCapture(id).then((job) => {
      if (job && !cancelled) upsert(job);
    });
    return () => {
      cancelled = true;
    };
  }, [intent.focusJobId, jobs, loading, upsert]);

  // Surface share-target and redirect outcomes in the composer's notice slot.
  useEffect(() => {
    if (intent.error) {
      composer.current?.showNotice({
        type: 'error',
        code: intent.error,
        message: captureErrorText(t, intent.error),
        action: actionForCode(intent.error),
      });
    } else if (intent.existingTranscriptId) {
      composer.current?.showNotice({
        type: 'existing',
        transcriptId: intent.existingTranscriptId,
        title: '',
      });
    }
  }, [intent.error, intent.existingTranscriptId, t]);

  // After login the share target hands the link over as `?shared=`. A GET link
  // must never start a capture by itself (it could be forged cross-site), so
  // the link is only prefilled and the user confirms with one tap.
  useEffect(() => {
    const url = intent.sharedUrl;
    if (!url || !composer.current) return;
    const next = new URLSearchParams(params);
    next.delete('shared');
    setParams(next, { replace: true });
    composer.current.prefillUrl(url);
    setSharedPending(true);
  }, [intent.sharedUrl, params, setParams]);

  const onJob = useCallback(
    (job: CaptureJob) => {
      upsert(job);
      const next = new URLSearchParams();
      next.set('job', job.id);
      setParams(next, { replace: true });
    },
    [setParams, upsert],
  );

  const active = jobs.filter(isActiveCapture);
  const liveIds = new Set(active.slice(0, MAX_LIVE_STREAMS).map((job) => job.id));
  const needsPolling = active.length > liveIds.size;

  useEffect(() => {
    if (!needsPolling) return;
    const timer = setInterval(() => setTick((n) => n + 1), POLL_MS);
    return () => clearInterval(timer);
  }, [needsPolling]);

  async function loadMore(): Promise<void> {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchCaptures(cursor);
      setJobs((current) => mergeCaptures(current, page.captures));
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('capture.loadError'));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <PageShell width="reading" className="max-w-3xl">
      <PageHeader
        eyebrow={t('capture.eyebrow')}
        icon={Download}
        iconClassName="text-violet-400"
        title={t('capture.title')}
        description={t('capture.description')}
      />

      <section aria-label={t('capture.inputLabel')} className="space-y-3">
        <CaptureComposer ref={composer} onJob={onJob} />
        {sharedPending && (
          <p
            className="flex items-center gap-2 text-sm text-[var(--color-app-muted)]"
            role="status"
          >
            {t('capture.sharedReady')}
          </p>
        )}
      </section>

      <section aria-labelledby="capture-recent-title" className="space-y-3">
        <h2
          id="capture-recent-title"
          className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-app-muted)]"
        >
          {t('capture.recent')}
        </h2>
        {error && jobs.length === 0 ? (
          <FetchError message={error} onRetry={() => setTick((n) => n + 1)} />
        ) : loading && jobs.length === 0 ? (
          <div className="space-y-3" aria-busy>
            <Skeleton className="h-[76px] w-full rounded-xl" />
            <Skeleton className="h-[76px] w-full rounded-xl" />
          </div>
        ) : jobs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--color-app-border)] px-4 py-8 text-center text-sm text-[var(--color-app-muted)]">
            {t('capture.empty')}
          </p>
        ) : (
          <ul className="space-y-3">
            {jobs.map((job) => (
              <li key={job.id}>
                <CaptureJobCard
                  job={job}
                  live={liveIds.has(job.id)}
                  focused={job.id === intent.focusJobId}
                  onChange={upsert}
                  onUpload={() => composer.current?.openFilePicker()}
                />
              </li>
            ))}
          </ul>
        )}
        {cursor && jobs.length > 0 && (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore && <Spinner size={12} />}
              {t('capture.loadMore')}
            </Button>
          </div>
        )}
      </section>
    </PageShell>
  );
}
