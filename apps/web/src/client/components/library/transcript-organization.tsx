import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { apiPatch, apiPost } from '../../lib/api';
import { useFetch } from '../../lib/hooks';
import { useI18n } from '../../lib/i18n';
import {
  organizationActive,
  organizationErrorText,
  organizationProgressText,
  organizationStatusText,
  organizationWarnings,
  type OrganizationPage,
  type OrganizationRun,
} from '../../lib/organization-api';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';
import { ChevronDown } from '../ui/icons';

export function TranscriptOrganization({
  transcriptId,
  sourceActive,
}: {
  transcriptId: string;
  sourceActive: boolean;
}): React.ReactElement {
  const { t } = useI18n(),
    { hash } = useLocation();
  const base = `/api/organization/documents/${encodeURIComponent(transcriptId)}`;
  const page = useFetch<OrganizationPage>(base);
  const head = page.resolvedPath === base ? page.data : null;
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const cursor = cursors.at(-1);
  const historyPath = cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : null;
  const history = useFetch<OrganizationPage>(historyPath);
  const historyData = historyPath
    ? history.resolvedPath === historyPath
      ? history.data
      : null
    : head;
  const targetId = /^#organization-([a-zA-Z0-9_-]{1,128})$/.exec(hash)?.[1];
  const pinPath =
    targetId && !historyData?.items.some((row) => row.id === targetId)
      ? `${base}/${encodeURIComponent(targetId)}`
      : null;
  const pinned = useFetch<OrganizationRun>(pinPath);
  const pin = pinPath && pinned.resolvedPath === pinPath ? pinned.data : null;
  const rows = [...(historyData?.items ?? []), ...(pin ? [pin] : [])];
  const latest = head?.items[0];
  const active = Boolean(latest && organizationActive(latest));
  const isSourceActive = sourceActive && (head?.sourceActive ?? true);
  const [open, setOpen] = useState(Boolean(targetId));
  const [mutation, setMutation] = useState<string | null>(null);
  const [notice, setNotice] = useState(''),
    [failed, setFailed] = useState(false);
  const pending = useRef(false),
    requestKey = useRef(crypto.randomUUID()),
    queuedRunId = useRef<string | null>(null);
  const refresh = page.refresh,
    refreshHistory = history.refresh,
    refreshPin = pinned.refresh;
  const shouldPoll = active || head?.mode === 'AUTO' || Boolean(pin && organizationActive(pin));
  useEffect(() => {
    if (!shouldPoll) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      refresh();
      if (historyPath) refreshHistory();
      if (pinPath) refreshPin();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [shouldPoll, refresh, refreshHistory, refreshPin, historyPath, pinPath]);
  const hasTarget = Boolean(targetId && rows.some((row) => row.id === targetId));
  useEffect(() => {
    if (!targetId) return;
    setOpen(true);
    if (!hasTarget) return;
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(`organization-${targetId}`);
      element?.scrollIntoView({ block: 'start', behavior: 'instant' });
      element?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [targetId, hasTarget]);
  async function update(row?: OrganizationRun) {
    if (pending.current) return;
    pending.current = true;
    setMutation(row?.id ?? 'queue');
    setNotice('');
    setFailed(false);
    try {
      if (row) {
        const result = await apiPatch<OrganizationRun>(`${base}/${encodeURIComponent(row.id)}`, {
          expectedRevision: row.revision,
        });
        setNotice(
          result.status === 'CANCELLED'
            ? t('organization.cancelled')
            : organizationStatusText(result, t),
        );
      } else {
        const result = await apiPost<{ id: string }>(base, { requestKey: requestKey.current });
        queuedRunId.current = result.id;
        requestKey.current = crypto.randomUUID();
        setCursors([null]);
        setNotice(t('organization.queued'));
      }
    } catch (error) {
      setFailed(true);
      setNotice(organizationErrorText(error, t));
    } finally {
      pending.current = false;
      setMutation(null);
      refresh();
      refreshHistory();
      refreshPin();
    }
  }
  const error = page.error || (historyPath && history.error) || (pinPath && pinned.error);
  const statusText = latest
    ? `${organizationStatusText(latest, t)}${latest.warnings.length ? ` · ${t('organization.hasWarnings')}` : ''}`
    : '';
  const visibleNotice =
    notice === t('organization.queued') && latest?.id === queuedRunId.current ? '' : notice;
  return (
    <section
      aria-labelledby="document-organization-title"
      className="min-w-0 space-y-4 border-t border-[var(--color-app-border)] pt-7"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2 sm:flex-1">
          <h2
            id="document-organization-title"
            className="font-display text-lg font-semibold tracking-tight text-[var(--color-app-fg)]"
          >
            {t('organization.title')}
          </h2>
          <p className="max-w-[65ch] text-sm leading-6 text-[var(--color-app-muted)]">
            {t('organization.description')}
          </p>
        </div>
        {head && head.mode !== 'OFF' && (
          <Button
            variant="outline"
            className="min-h-11 self-start sm:shrink-0"
            disabled={Boolean(mutation) || active || !isSourceActive || Boolean(page.error)}
            onClick={() => void update()}
          >
            {t(mutation === 'queue' ? 'organization.queueing' : 'organization.queue')}
          </Button>
        )}
      </div>
      <p className="text-sm leading-6 text-[var(--color-app-muted)]">
        {t('organization.disclosure')}{' '}
        <Link
          to="/conta/ia#library-organization"
          className="inline-flex min-h-11 items-center text-[var(--color-accent-primary)] underline underline-offset-4"
        >
          {t('organization.configure')}
        </Link>
      </p>
      {!isSourceActive && (
        <p className="text-sm leading-6 text-[var(--color-app-muted)]">
          {t('organization.archived')}
        </p>
      )}
      {!head && page.loading && <Skeleton className="h-16 w-full rounded-lg" />}
      {head && !latest && (
        <p className="text-sm leading-6 text-[var(--color-app-subtle)]">
          {t(head.mode === 'OFF' ? 'organization.off' : 'organization.empty')}
        </p>
      )}
      <p
        role="status"
        aria-label={t('organization.status')}
        aria-live="polite"
        aria-atomic="true"
        className={`text-sm leading-6 ${failed || latest?.status === 'FAILED' ? 'text-[var(--color-app-danger)]' : 'text-[var(--color-app-subtle)]'}`}
      >
        {[visibleNotice, statusText].filter(Boolean).join(' ')}
      </p>
      {active && latest && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {latest.totalSections > 0 && (
            <progress
              value={latest.completedSections}
              max={latest.totalSections}
              aria-label={organizationProgressText(latest, t)}
              className="h-1.5 min-w-24 flex-1 appearance-none overflow-hidden rounded-full bg-[var(--color-app-surface)] accent-[var(--color-accent-primary)] [&::-moz-progress-bar]:bg-[var(--color-accent-primary)] [&::-webkit-progress-bar]:bg-[var(--color-app-surface)] [&::-webkit-progress-value]:bg-[var(--color-accent-primary)]"
            />
          )}
          <Button
            variant="ghost"
            className="min-h-11"
            disabled={Boolean(mutation)}
            onClick={() => void update(latest)}
          >
            {t('organization.cancel')}
          </Button>
        </div>
      )}
      {error && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--color-app-danger)]">
          <p>{organizationErrorText(error, t)}</p>
          <Button
            variant="outline"
            disabled={page.loading || history.loading}
            onClick={() => {
              refresh();
              refreshHistory();
              refreshPin();
            }}
          >
            {t('organization.retry')}
          </Button>
        </div>
      )}
      {(rows.length > 0 || historyPath || targetId) && (
        <details
          open={open}
          onToggle={(event) => setOpen(event.currentTarget.open)}
          className="group min-w-0 border-t border-[var(--color-app-border)]"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-sm py-3 text-sm font-medium text-[var(--color-app-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)] [&::-webkit-details-marker]:hidden">
            {t('organization.history')}
            <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
          </summary>
          <div className="divide-y divide-[var(--color-app-border)]">
            {historyPath && !historyData && !history.error && (
              <Skeleton className="my-4 h-24 w-full rounded-lg" />
            )}
            {rows.map((row) => (
              <OrganizationRunRow key={row.id} row={row} />
            ))}
          </div>
          {(cursors.length > 1 || historyData?.nextCursor) && (
            <nav
              aria-label={t('organization.history')}
              className="flex flex-wrap justify-end gap-2 py-3"
            >
              <Button
                variant="ghost"
                className="min-h-11"
                disabled={cursors.length <= 1 || history.loading}
                onClick={() => setCursors((current) => current.slice(0, -1))}
              >
                {t('organization.newer')}
              </Button>
              <Button
                variant="outline"
                className="min-h-11"
                disabled={!historyData?.nextCursor || history.loading}
                onClick={() => {
                  if (historyData?.nextCursor)
                    setCursors((current) => [...current, historyData.nextCursor]);
                }}
              >
                {t('organization.older')}
              </Button>
            </nav>
          )}
        </details>
      )}
    </section>
  );
}

