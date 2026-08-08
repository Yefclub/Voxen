import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ExternalLink, FileText, LoaderCircle, X } from '@/components/ui/icons';
import type { ChatCitation } from '../../../shared/chat-citations';
import { countCitationSources } from '../../lib/chat-citation-summary';
import { citationCanvasKey, citationCanvasState } from '../../lib/chat-reference-canvas';
import { useFetch } from '../../lib/hooks';
import { useI18n, type TranslateFn } from '../../lib/i18n';
import { stripMarkdownFrontmatter } from '../../lib/transcript-render';
import { cn } from '../../lib/utils';
import { Markdown } from '../ui/markdown';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../ui/sheet';

type ReferenceContentResponse = {
  transcript: { id: string; title: string };
  markdown: string;
};

function citationLocation(citation: ChatCitation, t: TranslateFn): string | null {
  if (citation.fromSec !== null) {
    const minutes = Math.floor(citation.fromSec / 60);
    const seconds = citation.fromSec % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  if (citation.fromLine !== null) {
    return citation.toLine && citation.toLine !== citation.fromLine
      ? t('chat.citationLines', { from: citation.fromLine, to: citation.toLine })
      : t('chat.citationLine', { line: citation.fromLine });
  }
  return null;
}

export function CitationSourcesButton({
  citations,
  onOpen,
}: {
  citations: ChatCitation[];
  onOpen: () => void;
}): React.ReactElement | null {
  const { t } = useI18n();
  if (citations.length === 0) return null;
  const sourceCount = countCitationSources(citations);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-[var(--color-app-muted)] transition-opacity hover:bg-[var(--color-app-surface)] hover:text-[var(--color-app-fg)] opacity-70 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
      aria-label={t(sourceCount === 1 ? 'chat.sourcesOne' : 'chat.sourcesMany', {
        count: sourceCount,
      })}
      title={t('chat.sources')}
    >
      <FileText className="h-3.5 w-3.5" />
      <span>{sourceCount}</span>
    </button>
  );
}

function CitationSourceList({
  citations,
  onSelect,
}: {
  citations: ChatCitation[];
  onSelect: (citation: ChatCitation) => void;
}): React.ReactElement {
  const { t } = useI18n();
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
      {citations.map((citation, index) => {
        const location = citationLocation(citation, t);
        const verified = citation.verified && citation.kind === 'EVIDENCE' && !citation.stale;
        return (
          <button
            type="button"
            key={`${citation.sourceId}-${index}`}
            onClick={() => onSelect(citation)}
            className={cn(
              'block w-full rounded-xl border p-3.5 text-left transition-colors hover:bg-[var(--color-app-surface)]',
              verified ? 'border-emerald-500/30' : 'border-amber-500/35',
            )}
          >
            <div className="flex items-center gap-2 text-xs">
              <FileText
                className={cn('h-3.5 w-3.5', verified ? 'text-emerald-400' : 'text-amber-300')}
              />
              <span className="min-w-0 flex-1 truncate font-medium text-[var(--color-app-fg)]">
                {citation.title}
              </span>
              <span className={verified ? 'text-emerald-400' : 'text-amber-300'}>
                {citation.stale
                  ? t('chat.citationStale')
                  : verified
                    ? t('chat.citationVerified')
                    : t('chat.citationUnverified')}
              </span>
            </div>
            {location && (
              <p className="mt-2 text-[11px] text-[var(--color-app-muted)]">{location}</p>
            )}
            <blockquote className="mt-2 text-sm leading-relaxed text-[var(--color-app-subtle)]">
              “{citation.quote}”
            </blockquote>
          </button>
        );
      })}
    </div>
  );
}

