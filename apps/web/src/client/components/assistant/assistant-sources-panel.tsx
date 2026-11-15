import { useEffect, useRef } from 'react';
import { Button } from '../ui/button';
import { X, ArrowRight } from '../ui/icons';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../ui/sheet';
import { useMediaQuery } from '../../lib/use-media-query';
import { useI18n } from '../../lib/i18n';
import { assistantCopy } from '../../lib/assistant-i18n';
import type { AssistantMessage } from '../../lib/use-assistant';

export function AssistantSourcesPanel({
  id,
  message,
  onClose,
}: {
  id: string;
  message: AssistantMessage | null;
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const copy = assistantCopy[locale];
  const desktop = useMediaQuery('(min-width: 1024px)');
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!message || !desktop) return;
    close.current?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('[role="dialog"], [role="menu"]')
      )
        return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [message?.id, desktop, onClose]);
  const sources = (
    <div
      role="region"
      aria-label={copy.sources}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6"
    >
      <ol>
        {message?.details.references?.map((reference, index) => {
          let url: URL;
          try {
            url = new URL(reference.href, window.location.origin);
          } catch {
            return null;
          }
          if (!['http:', 'https:'].includes(url.protocol)) return null;
          return (
            <li
              key={reference.id + reference.href}
              className="border-b border-[var(--color-app-border)] py-5 last:border-0"
            >
              <p className="mb-2 text-xs text-[var(--color-app-muted)]">
                {index + 1} · {reference.source === 'web' ? copy.web : copy.library}
                {reference.source === 'web' ? ` · ${url.hostname}` : ''}
              </p>
              <a
                href={reference.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 items-start justify-between gap-3 rounded-lg text-sm font-medium leading-relaxed text-[var(--color-app-fg)] hover:underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--theme-focus)]"
              >
                <span className="min-w-0 break-words">{reference.title}</span>
                <ArrowRight
                  aria-hidden="true"
                  className="mt-1 h-4 w-4 shrink-0 -rotate-45 text-[var(--color-app-muted)]"
                />
              </a>
            </li>
          );
        })}
      </ol>
    </div>
  );
  if (!desktop)
    return (
      <Sheet
        open={Boolean(message)}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <SheetContent id={id} onCloseAutoFocus={(event) => event.preventDefault()}>
          <div className="px-5 pb-2 pt-6 pr-16">
            <SheetTitle className="text-lg font-semibold">{copy.sources}</SheetTitle>
            <SheetDescription className="mt-2 text-sm text-[var(--color-app-muted)]">
              {copy.sourcesHint}
            </SheetDescription>
          </div>
          {sources}
        </SheetContent>
      </Sheet>
    );
  if (!message) return null;
  return (
    <aside id={id} aria-labelledby={`${id}-title`} className="assistant-sources-panel">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-app-border)] p-4">
        <h2 id={`${id}-title`} className="text-base font-semibold">
          {copy.sources}
        </h2>
        <Button
          ref={close}
          variant="ghost"
          size="icon"
          className="h-11 w-11 rounded-full"
          aria-label={copy.closeSources}
          onClick={onClose}
        >
          <X isAnimated={false} className="h-4 w-4" />
        </Button>
      </header>
      <p className="px-5 pt-5 text-sm leading-relaxed text-[var(--color-app-muted)]">
        {copy.sourcesHint}
      </p>
      {sources}
    </aside>
  );
}