function OrganizationRunRow({ row }: { row: OrganizationRun }): React.ReactElement {
  const { t, locale } = useI18n();
  const currency = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  });
  return (
    <article
      id={`organization-${row.id}`}
      tabIndex={-1}
      className="scroll-mt-6 space-y-3 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-[var(--color-app-fg)]">
          {organizationStatusText(row, t)}
        </p>
        <Link
          to={`#organization-${row.id}`}
          aria-label={t('organization.runLink')}
          className="inline-flex min-h-11 items-center text-xs tabular-nums text-[var(--color-app-muted)] underline decoration-[var(--color-app-border-strong)] underline-offset-4 hover:text-[var(--color-app-fg)]"
        >
          <time dateTime={row.createdAt}>
            {new Date(row.createdAt).toLocaleString(locale, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </time>
        </Link>
      </div>
      {row.warnings.length > 0 && <Badge variant="warning">{t('organization.hasWarnings')}</Badge>}
      {row.startedAt && (
        <dl className="grid gap-x-5 gap-y-2 text-xs leading-5 sm:grid-cols-2">
          <div>
            <dt className="text-[var(--color-app-muted)]">
              {t(
                row.costUsd === null
                  ? 'organization.costLabel'
                  : organizationActive(row)
                    ? 'organization.costSoFar'
                    : 'organization.cost',
              )}
            </dt>
            <dd className="tabular-nums text-[var(--color-app-subtle)]">
              {row.costUsd === null ? t('organization.unknownCost') : currency.format(row.costUsd)}
            </dd>
          </div>
          {row.model && (
            <div>
              <dt className="text-[var(--color-app-muted)]">{t('organization.model')}</dt>
              <dd className="break-all text-[var(--color-app-subtle)]">{row.model}</dd>
            </div>
          )}
          <div>
            <dt className="text-[var(--color-app-muted)]">
              {t(
                row.warnings.includes('UNCONFIRMED_USAGE')
                  ? 'organization.confirmedTokens'
                  : 'organization.tokens',
              )}
            </dt>
            <dd className="tabular-nums text-[var(--color-app-subtle)]">
              {row.tokensIn.toLocaleString(locale)} / {row.tokensOut.toLocaleString(locale)}
            </dd>
          </div>
        </dl>
      )}
      {organizationWarnings(row, t).map((warning) => (
        <p key={warning} className="text-sm leading-6 text-[var(--color-app-warning-fg)]">
          {warning}
        </p>
      ))}
      {row.status === 'FAILED' && (
        <p className="text-sm leading-6 text-[var(--color-app-danger)]">
          {organizationErrorText(row.lastError, t)}
        </p>
      )}
    </article>
  );
}
