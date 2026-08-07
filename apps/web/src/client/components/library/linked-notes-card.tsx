import { Link } from 'react-router-dom';
import { Loader2, NotebookPen } from '@/components/ui/icons';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import type { TranscriptAnchorSelection } from '../ui/transcript-viewer';
import { formatDateTime } from '../../lib/format';
import type { Locale, TranslateFn } from '../../lib/i18n';

export interface LinkedNoteAnchor {
  id: string;
  startLine: number | null;
  endLine: number | null;
  startSec: number | null;
  endSec: number | null;
  selectedQuote: string;
  sourceVersion: number;
  sourceChecksum: string | null;
  status: 'VALID' | 'STALE' | 'UNAVAILABLE';
  staleReason: string | null;
}

export interface LinkedNote {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  transcriptSources: Array<{ anchors: LinkedNoteAnchor[] }>;
}

export type LinkedNoteAnchorDraft = Partial<
  Pick<TranscriptAnchorSelection, 'startLine' | 'endLine' | 'startSec' | 'endSec'>
> & { selectedQuote: string };

export interface LinkedNotesResponse {
  notes: LinkedNote[];
}

export function LinkedNotesCard({
  notes,
  loading,
  title,
  content,
  anchor,
  creating,
  locale,
  onTitleChange,
  onContentChange,
  onAnchorChange,
  onCreate,
  t,
}: {
  notes: LinkedNote[];
  loading: boolean;
  title: string;
  content: string;
  anchor: LinkedNoteAnchorDraft | null;
  creating: boolean;
  locale: Locale;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onAnchorChange: (value: LinkedNoteAnchorDraft | null) => void;
  onCreate: () => void;
  t: TranslateFn;
}): React.ReactElement {
  const anchorReady =
    anchor === null ||
    (anchor.selectedQuote.trim().length > 0 &&
      ((anchor.startLine !== undefined && anchor.endLine !== undefined) ||
        (anchor.startSec !== undefined && anchor.endSec !== undefined)));
  return (
    <Card id="linked-notes-card" elevated>
      <CardContent className="pt-5 pb-5 space-y-4">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-app-muted)]">
          <NotebookPen className="h-3.5 w-3.5 text-emerald-400" />
          {t('library.linkedNotes')}
        </div>

        <div className="space-y-2">
          <input
            type="text"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder={t('library.linkedNoteTitle')}
            className="h-9 w-full rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-3 text-xs text-[var(--color-app-fg)] placeholder:text-[var(--color-app-muted)] focus:border-violet-400/60 focus:outline-none focus:ring-2 focus:ring-violet-500/15"
            disabled={creating}
            maxLength={200}
          />
          <textarea
            value={content}
            onChange={(event) => onContentChange(event.target.value)}
            placeholder={t('library.linkedNoteContent')}
            className="min-h-24 w-full resize-y rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-3 py-2 text-xs leading-relaxed text-[var(--color-app-fg)] placeholder:text-[var(--color-app-muted)] focus:border-violet-400/60 focus:outline-none focus:ring-2 focus:ring-violet-500/15"
            disabled={creating}
            maxLength={200_000}
          />
          {anchor ? (
            <div className="space-y-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-emerald-300">
                  {t('library.annotationAnchor')}
                </span>
                <button
                  type="button"
                  onClick={() => onAnchorChange(null)}
                  className="text-[10px] text-[var(--color-app-muted)] hover:text-[var(--color-app-fg)]"
                >
                  {t('common.delete')}
                </button>
              </div>
              <textarea
                value={anchor.selectedQuote}
                onChange={(event) =>
                  onAnchorChange({ ...anchor, selectedQuote: event.target.value })
                }
                aria-label={t('library.annotationQuote')}
                className="min-h-20 w-full resize-y rounded-md border border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-2.5 py-2 text-xs leading-relaxed"
                maxLength={20_000}
              />
              <div className="grid grid-cols-2 gap-2">
                <AnchorNumberInput
                  label={t('library.annotationStartLine')}
                  value={anchor.startLine}
                  min={1}
                  onChange={(value) => onAnchorChange({ ...anchor, startLine: value })}
                />
                <AnchorNumberInput
                  label={t('library.annotationEndLine')}
                  value={anchor.endLine}
                  min={1}
                  onChange={(value) => onAnchorChange({ ...anchor, endLine: value })}
                />
                <AnchorNumberInput
                  label={t('library.annotationStartSec')}
                  value={anchor.startSec}
                  min={0}
                  onChange={(value) => onAnchorChange({ ...anchor, startSec: value })}
                />
                <AnchorNumberInput
                  label={t('library.annotationEndSec')}
                  value={anchor.endSec}
                  min={0}
                  onChange={(value) => onAnchorChange({ ...anchor, endSec: value })}
                />
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onAnchorChange({ selectedQuote: '', startLine: 1, endLine: 1 })}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--color-app-border)] px-3 py-2 text-[11px] text-[var(--color-app-muted)] transition-colors hover:border-emerald-500/30 hover:text-emerald-300"
            >
              <NotebookPen className="h-3.5 w-3.5" />
              {t('library.annotationManual')}
            </button>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full"
            disabled={creating || title.trim().length === 0 || !anchorReady}
            onClick={onCreate}
          >
            {creating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('library.linkedNoteCreating')}
              </>
            ) : (
              t('library.linkedNoteCreate')
            )}
          </Button>
        </div>

        <div className="space-y-2">
          {loading && (
            <>
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </>
          )}
          {!loading && notes.length === 0 && (
            <p className="rounded-lg border border-dashed border-[var(--color-app-border)] px-3 py-4 text-center text-xs text-[var(--color-app-muted)]">
              {t('library.linkedNotesEmpty')}
            </p>
          )}
          {!loading &&
            notes.map((note) => {
              const preview =
                note.content.trim().replace(/\s+/g, ' ').slice(0, 140) || t('notes.emptyContent');
              return (
                <div
                  key={note.id}
                  className="rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/45 px-3 py-2.5"
                >
                  <p className="truncate text-sm font-medium text-[var(--color-app-fg)]">
                    {note.title}
                  </p>
                  <p className="mt-1 line-clamp-2 break-words text-xs leading-relaxed text-[var(--color-app-muted)]">
                    {preview}
                  </p>
                  {note.transcriptSources
                    .flatMap((source) => source.anchors)
                    .map((noteAnchor) => (
                      <div
                        key={noteAnchor.id}
                        className="mt-2 rounded-md border border-[var(--color-app-border)] bg-[var(--color-app-bg)]/50 px-2.5 py-2"
                      >
                        <p className="line-clamp-2 text-[11px] italic text-[var(--color-app-subtle)]">
                          “{noteAnchor.selectedQuote}”
                        </p>
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <Badge
                            variant={noteAnchor.status === 'VALID' ? 'success' : 'muted'}
                            className="text-[9px]"
                          >
                            {t(
                              noteAnchor.status === 'VALID'
                                ? 'library.annotationValid'
                                : 'library.annotationStale',
                            )}
                          </Badge>
                          <Link
                            to={
                              noteAnchor.startLine
                                ? `#l=${noteAnchor.startLine}-${noteAnchor.endLine ?? noteAnchor.startLine}`
                                : `#t=${noteAnchor.startSec ?? 0}-${noteAnchor.endSec ?? noteAnchor.startSec ?? 0}`
                            }
                            className="text-[10px] text-[var(--color-accent-primary)] hover:underline"
                          >
                            {t('library.annotationOpen')}
                          </Link>
                        </div>
                      </div>
                    ))}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="truncate text-[10px] uppercase tracking-wider text-[var(--color-app-muted)]/80">
                      {formatDateTime(new Date(note.updatedAt), locale)}
                    </span>
                    <Button asChild variant="ghost" size="sm" className="h-7 px-2">
                      <Link to={`/notas/${note.id}`}>{t('library.openNote')}</Link>
                    </Button>
                  </div>
                </div>
              );
            })}
        </div>
      </CardContent>
    </Card>
  );
}

function AnchorNumberInput({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number | undefined;
  min: number;
  onChange: (value: number | undefined) => void;
}): React.ReactElement {
  return (
    <label className="space-y-1 text-[10px] text-[var(--color-app-muted)]">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        value={value ?? ''}
        onChange={(event) => {
          const next = event.target.value === '' ? undefined : Number(event.target.value);
          onChange(Number.isFinite(next) ? next : undefined);
        }}
        className="h-8 w-full rounded-md border border-[var(--color-app-border)] bg-[var(--color-app-surface)] px-2 text-xs text-[var(--color-app-fg)]"
      />
    </label>
  );
}