function CitationCanvas({
  citation,
  onBack,
  onClose,
  mobile = false,
}: {
  citation: ChatCitation;
  onBack: () => void;
  onClose: () => void;
  mobile?: boolean;
}): React.ReactElement {
  const { t } = useI18n();
  const location = citationLocation(citation, t);
  const state = citationCanvasState(citation);
  const verified = state === 'verified';
  const stateLabel =
    state === 'stale'
      ? t('chat.citationStale')
      : verified
        ? t('chat.citationVerified')
        : t('chat.citationUnverified');
  const { data, loading, error } = useFetch<ReferenceContentResponse>(
    `/api/transcripts/${encodeURIComponent(citation.sourceId)}`,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className={cn('flex shrink-0 items-start gap-2 px-5 pb-4 pt-5', mobile && 'pr-12')}>
        <button
          type="button"
          onClick={onBack}
          className="mt-0.5 rounded-md p-1 text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)]"
          aria-label={t('chat.sourceBack')}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--color-app-muted)]">
            {t('chat.sourceContent')}
          </p>
          {mobile ? (
            <SheetTitle className="mt-1 line-clamp-2 font-display text-base font-semibold text-[var(--color-app-fg)]">
              {citation.title}
            </SheetTitle>
          ) : (
            <h2 className="mt-1 line-clamp-2 font-display text-base font-semibold text-[var(--color-app-fg)]">
              {citation.title}
            </h2>
          )}
          {mobile ? (
            <SheetDescription
              className={cn('mt-1.5 text-xs', verified ? 'text-emerald-400' : 'text-amber-300')}
            >
              {[stateLabel, location].filter(Boolean).join(' · ')}
            </SheetDescription>
          ) : (
            <p className={cn('mt-1.5 text-xs', verified ? 'text-emerald-400' : 'text-amber-300')}>
              {[stateLabel, location].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <a
          href={citation.href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'mt-0.5 rounded-md p-1 text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)]',
            mobile && 'mr-1',
          )}
          aria-label={t('chat.sourceOpenFull')}
          title={t('chat.sourceOpenFull')}
        >
          <ExternalLink className="h-4 w-4" />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="mt-0.5 hidden rounded-md p-1 text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)] md:block"
          aria-label={t('common.close')}
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <blockquote
          className={cn(
            'rounded-xl border p-3 text-sm leading-relaxed text-[var(--color-app-subtle)]',
            verified
              ? 'border-emerald-500/25 bg-emerald-500/5'
              : 'border-amber-500/30 bg-amber-500/5',
          )}
        >
          “{citation.quote}”
        </blockquote>
        {loading && !data && (
          <div className="flex items-center gap-2 py-8 text-sm text-[var(--color-app-muted)]">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {t('chat.sourceLoading')}
          </div>
        )}
        {error && !data && (
          <p className="py-8 text-sm text-[var(--color-accent-amber)]">
            {t('chat.sourceLoadError')}
          </p>
        )}
        {data && (
          <Markdown className="mt-5 text-sm">{stripMarkdownFrontmatter(data.markdown)}</Markdown>
        )}
      </div>
    </div>
  );
}

export function ChatSourcesPanel({
  citations,
  selectedCitation,
  isMobile,
  reduceMotion,
  onSelect,
  onBack,
  onClose,
}: {
  citations: ChatCitation[] | null;
  selectedCitation: ChatCitation | null;
  isMobile: boolean;
  reduceMotion: boolean;
  onSelect: (citation: ChatCitation) => void;
  onBack: () => void;
  onClose: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  return (
    <>
      <AnimatePresence initial={false}>
        {citations && (
          <motion.aside
            initial={reduceMotion ? false : { x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { x: '100%', opacity: 0 }}
            transition={
              reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 32 }
            }
            className="absolute inset-y-0 right-0 hidden w-[22rem] flex-col bg-[var(--color-app-bg)] md:flex"
          >
            {selectedCitation ? (
              <CitationCanvas
                key={citationCanvasKey(selectedCitation)}
                citation={selectedCitation}
                onBack={onBack}
                onClose={onClose}
              />
            ) : (
              <>
                <header className="flex shrink-0 items-start justify-between gap-3 px-5 pb-4 pt-5">
                  <div className="min-w-0">
                    <h2 className="font-display text-lg font-semibold text-[var(--color-app-fg)]">
                      {t('chat.sources')}
                    </h2>
                    <p className="mt-1 text-sm text-[var(--color-app-muted)]">
                      {t('chat.sourcesDescription', { count: citations.length })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-md p-1 text-[var(--color-app-muted)] transition-colors hover:bg-[var(--color-app-surface-hover)] hover:text-[var(--color-app-fg)]"
                    aria-label={t('common.close')}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </header>
                <CitationSourceList citations={citations} onSelect={onSelect} />
              </>
            )}
          </motion.aside>
        )}
      </AnimatePresence>

      <Sheet open={isMobile && citations !== null} onOpenChange={(open) => !open && onClose()}>
        <SheetContent className="md:hidden">
          {citations && (
            <>
              {selectedCitation ? (
                <CitationCanvas
                  key={citationCanvasKey(selectedCitation)}
                  citation={selectedCitation}
                  onBack={onBack}
                  onClose={onClose}
                  mobile
                />
              ) : (
                <>
                  <header className="shrink-0 border-b border-[var(--color-app-border)] px-5 py-5 pr-12">
                    <SheetTitle className="font-display text-lg font-semibold">
                      {t('chat.sources')}
                    </SheetTitle>
                    <SheetDescription className="mt-1 text-sm text-[var(--color-app-muted)]">
                      {t('chat.sourcesDescription', { count: citations.length })}
                    </SheetDescription>
                  </header>
                  <CitationSourceList citations={citations} onSelect={onSelect} />
                </>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
