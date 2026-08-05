import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, ExternalLink, RefreshCw, RotateCw, Sparkles } from '@/components/ui/icons';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';
import { Badge } from './ui/badge';
import { useI18n } from '../lib/i18n';
import type { VersionMonitorState } from '../lib/use-version-monitor';
import { useChatShell } from '../lib/chat-shell-state';
import { releaseTypeI18nKey } from '../../shared/release-type';
import {
  resolveReleaseCopy,
  resolveReleaseView,
  resolveUpdateModalEffect,
  shouldPresentUpdateModal,
  shouldSilentApplyVersion,
  type ReleaseLoadState,
  type UpdateModalIntent,
} from '../lib/update-modal-core';

interface PromotedReleaseNote {
  type?: string;
  title?: string;
  body?: string;
  summary?: string;
  pr?: number | null;
  prUrl?: string;
}

interface ReleaseNote {
  version: string;
  channel?: string;
  type?: string;
  title?: string;
  body?: string;
  summary?: string;
  date?: string;
  pr?: number | null;
  prUrl?: string;
  promoted?: PromotedReleaseNote[];
}

interface ReleasesResponse {
  releases: ReleaseNote[];
}

export function UpdateModal({
  monitor,
}: {
  monitor: VersionMonitorState;
}): React.ReactElement | null {
  const { locale, t } = useI18n();
  const { update, apply, snooze } = monitor;
  const { streaming } = useChatShell();
  const location = useLocation();
  const [release, setRelease] = useState<ReleaseNote | null>(null);
  const [loadState, setLoadState] = useState<ReleaseLoadState>('loading');
  const [retry, setRetry] = useState(0);
  const [applying, setApplying] = useState(false);
  const silentAppliedBuildRef = useRef<string | null>(null);

  const releaseUrl = useMemo(() => {
    if (!update?.toVersion) return null;
    const params = new URLSearchParams({
      version: update.toVersion,
      limit: '1',
      locale,
    });
    return `/api/releases?${params.toString()}`;
  }, [locale, update?.toVersion]);

  // Silent apply: when an update is known and chat is not streaming, apply
  // without the modal. Streaming keeps the update pending until it ends.
  useEffect(() => {
    if (
      !shouldSilentApplyVersion({
        hasUpdate: update !== null,
        streaming,
      })
    ) {
      return;
    }
    const buildKey = update?.serverBuild ?? update?.toVersion ?? 'pending';
    if (silentAppliedBuildRef.current === buildKey) return;
    silentAppliedBuildRef.current = buildKey;
    setApplying(true);
    apply();
  }, [update, streaming, apply]);

  useEffect(() => {
    if (!update) {
      setRelease(null);
      setApplying(false);
      setLoadState('loading');
      return;
    }
    if (!releaseUrl) {
      setRelease(null);
      setLoadState('ready');
      return;
    }

    const controller = new AbortController();
    setLoadState('loading');
    setRelease(null);
    void fetch(releaseUrl, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as ReleasesResponse;
      })
      .then((data) => {
        setRelease(Array.isArray(data.releases) ? (data.releases[0] ?? null) : null);
        setLoadState('ready');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setRelease(null);
        setLoadState('error');
      });

    return () => controller.abort();
  }, [releaseUrl, retry, update]);

  if (
    !shouldPresentUpdateModal({
      hasUpdate: update !== null,
      streaming,
      pathname: location.pathname,
    })
  ) {
    return null;
  }
  if (!update) return null;

  const handleIntent = (intent: UpdateModalIntent): boolean => {
    const effect = resolveUpdateModalEffect(intent, { applying, streaming });
    if (effect === 'none') return false;
    if (effect === 'apply') {
      setApplying(true);
      apply();
    } else if (effect === 'snooze') {
      snooze();
    }
    return true;
  };
  const releaseView = resolveReleaseView(loadState, release !== null);
  const applyDisabled = resolveUpdateModalEffect('apply', { applying, streaming }) !== 'apply';

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) handleIntent('dismiss');
      }}
    >
      <DialogContent className="h-[min(calc(100dvh-1rem),56rem)] max-h-[min(calc(100dvh-1rem),56rem)] w-[calc(100vw-1rem)] max-w-5xl gap-0 overflow-hidden p-0 sm:w-[min(100vw-3rem,64rem)]">
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
          <header className="flex min-h-0 items-start gap-4 border-b border-[var(--color-app-border)] bg-gradient-to-br from-emerald-500/[0.12] via-transparent to-violet-500/[0.08] p-5 sm:p-7">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
              <Sparkles className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1 pr-7">
              <DialogTitle className="font-display text-xl font-semibold tracking-[-0.025em] text-[var(--color-app-fg)] sm:text-2xl">
                {t('shell.updateAvailable')}
              </DialogTitle>
              <DialogDescription className="mt-1 text-[13px] leading-relaxed text-[var(--color-app-muted)]">
                {streaming ? t('shell.updateBlockedStreaming') : t('shell.updateModalSubtitle')}
              </DialogDescription>
              {update.toVersion && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                  {update.fromVersion && (
                    <>
                      <span className="text-[var(--color-app-muted)]">v{update.fromVersion}</span>
                      <span aria-hidden className="text-[var(--color-app-muted)]">
                        →
                      </span>
                    </>
                  )}
                  <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/20">
                    v{update.toVersion}
                  </span>
                </div>
              )}
            </div>
          </header>

          <div
            data-update-scroll-region
            tabIndex={0}
            aria-label={t('shell.updateScrollLabel')}
            aria-busy={loadState === 'loading'}
            className="min-h-0 overflow-y-scroll overflow-x-hidden overscroll-contain px-5 py-5 outline-none [scrollbar-gutter:stable] [touch-action:pan-y] focus-visible:shadow-[inset_0_2px_0_var(--color-accent-primary)] sm:px-7 sm:py-6"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-app-muted)]">
                {t('shell.updateWhatsNew')}
              </h3>
              <Link
                to="/novidades"
                onClick={(event) => {
                  if (!handleIntent('open-changelog')) event.preventDefault();
                }}
                aria-disabled={applying}
                className="shrink-0 text-xs font-medium text-violet-300 hover:text-violet-200 hover:underline aria-disabled:pointer-events-none aria-disabled:opacity-50"
              >
                {t('shell.versionOpenChangelog')}
              </Link>
            </div>

            {releaseView === 'loading' ? (
              <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-[var(--color-app-muted)]">
                <Spinner size={20} />
                {t('common.loading')}
              </div>
            ) : releaseView === 'error' ? (
              <div
                role="alert"
                className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-5 py-8 text-center"
              >
                <AlertTriangle className="h-5 w-5 text-amber-300" />
                <div>
                  <p className="text-sm font-medium text-[var(--color-app-fg)]">
                    {t('shell.updateNotesErrorTitle')}
                  </p>
                  <p className="mt-1 max-w-md text-xs leading-relaxed text-[var(--color-app-muted)]">
                    {t('shell.updateNotesErrorDescription')}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setRetry((value) => value + 1)}>
                  <RotateCw className="h-3.5 w-3.5" />
                  {t('common.fetchErrorRetry')}
                </Button>
              </div>
            ) : releaseView === 'release' && release ? (
              <ReleaseDetails release={release} t={t} />
            ) : (
              <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--color-app-border)] px-5 py-8 text-center">
                <p className="text-sm font-medium text-[var(--color-app-fg)]">
                  {t('shell.updateNotesEmptyTitle')}
                </p>
                <p className="mt-1 max-w-md text-xs leading-relaxed text-[var(--color-app-muted)]">
                  {t('shell.updateNotesEmpty')}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  {t('common.fetchErrorRetry')}
                </Button>
              </div>
            )}
          </div>

          <footer className="flex min-h-0 flex-col-reverse gap-2 border-t border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <p className="text-[11px] text-[var(--color-app-muted)]">
              {t('shell.updateSnoozeHint')}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleIntent('defer')}
                disabled={applying}
              >
                {t('shell.updateLater')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleIntent('apply')}
                disabled={applyDisabled}
              >
                {applying ? <Spinner size={16} /> : <RefreshCw className="h-4 w-4" />}
                {t('shell.updateAction')}
              </Button>
            </div>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReleaseDetails({
  release,
  t,
}: {
  release: ReleaseNote;
  t: ReturnType<typeof useI18n>['t'];
}): React.ReactElement {
  const promoted = release.promoted ?? [];
  const releaseCopy = resolveReleaseCopy(release);
  const typeLabel = (type: string): string => {
    const key = releaseTypeI18nKey(type);
    return key ? t(key) : type;
  };

  return (
    <article className="space-y-5">
      <div className="rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/45 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] text-[var(--color-app-muted)]">
            v{release.version}
          </span>
          {release.type && (
            <Badge variant="outline" className="text-[9px] uppercase">
              {typeLabel(release.type)}
            </Badge>
          )}
          {release.channel && (
            <Badge
              variant={release.channel === 'prod' ? 'success' : 'muted'}
              className="text-[9px]"
            >
              {release.channel === 'prod'
                ? t('novidades.channel.prod')
                : t('novidades.channel.dev')}
            </Badge>
          )}
        </div>

        <h4 className="mt-3 text-base font-semibold tracking-tight text-[var(--color-app-fg)] sm:text-lg">
          {releaseCopy.heading || t('shell.updateWhatsNew')}
        </h4>
        {releaseCopy.details.length > 0 && (
          <div className="mt-2 space-y-2">
            {releaseCopy.details.map((detail) => (
              <p
                key={detail}
                className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[var(--color-app-muted)]"
              >
                {detail}
              </p>
            ))}
          </div>
        )}
        {release.prUrl && (
          <a
            href={release.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-violet-300 hover:text-violet-200 hover:underline"
          >
            PR #{release.pr}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {promoted.length > 0 && (
        <section aria-labelledby="release-promoted-title">
          <h4
            id="release-promoted-title"
            className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-app-muted)]"
          >
            {t('shell.updatePromoted', { count: promoted.length })}
          </h4>
          <ul className="space-y-2.5">
            {promoted.map((item, index) => {
              const itemCopy = resolveReleaseCopy(item);
              return (
                <li
                  key={`${item.pr ?? index}-${item.title ?? ''}`}
                  className="release promoted rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-bg)]/55 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {item.type && (
                      <Badge variant="outline" className="text-[9px] uppercase">
                        {typeLabel(item.type)}
                      </Badge>
                    )}
                    {itemCopy.heading && (
                      <p className="text-sm font-medium text-[var(--color-app-subtle)]">
                        {itemCopy.heading}
                      </p>
                    )}
                  </div>
                  {itemCopy.details.length > 0 && (
                    <div className="mt-1.5 space-y-1.5">
                      {itemCopy.details.map((detail) => (
                        <p
                          key={detail}
                          className="whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--color-app-muted)]"
                        >
                          {detail}
                        </p>
                      ))}
                    </div>
                  )}
                  {item.prUrl && (
                    <a
                      href={item.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-violet-300 hover:underline"
                    >
                      #{item.pr}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </article>
  );
}
