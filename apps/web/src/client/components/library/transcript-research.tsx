import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { apiPatch, apiPost } from '../../lib/api';
import { useFetch } from '../../lib/hooks';
import { useI18n } from '../../lib/i18n';
import { researchErrorText } from '../../lib/research-api';
import { Button } from '../ui/button';
import {
  AdditionalContextBlock,
  enrichmentStatusText,
  type TranscriptEnrichment,
  type TranscriptEnrichmentsResponse,
} from './additional-context-block';

export function TranscriptResearch({
  transcriptId,
  sourceActive,
}: {
  transcriptId: string;
  sourceActive: boolean;
}): React.ReactElement {
  const { t, locale } = useI18n();
  const { hash } = useLocation();
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const cursor = cursors.at(-1);
  const base = `/api/research/documents/${encodeURIComponent(transcriptId)}`;
  const path = `${base}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
  const page = useFetch<TranscriptEnrichmentsResponse>(path);
  const data = page.resolvedPath === path ? page.data : null;
  const targetId = /^#additional-context-([a-zA-Z0-9_-]{1,128})$/.exec(hash)?.[1];
  const pinPath =
    targetId && data && !data.enrichments.some((row) => row.id === targetId)
      ? `${base}/${encodeURIComponent(targetId)}`
      : null;
  const pinned = useFetch<TranscriptEnrichment>(pinPath);
  const pin = pinPath && pinned.resolvedPath === pinPath ? pinned.data : null;
  const rows = [...(data?.enrichments ?? []), ...(pin ? [pin] : [])];
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const requestKey = useRef(crypto.randomUUID());
  const scrolledTarget = useRef('');
  const busy = rows.some((row) => ['PENDING', 'RUNNING', 'RETRY'].includes(row.status));
  const unsettled =
    busy || rows.some((row) => row.deletionPending || row.projection.state === 'PENDING');
  const refresh = page.refresh;
  const refreshPin = pinned.refresh;
  useEffect(() => {
    if (!unsettled) return;
    const timer = window.setInterval(() => {
      refresh();
      if (pinPath) refreshPin();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [unsettled, refresh, refreshPin, pinPath]);
  useEffect(() => {
    if (!targetId || scrolledTarget.current === hash || !rows.some((row) => row.id === targetId))
      return;
    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(`additional-context-${targetId}`);
      if (!element) return;
      scrolledTarget.current = hash;
      element.scrollIntoView({ block: 'start', behavior: 'instant' });
      element.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [targetId, hash, data, pin]);
  async function queue(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    setNotice('');
    try {
      await apiPost(base, { requestKey: requestKey.current });
      requestKey.current = crypto.randomUUID();
      setCursors([null]);
      setNotice(t('library.additionalContextQueued'));
      refresh();
    } catch (error) {
      setNotice(researchErrorText(error, t));
    } finally {
      setSubmitting(false);
    }
  }
  async function update(id: string, body: Record<string, unknown>): Promise<void> {
    setNotice('');
    try {
      await apiPatch(`${base}/${encodeURIComponent(id)}`, body);
      setNotice(t(body.action === 'delete' ? 'research.deleting' : 'research.updated'));
    } catch (error) {
      const message = researchErrorText(error, t);
      setNotice(message);
      throw new Error(message);
    } finally {
      refresh();
      refreshPin();
    }
  }
  const error = page.error || (pinPath && pinned.error);
  return (
    <div className="border-t border-[var(--color-app-border)] pt-8">
      <AdditionalContextBlock
        enrichments={rows}
        researchMode={data?.researchMode ?? 'OFF'}
        loading={!data && page.loading}
        queueDisabled={submitting || Boolean(page.error)}
        archived={!sourceActive}
        locale={locale}
        t={t}
        onQueue={() => void queue()}
        onUpdate={update}
        onDelete={(id, guard) => update(id, { action: 'delete', ...guard })}
      />
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={t('research.status')}
        className="mt-3 text-sm leading-6 text-[var(--color-app-subtle)]"
      >
        {[notice, rows[0] ? enrichmentStatusText(rows[0], t) : ''].filter(Boolean).join(' ')}
      </p>
      {error && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-[var(--color-app-danger)]">
          <p>{researchErrorText(error, t)}</p>
          <Button
            variant="outline"
            onClick={() => {
              refresh();
              refreshPin();
            }}
          >
            {t('research.retry')}
          </Button>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-app-border)] pt-4">
        <Link
          to="/conta/ia#library-research"
          className="inline-flex min-h-11 items-center text-sm text-[var(--color-accent-primary)] underline underline-offset-4"
        >
          {t('research.configure')}
        </Link>
        {(cursors.length > 1 || data?.nextCursor) && (
          <nav aria-label={t('research.history')} className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              disabled={cursors.length <= 1 || page.loading}
              onClick={() => setCursors((current) => current.slice(0, -1))}
            >
              {t('research.newer')}
            </Button>
            <Button
              variant="outline"
              disabled={!data?.nextCursor || page.loading}
              onClick={() => {
                if (data?.nextCursor) setCursors((current) => [...current, data.nextCursor]);
              }}
            >
              {t('research.older')}
            </Button>
          </nav>
        )}
      </div>
    </div>
  );
}
