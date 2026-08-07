import { useState } from 'react';
import { Check, ExternalLink, Globe, Loader2, Trash2 } from '@/components/ui/icons';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { Markdown } from '../ui/markdown';
import { Skeleton } from '../ui/skeleton';
import { formatDateTime } from '../../lib/format';
import type { Locale, TranslateFn } from '../../lib/i18n';

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
  status: TranscriptEnrichmentStatus;
  reviewState: 'SUGGESTED' | 'ACCEPTED' | 'DISMISSED';
  trigger: 'AUTO' | 'MANUAL' | 'MCP';
  title: string;
  content: string;
  citations: Array<{ url: string; title: string; excerpt: string }>;
  queries: string[];
  rationale: string | null;
  noResearchReason: string | null;
  model: string | null;
  staleReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptEnrichmentsResponse {
  enrichments: TranscriptEnrichment[];
  researchMode: 'OFF' | 'MANUAL' | 'AUTO';
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

export function AdditionalContextBlock({
  enrichments,
  researchMode,
  loading,
  locale,
  onQueue,
  onUpdate,
  onDelete,
  t,
}: {
  enrichments: TranscriptEnrichment[];
  researchMode: 'OFF' | 'MANUAL' | 'AUTO';
  loading: boolean;
  locale: Locale;
  onQueue: () => void;
  onUpdate: (id: string, body: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  t: TranslateFn;
}): React.ReactElement {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TranscriptEnrichment | null>(null);

  async function mutate(id: string, body: Record<string, unknown>): Promise<void> {
    setBusyId(id);
    try {
      await onUpdate(id, body);
      setEditingId(null);
    } finally {
      setBusyId(null);
    }
  }

  const active = enrichments.some((item) => ['PENDING', 'RUNNING', 'RETRY'].includes(item.status));
  return (
    <section className="space-y-3" aria-labelledby="additional-context-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="additional-context-title"
            className="font-display text-base font-semibold tracking-tight text-[var(--color-app-subtle)] sm:text-lg"
          >
            {t('library.additionalContext')}
          </h2>
          <p className="mt-1 text-xs text-[var(--color-app-muted)]">
            {t('library.additionalContextDescription')}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={researchMode === 'OFF' || active}
          onClick={onQueue}
        >
          {active ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Globe className="h-3.5 w-3.5" />
          )}
          {active ? t('library.additionalContextRunning') : t('library.additionalContextResearch')}
        </Button>
      </div>
      {researchMode === 'OFF' && (
        <p className="rounded-lg border border-dashed border-[var(--color-app-border)] px-3 py-2 text-xs text-[var(--color-app-muted)]">
          {t('library.additionalContextDisabled')}
        </p>
      )}
      {loading && <Skeleton className="h-24 w-full rounded-xl" />}
      {!loading && enrichments.length === 0 && researchMode !== 'OFF' && (
        <p className="rounded-xl border border-dashed border-[var(--color-app-border)] px-4 py-5 text-center text-xs text-[var(--color-app-muted)]">
          {t('library.additionalContextEmpty')}
        </p>
      )}
      {enrichments.map((item) => {
        const terminalWithContent = item.status === 'READY';
        const editing = editingId === item.id;
        const busy = busyId === item.id;
        return (
          <Card
            key={item.id}
            id={`additional-context-${item.id}`}
            elevated
            className="overflow-hidden scroll-mt-24"
          >
            <CardContent className="space-y-4 px-4 py-4 sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
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
                    {item.staleReason
                      ? t('library.additionalContextStale')
                      : t(STATUS_KEYS[item.status])}
                  </Badge>
                  <span className="text-[10px] uppercase tracking-wider text-[var(--color-app-muted)]">
                    {item.trigger} · {formatDateTime(new Date(item.createdAt), locale)}
                  </span>
                </div>
                {item.model && (
                  <span className="max-w-60 truncate font-mono text-[10px] text-[var(--color-app-muted)]">
                    {item.model}
                  </span>
                )}
              </div>

              {item.status === 'NO_RESEARCH_NEEDED' && (
                <p className="text-sm leading-relaxed text-[var(--color-app-subtle)]">
                  {item.noResearchReason || t('library.additionalContextNoResearch')}
                </p>
              )}
              {item.status === 'FAILED' && (
                <p className="text-sm text-[var(--color-app-muted)]">
                  {t('library.additionalContextFailed')}
                </p>
              )}
              {['PENDING', 'RUNNING', 'RETRY'].includes(item.status) && (
                <div className="flex items-center gap-2 text-sm text-[var(--color-app-muted)]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('library.additionalContextRunningDescription')}
                </div>
              )}

              {terminalWithContent && editing ? (
                <div className="space-y-2">
                  <input
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    maxLength={300}
                    className="h-10 w-full rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-3 text-sm"
                  />
                  <textarea
                    value={draftContent}
                    onChange={(event) => setDraftContent(event.target.value)}
                    maxLength={200_000}
                    className="min-h-48 w-full resize-y rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-3 py-2 text-sm"
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                      {t('common.cancel')}
                    </Button>
                    <Button
                      size="sm"
                      disabled={!draftTitle.trim() || !draftContent.trim() || busy}
                      onClick={() =>
                        void mutate(item.id, {
                          action: 'edit',
                          title: draftTitle,
                          content: draftContent,
                        })
                      }
                    >
                      {t('common.save')}
                    </Button>
                  </div>
                </div>
              ) : terminalWithContent ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-display text-base font-semibold text-[var(--color-app-fg)]">
                      {item.title}
                    </h3>
                    <div className="mt-2 text-sm">
                      <Markdown>{item.content}</Markdown>
                    </div>
                  </div>
                  {item.rationale && (
                    <div className="rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/50 px-3 py-2 text-xs text-[var(--color-app-muted)]">
                      <strong className="text-[var(--color-app-subtle)]">
                        {t('library.additionalContextWhy')}
                      </strong>{' '}
                      {item.rationale}
                    </div>
                  )}
                  {item.queries.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {item.queries.map((query) => (
                        <span
                          key={query}
                          className="rounded-full border border-[var(--color-app-border)] px-2 py-1 text-[10px] text-[var(--color-app-muted)]"
                        >
                          {query}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-[var(--color-app-subtle)]">
                      {t('library.additionalContextSources')}
                    </p>
                    {item.citations.map((citation) => (
                      <a
                        key={citation.url}
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-lg border border-[var(--color-app-border)] px-3 py-2 transition-colors hover:bg-[var(--color-app-surface)]"
                      >
                        <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent-primary)]">
                          {citation.title}
                          <ExternalLink className="h-3 w-3" />
                        </span>
                        <span className="mt-1 line-clamp-2 block text-[11px] leading-relaxed text-[var(--color-app-muted)]">
                          {citation.excerpt}
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--color-app-border)] pt-3">
                {['PENDING', 'RUNNING', 'RETRY'].includes(item.status) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void mutate(item.id, { action: 'cancel' })}
                  >
                    {t('common.cancel')}
                  </Button>
                )}
                {terminalWithContent && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setEditingId(item.id);
                      setDraftTitle(item.title);
                      setDraftContent(item.content);
                    }}
                  >
                    {t('notes.edit')}
                  </Button>
                )}
                {terminalWithContent && item.reviewState !== 'ACCEPTED' && (
                  <Button
                    size="sm"
                    disabled={busy || Boolean(item.staleReason)}
                    onClick={() => void mutate(item.id, { action: 'accept' })}
                  >
                    <Check className="h-3.5 w-3.5" />
                    {t('library.additionalContextAccept')}
                  </Button>
                )}
                {terminalWithContent && item.reviewState !== 'DISMISSED' && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void mutate(item.id, { action: 'dismiss' })}
                  >
                    {t('library.additionalContextDismiss')}
                  </Button>
                )}
                {!['PENDING', 'RUNNING', 'RETRY'].includes(item.status) && (
                  <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(item)}>
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('common.delete')}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('library.additionalContextDeleteTitle')}
        description={t('library.additionalContextDeleteDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setBusyId(deleteTarget.id);
          try {
            await onDelete(deleteTarget.id);
            setDeleteTarget(null);
          } finally {
            setBusyId(null);
          }
        }}
        loading={deleteTarget !== null && busyId === deleteTarget.id}
        variant="destructive"
      />
    </section>
  );
}
