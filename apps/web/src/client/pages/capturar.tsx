import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  foregroundCaptureDocumentPath,
  isActiveCapture,
  mergeCaptures,
  readCapturePageIntent,
} from '../lib/capture-state';

/** Open SSE streams for at most this many active jobs; the rest are polled. */
const MAX_LIVE_STREAMS = 3;
const POLL_MS = 10_000;

export function CapturarPage(): React.ReactElement {
  const { t } = useI18n();
  const navigate = useNavigate();
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
  const [focusMissing, setFocusMissing] = useState<string | null>(null);
  const [focusRetry, setFocusRetry] = useState(0);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const navigatedCapture = useRef<string | null>(null);
  const focusedJob = jobs.find((job) => job.id === intent.focusJobId);

  useEffect(() => {
    if (intent.error || intent.sharedUrl || sharedPending) return;
    const target = foregroundCaptureDocumentPath(focusedJob, intent.focusJobId);
    const key = target
      ? `job:${intent.focusJobId}`
      : intent.existingTranscriptId
        ? `existing:${intent.existingTranscriptId}`
        : null;
    if (!key || navigatedCapture.current === key) return;
    const path = target ?? `/transcricoes/${encodeURIComponent(intent.existingTranscriptId!)}`;
    navigatedCapture.current = key;
    navigate(path, {
      replace: true,
      state: focusedJob
        ? { capture: { id: focusedJob.id, warnings: focusedJob.warnings } }
        : undefined,
    });
  }, [
    focusedJob,
    intent.error,
    intent.existingTranscriptId,
    intent.focusJobId,
    intent.sharedUrl,
    navigate,
    sharedPending,
  ]);

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
    if (!id || loading || jobsRef.current.some((job) => job.id === id)) return;
    let cancelled = false;
    setFocusMissing(null);
    void fetchCapture(id)
      .then((job) => {
        if (cancelled) return;
        if (job) upsert(job);
        else setFocusMissing(id);
      })
      .catch(() => {
        if (!cancelled) setFocusMissing(id);
      });
    return () => {
      cancelled = true;
    };
  }, [intent.focusJobId, loading, upsert, focusRetry]);

  // Surface share-target and redirect outcomes in the composer's notice slot.
  useEffect(() => {
    if (intent.error) {
      composer.current?.showNotice({
        type: 'error',
        code: intent.error,
        message: captureErrorText(t, intent.error),
        action: actionForCode(intent.error),
      });
    }
  }, [intent.error, t]);

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
      setSharedPending(false);
      upsert(job);
      const next = new URLSearchParams();
      next.set('job', job.id);
      setParams(next, { replace: true });
    },
    [setParams, upsert],
  );

  const active = jobs.filter(isActiveCapture);
  const prioritized = [...active].sort(
    (a, b) => Number(b.id === intent.focusJobId) - Number(a.id === intent.focusJobId),
  );
  const liveIds = new Set(prioritized.slice(0, MAX_LIVE_STREAMS).map((job) => job.id));
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

  const following = Boolean(intent.focusJobId);
  const history = jobs.filter((job) => job.id !== focusedJob?.id);
  const historyContent = (
    <>
      {error && jobs.length === 0 ? (
        <FetchError message={error} onRetry={() => setTick((n) => n + 1)} />
      ) : loading && jobs.length === 0 ? (
        <div className="space-y-3" aria-busy>
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      ) : history.length === 0 ? (
        <p className="py-10 text-sm leading-relaxed text-[var(--color-app-muted)]">
          {t('capture.empty')}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-app-border)]">
          {history.map((job) => (
            <li key={job.id}>
              <CaptureJobCard
                job={job}
                live={liveIds.has(job.id)}
                onChange={upsert}
                onUpload={() => composer.current?.openFilePicker()}
              />
            </li>
          ))}
        </ul>
      )}
      {cursor && jobs.length > 0 && (
        <div className="flex justify-center pt-4">
          <Button
            type="button"
            variant="secondary"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore && <Spinner size={14} />}
            {t('capture.loadMore')}
          </Button>
        </div>
      )}
    </>
  );

  return (
    <PageShell>
      <PageHeader
        title={t('capture.title')}
        description={
          focusMissing === intent.focusJobId && intent.focusJobId
            ? undefined
            : t(following ? 'capture.following' : 'capture.description')
        }
        actions={
          following && (
            <Button
              variant="secondary"
              onClick={() => {
                setParams({});
                setSharedPending(false);
              }}
            >
              {t('capture.new')}
            </Button>
          )
        }
      />
      <section
        aria-label={t('capture.inputLabel')}
        hidden={following}
        className="max-w-3xl space-y-3"
      >
        <CaptureComposer
          ref={composer}
          onJob={onJob}
          onExisting={(id) => {
            setSharedPending(false);
            navigate(`/transcricoes/${encodeURIComponent(id)}`, { replace: true });
          }}
        />
        {sharedPending && (
          <p className="text-sm text-[var(--color-app-subtle)]" role="status">
            {t('capture.sharedReady')}
          </p>
        )}
      </section>
      {following && !focusedJob && (
        <section aria-label={t('capture.current')} className="max-w-3xl">
          {focusMissing === intent.focusJobId ? (
            <FetchError
              message={t('design.captureMissing')}
              onRetry={() => setFocusRetry((n) => n + 1)}
            />
          ) : (
            <Skeleton className="h-44 w-full rounded-xl" aria-busy />
          )}
        </section>
      )}
      {focusedJob && (
        <section aria-label={t('capture.current')} className="max-w-3xl">
          <CaptureJobCard
            job={focusedJob}
            live={liveIds.has(focusedJob.id)}
            focused
            onChange={upsert}
            onUpload={() => composer.current?.openFilePicker()}
          />
          {isActiveCapture(focusedJob) && (
            <p className="mt-4 text-sm leading-relaxed text-[var(--color-app-muted)]">
              {t('capture.opensWhenReady')}
            </p>
          )}
        </section>
      )}
      {following ? (
        <details className="border-t border-[var(--color-app-border)] pt-4">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-[var(--color-app-subtle)]">
            {t('capture.recent')}
          </summary>
          {historyContent}
        </details>
      ) : (
        <section
          aria-labelledby="capture-recent-title"
          className="border-t border-[var(--color-app-border)] pt-6"
        >
          <h2
            id="capture-recent-title"
            className="mb-2 text-base font-semibold text-[var(--color-app-fg)]"
          >
            {t('capture.recent')}
          </h2>
          {historyContent}
        </section>
      )}
    </PageShell>
  );
}
