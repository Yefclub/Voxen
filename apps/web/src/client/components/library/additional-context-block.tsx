import { useState } from 'react';
import { Check, Globe, Loader2, Trash2 } from '@/components/ui/icons';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { Markdown } from '../ui/markdown';
import { Skeleton } from '../ui/skeleton';
import { formatDateTime } from '../../lib/format';
import type { Locale, TranslateFn } from '../../lib/i18n';
import { ResearchEditor } from './research-editor';
import { ResearchEvidence } from './research-evidence';

export type TranscriptEnrichmentStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'NO_RESEARCH_NEEDED'
  | 'READY'
  | 'RETRY'
  | 'FAILED'
  | 'CANCELLED';

export interface TranscriptEnrichment {
  id: string;
  revision: number;
  checksum: string;
  projection: {
    state: 'PENDING' | 'SYNCED';
    revision: number;
    appliedRevision: number;
    errorCode: string | null;
  };
  status: TranscriptEnrichmentStatus;
  reviewState: 'SUGGESTED' | 'ACCEPTED' | 'DISMISSED';
  trigger: 'AUTO' | 'MANUAL' | 'MCP';
  title: string;
  content: string;
  citations: Array<{ url: string; title: string; excerpt: string; retrievedAt?: string }>;
  queries: string[];
  rationale: string | null;
  noResearchReason: string | null;
  model: string | null;
  staleReason: string | null;
  lastError: string | null;
  deletionPending?: boolean;
  costUsd?: number | null;
  tokensIn?: number;
  tokensOut?: number;
  searchCallCount?: number;
  fetchCallCount?: number;
  warnings?: string[];
  editedAt?: string | null;
  generatedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptEnrichmentsResponse {
  enrichments: TranscriptEnrichment[];
  researchMode: 'OFF' | 'MANUAL' | 'AUTO';
  nextCursor: string | null;
}

export function safeExternalCitationUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

const STATUS_KEYS: Record<TranscriptEnrichmentStatus, Parameters<TranslateFn>[0]> = {
  PENDING: 'library.additionalContextStatus.pending',
  RUNNING: 'library.additionalContextStatus.running',
  NO_RESEARCH_NEEDED: 'library.additionalContextStatus.no_research_needed',
  READY: 'library.additionalContextStatus.ready',
  RETRY: 'library.additionalContextStatus.retry',
  FAILED: 'library.additionalContextStatus.failed',
  CANCELLED: 'library.additionalContextStatus.cancelled',
};

export function enrichmentStatusText(item: TranscriptEnrichment, t: TranslateFn): string {
  const ready = item.status === 'READY';
  return item.deletionPending
    ? t('research.deleting')
    : item.staleReason
      ? t('library.additionalContextStale')
      : ready && item.reviewState === 'ACCEPTED'
        ? t('research.accepted')
        : ready && item.reviewState === 'DISMISSED'
          ? t('research.dismissed')
          : t(STATUS_KEYS[item.status]);
}

export function AdditionalContextBlock({
  enrichments,
  researchMode,
  loading,
  queueDisabled = false,
  archived = false,
  locale,
  onQueue,
  onUpdate,
  onDelete,
  t,
}: {
  enrichments: TranscriptEnrichment[];
  researchMode: 'OFF' | 'MANUAL' | 'AUTO';
  loading: boolean;
  queueDisabled?: boolean;
  archived?: boolean;
  locale: Locale;
  onQueue: () => void;
  onUpdate: (id: string, body: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string, body: Record<string, unknown>) => Promise<void>;
  t: TranslateFn;
}): React.ReactElement {
  const [editing, setEditing] = useState<TranscriptEnrichment | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [editError, setEditError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TranscriptEnrichment | null>(null);
  async function mutate(item: TranscriptEnrichment, body: Record<string, unknown>): Promise<void> {
    setBusyId(item.id);
    setEditError('');
    try {
      await onUpdate(item.id, {
        ...body,
        expectedRevision: item.revision,
        expectedChecksum: item.checksum,
      });
      if (body.action === 'edit') setEditing(null);
    } catch (error) {
      // The parent reports safe public errors; retain the observed revision and draft.
      if (body.action === 'edit')
        setEditError(error instanceof Error ? error.message : t('research.error.generic'));
    } finally {
      setBusyId(null);
    }
  }
  const active = enrichments.some((item) => ['PENDING', 'RUNNING', 'RETRY'].includes(item.status));
  return (
    <section className="space-y-5" aria-labelledby="additional-context-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-56">
          <h2
            id="additional-context-title"
            className="font-display text-xl font-semibold tracking-tight"
          >
            {t('library.additionalContext')}
          </h2>
          <p className="mt-2 max-w-[65ch] text-sm leading-6 text-[var(--color-app-muted)]">
            {t('library.additionalContextDescription')}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={loading || queueDisabled || archived || researchMode === 'OFF' || active}
          onClick={onQueue}
        >
          {active ? (
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          ) : (
            <Globe className="h-4 w-4" />
          )}
          {active ? t('library.additionalContextRunning') : t('library.additionalContextResearch')}
        </Button>
      </div>
      {researchMode === 'OFF' && (
        <p className="text-sm leading-6 text-[var(--color-app-muted)]">
          {t('library.additionalContextDisabled')}
        </p>
      )}
      {archived && (
        <p className="text-sm text-[var(--color-app-muted)]">{t('research.archived')}</p>
      )}
      {loading && <Skeleton className="h-24 w-full" />}
      {!loading && enrichments.length === 0 && researchMode !== 'OFF' && (
        <p className="py-4 text-sm text-[var(--color-app-muted)]">
          {t('library.additionalContextEmpty')}
        </p>
      )}
      {enrichments.map((item) => {
        const ready = item.status === 'READY';
        const busy = busyId === item.id;
        const pending = ['PENDING', 'RUNNING', 'RETRY'].includes(item.status);
        const unavailable = busy || Boolean(item.deletionPending);
        const status = enrichmentStatusText(item, t);
        return (
          <article
            key={item.id}
            id={`additional-context-${item.id}`}
            tabIndex={-1}
            className="scroll-mt-8 space-y-5 border-t border-[var(--color-app-border)] pt-6"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Badge
                variant={
                  item.staleReason
                    ? 'warning'
                    : item.reviewState === 'ACCEPTED'
                      ? 'success'
                      : item.status === 'FAILED'
                        ? 'danger'
                        : 'muted'
                }
              >
                {status}
              </Badge>
              {item.editedAt && (
                <span className="text-xs text-[var(--color-app-subtle)]">
                  {t('research.curated')}
                </span>
              )}
              <time dateTime={item.createdAt} className="text-xs text-[var(--color-app-muted)]">
                {formatDateTime(new Date(item.createdAt), locale)}
              </time>
            </div>
            {item.projection.state === 'PENDING' && (
              <p className="text-xs text-[var(--color-app-muted)]">
                {t(
                  item.projection.errorCode
                    ? 'library.additionalContextProjectionRetry'
                    : 'library.additionalContextProjectionPending',
                )}
              </p>
            )}
            {item.staleReason && (
              <p className="text-sm text-[var(--color-app-muted)]">{t('research.error.stale')}</p>
            )}
            {item.status === 'NO_RESEARCH_NEEDED' && (
              <p className="text-sm leading-6 text-[var(--color-app-subtle)]">
                {item.noResearchReason || t('library.additionalContextNoResearch')}
              </p>
            )}
            {item.status === 'FAILED' && (
              <p className="text-sm leading-6 text-[var(--color-app-muted)]">
                {t(
                  item.lastError === 'OPENROUTER_CREDITS_EXHAUSTED'
                    ? 'library.additionalContextCreditsExhausted'
                    : 'library.additionalContextFailed',
                )}
              </p>
            )}
            {pending && (
              <p className="flex items-start gap-2 text-sm leading-6 text-[var(--color-app-muted)]">
                <Loader2 className="mt-1 h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" />
                {t('library.additionalContextRunningDescription')}
              </p>
            )}
            {ready && (
              <div className="max-w-[75ch] space-y-3">
                <h3 className="font-display text-lg font-semibold">{item.title}</h3>
                <Markdown headingOffset={2} className="text-base leading-7">
                  {item.content}
                </Markdown>
              </div>
            )}
            {(ready || item.model || item.costUsd != null) && (
              <ResearchEvidence item={item} locale={locale} t={t} />
            )}
            {!item.deletionPending && (
              <div className="flex flex-wrap items-center gap-2">
                {pending && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void mutate(item, { action: 'cancel' })}
                  >
                    {t('common.cancel')}
                  </Button>
                )}
                {ready && (
                  <>
                    {item.reviewState !== 'ACCEPTED' && (
                      <Button
                        disabled={unavailable || Boolean(item.staleReason)}
                        onClick={() => void mutate(item, { action: 'accept' })}
                      >
                        <Check className="h-4 w-4" />
                        {t('library.additionalContextAccept')}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      disabled={unavailable || editing !== null}
                      onClick={() => {
                        setEditing(item);
                        setDraftTitle(item.title);
                        setDraftContent(item.content);
                        setEditError('');
                      }}
                    >
                      {t('notes.edit')}
                    </Button>
                    {item.reviewState !== 'DISMISSED' && (
                      <Button
                        variant="ghost"
                        disabled={unavailable}
                        onClick={() => void mutate(item, { action: 'dismiss' })}
                      >
                        {t('library.additionalContextDismiss')}
                      </Button>
                    )}
                  </>
                )}
                {!pending && (
                  <Button
                    variant="ghost"
                    disabled={unavailable}
                    onClick={() => setDeleteTarget(item)}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('common.delete')}
                  </Button>
                )}
              </div>
            )}
          </article>
        );
      })}
      <ResearchEditor
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={draftTitle}
        content={draftContent}
        setTitle={setDraftTitle}
        setContent={setDraftContent}
        busy={editing !== null && busyId === editing.id}
        error={editError}
        onSave={() => {
          if (editing)
            void mutate(editing, { action: 'edit', title: draftTitle, content: draftContent });
        }}
        t={t}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t('library.additionalContextDeleteTitle')}
        description={t('library.additionalContextDeleteDescription')}
        confirmLabel={t('common.delete')}
        variant="destructive"
        loading={deleteTarget !== null && busyId === deleteTarget.id}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setBusyId(deleteTarget.id);
          try {
            await onDelete(deleteTarget.id, {
              expectedRevision: deleteTarget.revision,
              expectedChecksum: deleteTarget.checksum,
            });
          } catch {
            /* The parent reports the failed deletion without hiding the source. */
          } finally {
            setBusyId(null);
          }
        }}
      />
    </section>
  );
}
