import { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCcw } from '@/components/ui/icons';
import { toast } from '@/lib/toast';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Markdown } from '../ui/markdown';
import { Spinner } from '../ui/spinner';
import { useI18n } from '../../lib/i18n';

interface NoteRevisionSummary {
  revision: number;
  title: string;
  checksum: string;
  actor: string;
  changeSummary: string | null;
  createdAt: string;
}

interface NoteRevisionDetail extends NoteRevisionSummary {
  content: string;
}

interface RestoredNote {
  title: string;
  content: string;
  revision: number;
}

interface NoteHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteId: string;
  currentRevision: number;
  dirty: boolean;
  onRestored: (note: RestoredNote) => void;
  onConflict: (conflict: { currentRevision: number; currentChecksum: string }) => void;
}

export function NoteHistoryDialog({
  open,
  onOpenChange,
  noteId,
  currentRevision,
  dirty,
  onRestored,
  onConflict,
}: NoteHistoryDialogProps): React.ReactElement {
  const { t } = useI18n();
  const [history, setHistory] = useState<NoteRevisionSummary[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<NoteRevisionDetail | null>(null);
  const [restoring, setRestoring] = useState(false);

  const inspectRevision = useCallback(
    async (targetRevision: number): Promise<void> => {
      setLoading(true);
      try {
        const res = await fetch(`/api/notes/${noteId}/revisions/${targetRevision}`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error(t('notes.historyError'));
        const body = (await res.json()) as { revision: NoteRevisionDetail };
        setSelected(body.revision);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('common.error'));
      } finally {
        setLoading(false);
      }
    },
    [noteId, t],
  );

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setSelected(null);
    void fetch(`/api/notes/${noteId}/revisions`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('notes.historyError'));
        const body = (await res.json()) as {
          revisions: NoteRevisionSummary[];
          nextBefore: number | null;
        };
        if (!active) return;
        setHistory(body.revisions);
        setNextBefore(body.nextBefore);
        const first = body.revisions[0];
        if (first) await inspectRevision(first.revision);
      })
      .catch((error: unknown) => {
        if (active) toast.error(error instanceof Error ? error.message : t('common.error'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [inspectRevision, noteId, open, t]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (nextBefore === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/notes/${noteId}/revisions?before=${nextBefore}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(t('notes.historyError'));
      const body = (await res.json()) as {
        revisions: NoteRevisionSummary[];
        nextBefore: number | null;
      };
      setHistory((current) => [
        ...current,
        ...body.revisions.filter(
          (candidate) => !current.some((item) => item.revision === candidate.revision),
        ),
      ]);
      setNextBefore(body.nextBefore);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextBefore, noteId, t]);

  const restoreRevision = useCallback(async (): Promise<void> => {
    if (!selected || dirty || restoring) return;
    setRestoring(true);
    try {
      const res = await fetch(`/api/notes/${noteId}/revisions/${selected.revision}/restore`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: currentRevision }),
      });
      if (res.status === 409) {
        const body = (await res.json()) as Partial<{
          currentRevision: number;
          currentChecksum: string;
        }>;
        onConflict({
          currentRevision: body.currentRevision ?? currentRevision + 1,
          currentChecksum: body.currentChecksum ?? '',
        });
        onOpenChange(false);
        toast.error(t('notes.conflictError'));
        return;
      }
      if (!res.ok) throw new Error(t('notes.restoreError'));
      const body = (await res.json()) as { note: RestoredNote };
      onRestored(body.note);
      onOpenChange(false);
      toast.success(t('notes.restored'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    } finally {
      setRestoring(false);
    }
  }, [
    currentRevision,
    dirty,
    noteId,
    onConflict,
    onOpenChange,
    onRestored,
    restoring,
    selected,
    t,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden">
        <DialogHeader className="border-b border-[var(--color-app-border)] px-5 py-4 pr-12">
          <DialogTitle>{t('notes.historyTitle')}</DialogTitle>
          <DialogDescription>{t('notes.historyDescription')}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-[420px] grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)]">
          <div className="max-h-[60dvh] overflow-y-auto border-b border-[var(--color-app-border)] p-2 md:border-b-0 md:border-r">
            {loading && history.length === 0 ? (
              <div className="flex min-h-48 items-center justify-center">
                <Spinner size={18} />
              </div>
            ) : (
              <div className="space-y-1">
                {history.map((item) => (
                  <button
                    key={item.revision}
                    type="button"
                    onClick={() => void inspectRevision(item.revision)}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${selected?.revision === item.revision ? 'border-violet-400/40 bg-violet-500/10' : 'border-transparent hover:bg-[var(--color-app-surface-hover)]'}`}
                  >
                    <span className="flex items-center justify-between gap-2 text-xs font-semibold">
                      <span>{t('notes.revisionLabel', { revision: item.revision })}</span>
                      {item.revision === currentRevision ? (
                        <span className="text-[10px] text-emerald-300">{t('notes.current')}</span>
                      ) : null}
                    </span>
                    <span className="mt-1 block truncate text-[11px] text-[var(--color-app-muted)]">
                      {item.changeSummary || item.actor}
                    </span>
                    <span className="mt-1 block text-[10px] text-[var(--color-app-subtle)]">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </button>
                ))}
                {nextBefore !== null ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                  >
                    {loadingMore ? <Spinner size={14} /> : t('notes.loadOlderRevisions')}
                  </Button>
                ) : null}
              </div>
            )}
          </div>
          <div className="min-h-0 p-4 sm:p-5">
            {selected ? (
              <div className="flex h-full min-h-0 flex-col gap-3">
                <div className="min-w-0">
                  <p className="truncate font-display text-lg font-semibold">{selected.title}</p>
                  <p className="mt-1 text-xs text-[var(--color-app-muted)]">
                    {selected.changeSummary || selected.actor}
                  </p>
                </div>
                <div className="max-h-[45dvh] flex-1 overflow-y-auto rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg)] p-4">
                  <div className="prose-voxen">
                    {selected.content.trim() ? (
                      <Markdown>{selected.content}</Markdown>
                    ) : (
                      <p className="italic text-[var(--color-app-muted)]">
                        {t('notes.emptyContent')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-64 items-center justify-center text-sm text-[var(--color-app-muted)]">
                {loading ? <Spinner size={18} /> : t('notes.selectRevision')}
              </div>
            )}
          </div>
        </div>
        <DialogFooter className="border-t border-[var(--color-app-border)] px-5 py-4">
          {dirty ? (
            <p className="mr-auto text-xs text-amber-300">{t('notes.saveBeforeRestore')}</p>
          ) : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
          <Button
            onClick={() => void restoreRevision()}
            disabled={!selected || selected.revision === currentRevision || dirty || restoring}
          >
            {restoring ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            {t('notes.restore')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
